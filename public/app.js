import { CONFIG } from './config.js';
import { messages } from './strings.js';
import { InteractiveMap } from './map.js';
import { icon } from './icons.js';
import { normalizedName, stationNumber, distanceMeters, progress } from './core.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = CONFIG.apiBase.replace(/\/$/, '');
const ownServer = !base || new URL(base).origin === location.origin;
const cacheKey = `bikemi-original-v2:${base || location.origin}:${new URL('.', location.href).pathname}`;
const tokenKey = cacheKey + ':session';
function read(storage, key, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
let prefs = read(localStorage, cacheKey, { language: 'it', profileId: 'me', cluster: true, caches: {}, locationIntroSeen: false });
if (!['it', 'en'].includes(prefs.language)) prefs.language = 'it';
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefs.profileId)) prefs.profileId = 'me';
prefs.caches ??= {};
let dashboard = prefs.caches[prefs.profileId] ?? { visitedStationIds: [], stations: [], lastSync: null, totalRideCount: 0 };
let stations = [], sourceDate = null, connection = {state:'NOT_CONNECTED'}, profiles = [];
let authorized = false, serverOnline = false, liveStations = false, busy = false, authAttemptId = null;
let filter = 'all', query = '', panelKind = null, selectedStation = null, toastTimer;
let locationPoint = null, watchId = null, locationEnabled = false, following = false, pendingNearest = false, geoStatus = 'locationOff';
const t = key => messages[prefs.language][key] ?? messages.it[key] ?? key;
const locale = () => prefs.language === 'it' ? 'it-IT' : 'en-GB';
const visits = () => dashboard.visitedStationIds ?? [];
const stats = () => progress(stations, visits());
function savePrefs() { try { localStorage.setItem(cacheKey, JSON.stringify(prefs)); } catch { toast(t('storageError')); } }
function dateLabel(value, time = true) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale(), {day:'numeric',month:'short',year:'numeric',...(time ? {hour:'2-digit',minute:'2-digit'} : {})}).format(new Date(value)) : t('never'); }
const distanceLabel = n => n < 1000 ? `${Math.round(n / 10) * 10} m` : `${(n / 1000).toLocaleString(locale(), {maximumFractionDigits:1})} km`;
function toast(message, duration = 6500) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, duration); }
function errorText(error) { return messages[prefs.language]['e_' + error.code] ?? (error.code === 'BACKEND_UNAVAILABLE' ? t('noServer') : t('errorGeneric')); }
async function api(path, body, timeout = 180000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  const headers = {}; if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!ownServer) { const token = read(sessionStorage, tokenKey, null); if (token) headers.Authorization = 'Bearer ' + token; }
  try {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers,
      ...(body !== undefined ? {body:JSON.stringify(body)} : {}), signal:controller.signal,
      credentials:ownServer ? 'same-origin' : 'omit', cache:'no-store' });
    if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(new Error(), {code:'BACKEND_UNAVAILABLE'});
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(), {code:value.code ?? 'REQUEST_FAILED'});
    serverOnline = true; return value;
  } catch (error) {
    if (!error.code) error.code = 'BACKEND_UNAVAILABLE';
    if (error.code === 'UNAUTHORIZED') authorized = false;
    if (error.code === 'BACKEND_UNAVAILABLE') serverOnline = false;
    throw error;
  } finally { clearTimeout(timer); }
}
const map = new InteractiveMap($('map'), {center:CONFIG.center,zoom:CONFIG.zoom,tiles:CONFIG.tiles,
  onSelect:selectStation,onMove:() => following = false,onTileError:() => toast(t('tilesError'))});
