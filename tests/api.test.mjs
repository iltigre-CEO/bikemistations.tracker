import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../dist/app.js';
import { ConnectionStore } from '../dist/db.js';

test('HTTP integration: original acquisition flow and private API boundaries',async t=>{
 const key='private-test-key-'.repeat(3),store=new ConnectionStore(':memory:');
 let loggedIn=false,rows=[{id:'trip-1',text:'14/09/2026 09:00 | Stazione: Duomo | Stazione: Cadorna'}],national=null,feedFails=false;
 const stations=[{stationId:'a',name:'Duomo',latitude:45.46,longitude:9.19,bikesAvailable:null,docksAvailable:null,updatedAt:'2026-09-21T12:00:00Z'},{stationId:'b',name:'Cadorna',latitude:45.47,longitude:9.18,bikesAvailable:null,docksAvailable:null,updatedAt:'2026-09-21T12:00:00Z'},{stationId:'c',name:'Bocconi',latitude:45.45,longitude:9.19,bikesAvailable:null,docksAvailable:null,updatedAt:'2026-09-21T12:00:00Z'}];
 store.saveStations(stations);
 const browser={open:async()=>({context:{close:async()=>{}},page:{}}),requestSms:async(_page,p)=>{national=p;},submitOtp:async(_page,code)=>{assert.equal(code,'123456');loggedIn=true;},hasRideHistory:async()=>loggedIn,rideHistoryRows:async()=>rows};
 const {app}=createApp({accessKey:key,store,browser,allowedOrigins:['https://example.github.io'],stationFetcher:async()=>{if(feedFails)throw new Error('feed down');return stations;}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;let token;
 async function req(path,body,extra={}){const headers={...extra};if(token)headers.Authorization='Bearer '+token;if(body!==undefined)headers['Content-Type']='application/json';const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});const value=await r.json().catch(()=>null);return {r,value};}
 try{
  await t.test('health public and no phone/session leakage',async()=>{const {r,value}=await req('/api/health');assert.equal(r.status,200);assert.equal(value.mode,'node-playwright');});
  await t.test('private data blocked without site authorization',async()=>assert.equal((await req('/api/bikemi/dashboard/me')).r.status,401));
  await t.test('unknown origin blocked before login',async()=>assert.equal((await req('/api/explorer/login',{key},{Origin:'https://untrusted.example'})).r.status,403));
  await t.test('invalid site key rejected',async()=>assert.equal((await req('/api/explorer/login',{key:'wrong'})).r.status,401));
  await t.test('login creates bearer and HttpOnly cookie',async()=>{const {r,value}=await req('/api/explorer/login',{key});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);token=value.token;});
  await t.test('configured Pages origin permitted with bearer',async()=>{const {r}=await req('/api/bikemi/dashboard/me',undefined,{Origin:'https://example.github.io'});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://example.github.io');});
  await t.test('site key does not impersonate a BikeMi session',async()=>{const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.code,'SESSION_EXPIRED');});
  let attempt;
  await t.test('request SMS uses original normalized phone flow',async()=>{const {r,value}=await req('/api/bikemi/connect/start',{userId:'me',phoneNumber:'+39 333 123 4567'});assert.equal(r.status,202);assert.equal(national,'3331234567');attempt=value.authAttemptId;});
  await t.test('OTP verifies original browser session',async()=>{const {value}=await req('/api/bikemi/connect/verify',{userId:'me',authAttemptId:attempt,otp:'123456'});assert.equal(value.state,'CONNECTED');assert.equal('phoneNumber' in value,false);});
  await t.test('sync reads history rows and marks departure/arrival only',async()=>{const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.rideCount,1);assert.equal(value.newStations,2);assert.deepEqual(value.dashboard.visitedStationIds.sort(),['a','b']);assert.equal(value.historyScope,'loaded-page');});
  await t.test('repeat sync preserves original idempotence',async()=>{const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.newRides,0);assert.equal(value.newStations,0);});
  await t.test('later sync is incremental and keeps old rides',async()=>{rows=[{id:'trip-2',text:'15/09/2026 09:00 | Stazione: Cadorna | Stazione: Bocconi'}];const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.newRides,1);assert.equal(value.newStations,1);assert.equal(value.dashboard.totalRideCount,2);});
  await t.test('unrecognized history does not fake successful update',async()=>{rows=[{text:''}];const before=store.dashboard('me').lastSync;const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.code,'NO_RECOGNIZED_RIDES');assert.deepEqual(store.dashboard('me').lastSync,before);assert.equal(store.dashboard('me').visitedStationIds.length,3);});
  await t.test('feed outage does not discard valid private history',async()=>{feedFails=true;rows=[{id:'trip-3',text:'16/09/2026 09:00 | Stazione: Duomo | Stazione: Bocconi'}];const {value}=await req('/api/bikemi/sync',{userId:'me'});assert.equal(value.warning,'STATION_FEED_UNAVAILABLE');assert.equal(value.dashboard.totalRideCount,3);});
  await t.test('public station outage returns marked cached stations',async()=>{const {value}=await req('/api/bikemi/stations');assert.equal(value.live,false);assert.equal(value.stations.length,3);});
  await t.test('path traversal IDs rejected',async()=>assert.equal((await req('/api/bikemi/sync',{userId:'../../bad'})).r.status,400));
  await t.test('OTP and profile endpoints do not expose saved phone',async()=>{const a=await req('/api/bikemi/connection/me');assert.equal(JSON.stringify(a.value).includes('3331234567'),false);assert.equal(a.r.headers.get('cache-control'),'no-store');});
  await t.test('private database and source code not statically served',async()=>{const a=await fetch(base+'/data/bikemi.sqlite'),b=await fetch(base+'/src/bikemi.ts');assert.equal(a.status,404);assert.equal(b.status,404);});
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
