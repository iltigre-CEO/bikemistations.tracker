import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../dist/db.js';
import { parseRideRows } from '../dist/ride-parser.js';
import { BikeMiBrowser } from '../dist/bikemi.js';
import { fetchStations } from '../dist/stations.js';
import { sessionToken, validToken, sameSecret, RateLimit, SESSION_MS } from '../dist/security.js';
import { progress, distanceMeters } from '../public/core.js';
const station = (id, name, updatedAt='2026-09-21T12:00:00Z') => ({stationId:id,name,latitude:45.46,longitude:9.19,bikesAvailable:null,docksAvailable:null,updatedAt});
const ride = (id, from, to) => ({providerRideId:id,userId:'me',startStation:from,endStation:to,startedAt:null,endedAt:null,durationSeconds:null,bikeType:null});

test('legacy parser: Italian rendered history row', () => {
  const [r]=parseRideRows('me',[{text:'Cronologia utilizzi\nsettembre 2026\nluned\u00ec 21 settembre\n16:26 6 - San Giorgio\t16:38 192 - Col di Lana - Col Moschin\t11 minuti\t1 km'}]);
  assert.equal(r.startStation,'6 - San Giorgio');assert.equal(r.endStation,'192 - Col di Lana - Col Moschin');assert.equal(r.durationSeconds,660);
});
test('legacy parser: generic row and deterministic id', () => {
 const text='12/09/2026 08:30 | 12/09/2026 08:51 | 00:21:00 | Stazione: Duomo | Stazione: Cadorna | E-bike';
 const [a]=parseRideRows('me',[{text}]),[b]=parseRideRows('me',[{text}]);
 assert.equal(a.providerRideId,b.providerRideId);assert.equal(a.startStation,'Duomo');assert.equal(a.endStation,'Cadorna');assert.equal(a.durationSeconds,1260);
});
test('legacy parser: provider ID preserved',()=>assert.equal(parseRideRows('me',[{id:'trip-483',text:'14/09/2026 09:00 | Stazione: Duomo'}])[0].providerRideId,'trip-483'));
test('legacy parser: empty history creates no rides',()=>assert.deepEqual(parseRideRows('me',[{text:''}]),[]));
test('original OTP flow: fills and waits, without clicking a submit button',async()=>{
 const calls=[];const page={getByLabel:()=>({fill:async x=>calls.push(['fill',x])}),locator:s=>({waitFor:async o=>calls.push([s,o.state])})};
 await new BikeMiBrowser('data/test-sessions').submitOtp(page,'123456');
 assert.deepEqual(calls,[['fill','123456'],['form#enter-code-form','detached']]);
});
test('original history acquisition reads body.innerText of authenticated page',async()=>{
 let callback;const page={waitForTimeout:async()=>{},evaluate:async fn=>{callback=fn.toString();return 'loaded history';}};
 const rows=await new BikeMiBrowser('data/test-sessions').rideHistoryRows(page);
 assert.deepEqual(rows,[{text:'loaded history'}]);assert.match(callback,/document.body.innerText/);
});
test('public feed joins station identity and availability',async()=>{
 let count=0;const mock=async()=>({ok:true,json:async()=>++count===1?{data:{stations:[{station_id:'a',name:'Duomo',lat:45.46,lon:9.19}]}}:{last_updated:1789000000,data:{stations:[{station_id:'a',num_bikes_available:4,num_docks_available:7}]}}});
 const [s]=await fetchStations(mock);assert.equal(s.bikesAvailable,4);assert.equal(s.docksAvailable,7);
});
test('public feed failure is not reported as a successful empty network',async()=>assert.rejects(fetchStations(async()=>({ok:false})),/temporarily unavailable/));
test('database: both departure and arrival count, repeated import is idempotent',()=>{
 const db=new ConnectionStore(':memory:');db.saveStations([station('a','6 - San Giorgio'),station('b','192 - Col di Lana')]);
 db.saveRides([ride('one','6 - San Giorgio','192 - Col di Lana')]);db.saveRides([ride('one','6 - San Giorgio','192 - Col di Lana')]);
 assert.deepEqual(db.dashboard('me').visitedStationIds.sort(),['a','b']);assert.equal(db.dashboard('me').totalRideCount,1);db.close();
});
test('database: only trips, not station existence, establish a visit',()=>{const db=new ConnectionStore(':memory:');db.saveStations([station('a','Duomo')]);assert.deepEqual(db.dashboard('me').visitedStationIds,[]);db.close();});
test('database: inactive stations remain in history but leave active denominator',()=>{
 const db=new ConnectionStore(':memory:');db.saveStations([station('a','Duomo'),station('b','Cadorna')]);db.saveRides([ride('one','Duomo','Cadorna')]);db.dashboard('me');
 db.saveStations([station('a','Duomo','2026-09-22T12:00:00Z')]);const d=db.dashboard('me');assert.equal(d.stations.find(s=>s.stationId==='b').active,false);assert.equal(d.visitedStationIds.length,2);assert.equal(progress(d.stations,d.visitedStationIds).percent,100);db.close();
});
test('database: provider-visible number is not confused with technical ID',()=>{
 const db=new ConnectionStore(':memory:');db.saveStations([station('6','100 - Wrong'),station('900','6 - San Giorgio')]);db.saveRides([ride('one','6 - San Giorgio',null)]);assert.deepEqual(db.dashboard('me').visitedStationIds,['900']);db.close();
});
test('database: renamed previously discovered stations remain visited',()=>{
 const db=new ConnectionStore(':memory:');db.saveStations([station('a','Old')]);db.saveRides([ride('one','Old',null)]);db.dashboard('me');db.saveStations([station('a','New','2026-09-22T12:00:00Z')]);assert.deepEqual(db.dashboard('me').visitedStationIds,['a']);db.close();
});
test('database: ambiguous unnumbered names do not mark multiple stations',()=>{
 const db=new ConnectionStore(':memory:');db.saveStations([station('a','1 - Same'),station('b','2 - Same')]);db.saveRides([ride('one','Same',null)]);assert.deepEqual(db.dashboard('me').visitedStationIds,[]);db.close();
});
test('database: failure retains last successful sync',()=>{const db=new ConnectionStore(':memory:');db.finishSync('me','SUCCESS',1);const before=db.dashboard('me').lastSync;db.finishSync('me','ERROR',0);assert.deepEqual(db.dashboard('me').lastSync,before);assert.equal(db.dashboard('me').lastAttempt.status,'ERROR');db.close();});
test('database: progress reset does not remove account/session state',()=>{const db=new ConnectionStore(':memory:');db.set('me','CONNECTED');db.saveRides([ride('one','Duomo',null)]);db.resetProgress('me');assert.equal(db.dashboard('me').totalRideCount,0);assert.equal(db.get('me').state,'CONNECTED');db.close();});
test('security: valid token accepted, another key rejected',()=>{const key='x'.repeat(40),token=sessionToken(key);assert.equal(validToken(token,key),true);assert.equal(validToken(token,'y'.repeat(40)),false);});
test('security: expired and modified tokens rejected',()=>{const key='x'.repeat(40),now=1000000,token=sessionToken(key,now);assert.equal(validToken(token,key,now+SESSION_MS+1),false);assert.equal(validToken(token+'0',key,now),false);});
test('security: constant-length secret comparison',()=>{assert.equal(sameSecret('a','a'),true);assert.equal(sameSecret('a','bbbb'),false);});
test('security: login rate limit expires',()=>{const limit=new RateLimit(2,100);assert.equal(limit.allow('a',0),true);assert.equal(limit.allow('a',1),true);assert.equal(limit.allow('a',2),false);assert.equal(limit.allow('a',101),true);});
test('map distance: same coordinates are zero',()=>assert.equal(distanceMeters([45.46,9.19],[45.46,9.19]),0));
test('progress: empty network never yields NaN',()=>assert.equal(progress([],[]).percent,0));