function translate(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(e => e.textContent = t(e.dataset.i18n));
  root.querySelectorAll('[data-i18n-placeholder]').forEach(e => e.placeholder = t(e.dataset.i18nPlaceholder));
  root.querySelectorAll('[data-i18n-title]').forEach(e => {e.title=t(e.dataset.i18nTitle);e.setAttribute('aria-label',e.title);});
  root.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = icon(e.dataset.icon));
}
function render() {
  document.documentElement.lang = prefs.language; translate();
  $('language-quick').textContent = prefs.language === 'it' ? 'EN' : 'IT';
  const x = stats();
  $('visited-count').textContent = x.visited; $('total-count').textContent = stations.length ? x.total : '--';
  $('progress-percent').textContent = x.percent.toLocaleString(locale(),{maximumFractionDigits:1}) + '%';
  $('progress-fill').style.width = x.percent + '%'; $('remaining-count').textContent = x.missing;
  $('connection-summary').textContent = busy ? t('syncing') : !serverOnline ? t('serverOffline') : !authorized ? t('siteLocked') : connection.state === 'CONNECTED' ? t('connected') : t('connectFirst');
  document.querySelectorAll('.last-sync-label').forEach(e => e.textContent = `${t('lastSync')}: ${dateLabel(dashboard.lastSync?.completedAt)}`);
  document.querySelectorAll('[data-action="sync"]').forEach(e => {e.disabled=busy; e.querySelector('[data-i18n="sync"]')?.replaceChildren(document.createTextNode(t(busy ? 'syncing' : 'sync')));});
  document.querySelectorAll('[data-filter]').forEach(e => {e.classList.toggle('active',e.dataset.filter===filter);e.setAttribute('aria-pressed',String(e.dataset.filter===filter));});
  $('data-source').textContent = sourceDate ? `${t(liveStations ? 'live' : 'snapshotDate')} ${dateLabel(sourceDate,false)}` : t('noStations');
  $('locate').classList.toggle('enabled',locationEnabled);
  $('search').setAttribute('aria-label',t('search')); $('close-panel').setAttribute('aria-label',t('close')); $('map').setAttribute('aria-label',t('mapKeyboard'));
  map.clustering = prefs.cluster !== false; renderMarkers(); renderSearch();
}
function distance(s) { return locationPoint ? distanceMeters([locationPoint.latitude,locationPoint.longitude],[s.latitude,s.longitude]) : Infinity; }
function renderMarkers() {
  const set = new Set(visits()); let list = stations.filter(s => s.active !== false);
  if (filter === 'visited') list = list.filter(s => set.has(s.stationId));
  if (filter === 'missing' || filter === 'nearby') list = list.filter(s => !set.has(s.stationId));
  if (filter === 'nearby' && locationPoint) list = list.sort((a,b)=>distance(a)-distance(b)).slice(0,15);
  map.setStations(list,visits(),{stations:t('stations'),visited:t('visited'),missing:t('missing')});
}
function renderSearch() {
  const box = $('search-results');
  if (!query.trim()) {box.hidden=true;box.replaceChildren();return;}
  const q = normalizedName(query), set = new Set(visits());
  const list = stations.filter(s => s.active !== false && (normalizedName(s.name).includes(q) || s.stationId === query.trim())).slice(0,12);
  box.innerHTML = list.length ? list.map(s=>`<button class="search-result" data-station="${esc(s.stationId)}"><i class="legend-dot ${set.has(s.stationId)?'green':'grey'}"></i><span>${esc(s.name)}<small>${set.has(s.stationId)?t('visited'):t('missing')}</small></span></button>`).join('') : `<p class="empty">${t('searchEmpty')}</p>`;
  box.hidden=false;
}
function openPanel(kind, html) {
  panelKind=kind;$('panel-content').innerHTML=html;translate($('panel'));
  if (!$('panel').open) $('panel').showModal();
  $('panel').scrollTop=0;
  document.querySelectorAll('[data-nav]').forEach(e=>e.classList.toggle('active',e.dataset.nav===kind || e.dataset.nav==='map'&&!['settings','progress'].includes(kind)));
}
function closePanel() {$('panel').close();panelKind=null;document.querySelectorAll('[data-nav]').forEach(e=>e.classList.toggle('active',e.dataset.nav==='map'));}
const pair=(label,value)=>`<div class="data-pair"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
function selectStation(s) {
  selectedStation=s;map.setSelected(s.stationId);query='';$('search').value='';renderSearch();
  const used=visits().includes(s.stationId),url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.latitude+','+s.longitude)}&travelmode=bicycling`;
  openPanel('station',`<div class="station-details"><span class="eyebrow">${t('station')} ${esc(stationNumber(s.name))}</span><h2>${esc(s.name.replace(/^\d+\s*-\s*/,''))}</h2><span class="status-badge ${used?'is-visited':''}">${t(used?'statusVisited':'missing')}</span><p class="lead">${t(used?'stationVisited':'stationMissing')}</p>${pair('ID',s.stationId)}${locationPoint?pair(t('straightLine'),distanceLabel(distance(s))):''}<p class="subtle">${t('sourceNote')}</p><a class="primary full" href="${url}" target="_blank" rel="noopener">${icon('navigation')}${t('directions')}</a></div>`);
}
function showAccount(forcePhone=false) {
  if (!authorized) return showLogin();
  const connected=connection.state==='CONNECTED'&&!forcePhone;
  openPanel('account',`<span class="eyebrow">${esc(prefs.profileId)}</span><h2>${t('accountTitle')}</h2><p class="lead">${t('accountLead')}</p>
    ${busy?`<div class="info-box" role="status">${t('working')}</div>`:authAttemptId?`<p class="subtle">${t('otpExplain')}</p><form id="otp-form"><label for="otp">${t('code')}</label><input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" minlength="4" maxlength="10" required><button class="primary full form-submit">${t('verify')}</button></form><button class="text-button" data-action="cancel-auth">${t('requestNew')}</button>`:connected?`<div class="info-box">${t('connectedExplain')}</div><button class="primary full" data-action="sync">${icon('sync')}${t('sync')}</button><button class="text-button" data-action="reconnect">${t('reconnect')}</button>`:`<p class="subtle">${t('smsExplain')}</p><form id="phone-form"><label for="phone">${t('phone')}</label><input id="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+39" maxlength="24" required><button class="primary full form-submit">${t('sendCode')}</button></form>`}
    <p class="subtle">${t('scope')}</p>`);
}
function showLogin() {
  openPanel('login',`<h2>${t('loginTitle')}</h2><p class="lead">${t('keyExplain')}</p>${!serverOnline?`<div class="info-box warn-box">${t('backendRequired')}</div>`:''}<p class="subtle">Server: ${esc(base || location.origin)}</p><form id="login-form"><label for="site-key">${t('accessKey')}</label><input id="site-key" type="password" autocomplete="current-password" required minlength="32" maxlength="256"><button class="primary full form-submit" ${busy?'disabled':''}>${t(busy?'working':'unlock')}</button></form>`);
}
function showProgress() {
  const x=stats();openPanel('progress',`<div class="progress-screen"><span class="eyebrow">${esc(prefs.profileId)}</span><h2>${t('progress')}</h2><div class="big-progress">${x.visited} <span>/ ${x.total}</span></div><p class="lead">${t('visitedLower')}</p><div class="progress-track"><span style="width:${x.percent}%"></span></div>${pair(t('missing'),x.missing)}${pair(t('totalRides'),dashboard.totalRideCount??0)}${pair(t('lastSync'),dateLabel(dashboard.lastSync?.completedAt))}<div class="info-box">${t('sourceNote')}</div><p class="subtle">${t('scope')}</p><button class="primary full" data-action="sync">${t('sync')}</button></div>`);
}
function showSettings() {
  openPanel('settings',`<h2>${t('settings')}</h2><section class="section"><div class="section-title">${t('account')}</div><p>${esc(prefs.profileId)} &middot; ${t(connection.state==='CONNECTED'?'connected':'notConnected')}</p><button class="primary full" data-action="account">${t(authorized?'accountTitle':'unlock')}</button></section>
  <section class="section"><form id="profile-form"><label for="profile-id">${t('profileId')}</label><input id="profile-id" type="text" value="${esc(prefs.profileId)}" pattern="[a-zA-Z0-9_-]{1,80}" maxlength="80" required><p class="subtle">${t('profileHelp')}</p>${profiles.length?`<label for="saved-profiles">${t('savedProfiles')}</label><select id="saved-profiles"><option value="">--</option>${profiles.map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('')}</select>`:''}<button class="secondary full form-submit" ${busy?'disabled':''}>${t('chooseProfile')}</button></form></section>
  <section class="section"><label for="language">${t('language')}</label><select id="language"><option value="it" ${prefs.language==='it'?'selected':''}>Italiano</option><option value="en" ${prefs.language==='en'?'selected':''}>English</option></select></section>
  <section class="section"><div class="section-title">${t('myLocation')}</div><p class="subtle">${t('locationExplain')}</p><button class="secondary full" data-action="toggle-location">${t(locationEnabled?'stopLocation':'enableLocation')}</button></section>
  <section class="section"><label class="switch-row" for="cluster-switch"><span>${t('cluster')}</span><input id="cluster-switch" type="checkbox" ${prefs.cluster!==false?'checked':''}></label><button class="text-button" data-action="refresh">${t('refresh')}</button></section>
  <section class="section"><div class="section-title">${t('privacy')}</div><p class="subtle">${t('privacyText')}</p><p class="subtle">${t('scope')}</p></section>
  <section class="section"><button class="secondary full danger" data-action="reset">${t('reset')}</button><button class="text-button" data-action="logout">${t('logout')}</button><p class="subtle">${t('notOfficial')}</p></section>`);
}
function validStations(raw) {return (Array.isArray(raw)?raw:[]).filter(s=>s.stationId && typeof s.name==='string'&&Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)).map(s=>({...s,stationId:String(s.stationId)}));}
function setDashboard(data) {
  dashboard=data;const list=validStations(data.stations);if(list.length)stations=list;
  sourceDate=stations.reduce((latest,s)=>!latest||Date.parse(s.updatedAt)>Date.parse(latest)?s.updatedAt:latest,sourceDate);
  prefs.caches[prefs.profileId]=data;savePrefs();render();
}
async function loadProfile() {
  const id=prefs.profileId;
  const [c,d,p]=await Promise.all([api('/api/bikemi/connection/'+encodeURIComponent(id)),api('/api/bikemi/dashboard/'+encodeURIComponent(id)),api('/api/explorer/profiles')]);
  if(id!==prefs.profileId)return;
  authorized=true;connection=c;profiles=p.profiles;setDashboard(d);
}
async function refreshStations() {
  if(!authorized)return;
  try {const x=await api('/api/bikemi/stations',undefined,30000);liveStations=x.live;await loadProfile();if(!x.live)toast(t('cacheExplain'));}
  catch(e){toast(errorText(e));render();}
}
async function doSync() {
  if(busy)return;if(!authorized){showLogin();return;}
  if(connection.state!=='CONNECTED'){showAccount();return;}
  busy=true;render();if($('panel').open)showAccount();
  try {
    const r=await api('/api/bikemi/sync',{userId:prefs.profileId});connection=r.connection;setDashboard(r.dashboard);
    if(r.warning==='STATION_FEED_UNAVAILABLE')liveStations=false;else if(r.stationCount>0)liveStations=true;
    closePanel();toast(`${t('success')}: ${r.newStations} ${t('newStations')}, ${r.newRides} ${t('newRides')}. ${r.rideCount} ${t('ridesRead')}.${r.warning?' '+t('feedWarning'):''}`,9500);
  } catch(e) {
    if(e.code==='SESSION_EXPIRED')connection.state='SESSION_EXPIRED';
    toast(errorText(e),10000);busy=false;
    if(e.code==='UNAUTHORIZED')showLogin();else if(e.code==='SESSION_EXPIRED')showAccount();else closePanel();
  } finally {busy=false;render();}
}
function showSource() {openPanel('source',`<h2>${t('source')}</h2>${pair(t('snapshotDate'),dateLabel(sourceDate))}<p class="lead">${t(liveStations?'live':'cacheExplain')}</p><div class="info-box">${t('sourceNote')}</div><p class="subtle">${t('scope')}</p>`);}
function showLocationConsent() {openPanel('location',`<h2>${t('myLocation')}</h2><p class="lead">${t('locationExplain')}</p><p class="subtle">${t('sourceNote')}</p><button class="primary full" data-action="enable-location">${t('enableLocation')}</button>`);}
function startLocation() {
  if(!window.isSecureContext){toast(t('locationHttps'));return;}if(!navigator.geolocation){toast(t('locationUnavailable'));return;}
  locationEnabled=true;following=true;geoStatus='locationWaiting';
  if(watchId!==null){if(locationPoint)map.setView([locationPoint.latitude,locationPoint.longitude],16);return;}
  watchId=navigator.geolocation.watchPosition(p=>{
    locationPoint={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy};geoStatus='locationOn';
    map.setLocation(locationPoint);if(following)map.setView([locationPoint.latitude,locationPoint.longitude],Math.max(map.zoom,15));
    render();if(pendingNearest){pendingNearest=false;nearestMissing();}
  },e=>{geoStatus=e.code===1?'locationDenied':'locationUnavailable';toast(t(geoStatus));if(e.code===1)stopLocation();},
  {enableHighAccuracy:true,maximumAge:5000,timeout:15000});render();
}
function stopLocation(){if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;locationEnabled=false;following=false;pendingNearest=false;locationPoint=null;map.setLocation(null);render();}
function nearestMissing(){if(!locationPoint){pendingNearest=true;showLocationConsent();return;}const set=new Set(visits()),list=stations.filter(s=>s.active!==false&&!set.has(s.stationId)).sort((a,b)=>distance(a)-distance(b));if(!list.length){toast(t('noMissing'));return;}following=false;filter='missing';render();map.setView([list[0].latitude,list[0].longitude],16);selectStation(list[0]);}
function setLanguage(lang){prefs.language=lang;savePrefs();render();if(panelKind==='settings')showSettings();else if(panelKind==='progress')showProgress();else if(panelKind==='account')showAccount();else if(panelKind==='login')showLogin();else if(panelKind==='station'&&selectedStation)selectStation(selectedStation);}

async function handleForm(form) {
  if(busy)return;const data={};for(const input of form.querySelectorAll('input'))data[input.id]=input.value.trim();
  if(form.id==='profile-form'){
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(data['profile-id'])){toast(t('e_INVALID_INPUT'));return;}
    if(authAttemptId){await api('/api/bikemi/connect/cancel',{userId:prefs.profileId});authAttemptId=null;}
    prefs.profileId=data['profile-id'];dashboard=prefs.caches[prefs.profileId]??{visitedStationIds:[],stations:stations,lastSync:null,totalRideCount:0};connection={state:'NOT_CONNECTED'};savePrefs();render();
    try{await loadProfile();showSettings();}catch(e){toast(errorText(e));showAccount();}return;
  }
  busy=true;render();let verified=false;
  try{
    if(form.id==='login-form'){
      $('site-key').value='';showLogin();const r=await api('/api/explorer/login',{key:data['site-key']});
      if(!ownServer)try{sessionStorage.setItem(tokenKey,JSON.stringify(r.token));}catch{throw Object.assign(new Error(),{code:'REQUEST_FAILED'});}
      authorized=true;await loadProfile();busy=false;showAccount();void refreshStations();
    } else if(form.id==='phone-form'){
      showAccount();const r=await api('/api/bikemi/connect/start',{userId:prefs.profileId,phoneNumber:data.phone});authAttemptId=r.authAttemptId;connection.state='WAITING_FOR_SMS';
    } else if(form.id==='otp-form'){
      $('otp').value='';showAccount();connection=await api('/api/bikemi/connect/verify',{userId:prefs.profileId,authAttemptId,otp:data.otp});authAttemptId=null;verified=true;
    }
  }catch(e){toast(errorText(e),10000);if(form.id==='otp-form'){authAttemptId=null;connection.state='AUTHENTICATION_FAILED';}}
  finally{busy=false;render();if(form.id!=='login-form'||authorized)showAccount();else showLogin();}
  if(verified)await doSync();
}
document.addEventListener('submit',e=>{if(e.target.matches('#login-form,#phone-form,#otp-form,#profile-form')){e.preventDefault();void handleForm(e.target).catch(err=>{busy=false;toast(errorText(err));render();});}});
document.addEventListener('click',e=>{
  const b=e.target.closest('button,a');if(!b)return;
  if(b.dataset.station){const s=stations.find(s=>s.stationId===b.dataset.station);if(s){map.setView([s.latitude,s.longitude],16);selectStation(s);}return;}
  if(b.dataset.filter){filter=b.dataset.filter;if(filter==='nearby'&&!locationPoint)showLocationConsent();render();return;}
  if(b.dataset.nav){if(b.dataset.nav==='map')closePanel();else if(b.dataset.nav==='progress')showProgress();else showSettings();return;}
  const action=b.dataset.action;if(!action)return;
  void (async()=>{
    if(action==='sync')await doSync();
    else if(action==='account')showAccount();
    else if(action==='reconnect'&&!busy)showAccount(true);
    else if(action==='cancel-auth'&&!busy){await api('/api/bikemi/connect/cancel',{userId:prefs.profileId});authAttemptId=null;connection.state='NOT_CONNECTED';showAccount(true);}
    else if(action==='refresh')await refreshStations();
    else if(action==='enable-location'){closePanel();startLocation();}
    else if(action==='toggle-location'){if(locationEnabled){stopLocation();showSettings();}else showLocationConsent();}
    else if(action==='reset'&&!busy&&confirm(t('resetConfirm'))){const d=await api('/api/explorer/reset',{userId:prefs.profileId});setDashboard(d);toast(t('resetDone'));showSettings();}
    else if(action==='logout'&&!busy){try{await api('/api/explorer/logout',{});}catch{}try{sessionStorage.removeItem(tokenKey);}catch{}authorized=false;authAttemptId=null;connection={state:'NOT_CONNECTED'};prefs.caches={};dashboard={visitedStationIds:[],lastSync:null,totalRideCount:0};savePrefs();render();showLogin();}
  })().catch(error=>{toast(errorText(error));render();});
});
document.addEventListener('change',e=>{if(e.target.id==='language')setLanguage(e.target.value);if(e.target.id==='cluster-switch'){prefs.cluster=e.target.checked;savePrefs();render();}if(e.target.id==='saved-profiles'&&e.target.value)$('profile-id').value=e.target.value;});
$('search').addEventListener('input',e=>{query=e.target.value;renderSearch();});
$('progress-card').addEventListener('click',showProgress);$('language-quick').addEventListener('click',()=>setLanguage(prefs.language==='it'?'en':'it'));
$('data-source').addEventListener('click',showSource);$('zoom-in').addEventListener('click',()=>map.zoomAt(map.zoom+1));$('zoom-out').addEventListener('click',()=>map.zoomAt(map.zoom-1));
$('show-milan').addEventListener('click',()=>{following=false;map.setView(CONFIG.center,CONFIG.zoom);});$('locate').addEventListener('click',()=>locationEnabled?startLocation():showLocationConsent());
$('nearest').addEventListener('click',nearestMissing);$('close-panel').addEventListener('click',closePanel);$('panel').addEventListener('cancel',()=>panelKind=null);
function dismissIntro(){prefs.locationIntroSeen=true;savePrefs();$('location-banner').hidden=true;}
$('location-intro-yes').addEventListener('click',()=>{dismissIntro();showLocationConsent();});$('location-intro-no').addEventListener('click',dismissIntro);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}else if(!document.hidden&&locationEnabled&&watchId===null)startLocation();});
window.addEventListener('pagehide',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;});
window.addEventListener('pageshow',e=>{if(e.persisted&&locationEnabled&&watchId===null)startLocation();});
async function init(){
  // Remove the old static-import version's service worker only within this app scope.
  if('serviceWorker' in navigator){try{for(const r of await navigator.serviceWorker.getRegistrations())if(r.scope===new URL('.',location.href).href)await r.unregister();}catch{}}
  try{const r=await fetch('./data/stations.json');const seed=await r.json();stations=validStations(seed.stations);sourceDate=seed.capturedAt;}catch{}
  if(dashboard.stations?.length)stations=validStations(dashboard.stations);render();$('location-banner').hidden=Boolean(prefs.locationIntroSeen);
  try{const health=await api('/api/health',undefined,12000);if(health.mode!=='node-playwright')throw Object.assign(new Error(),{code:'BACKEND_UNAVAILABLE'});await loadProfile();void refreshStations();}
  catch(e){render();if(e.code!=='UNAUTHORIZED')toast(t('offlineCache'),8500);}
}
void init();
