"""In-memory DOM tests. Network, app API, provider login and GPS are simulated."""
import json,re,base64,io,os
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]/'public'
OUTPUT=Path(os.environ.get('BIKEMI_TEST_OUTPUT','test-results'));OUTPUT.mkdir(exist_ok=True)
seed=json.loads((ROOT/'data/stations.json').read_text())
html=(ROOT/'index.html').read_text();html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html);html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html);html=html.replace('</head>','<style>'+(ROOT/'styles.css').read_text()+'</style></head>')
im=Image.new('RGB',(256,256),'#e8ece3');d=ImageDraw.Draw(im);d.line((0,128,256,128),fill='#f7f9f3',width=12);d.line((128,0,128,256),fill='#f7f9f3',width=10);buf=io.BytesIO();im.save(buf,format='PNG');tile='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
parts=[]
for name in ['config.js','base-i18n.js','strings.js','icons.js','core.js','map.js','app.js']:
 s=(ROOT/name).read_text();s=re.sub(r'^import .*?;\s*$','',s,flags=re.M);s=re.sub(r'^export \{.*?\};\s*$','',s,flags=re.M);s=re.sub(r'^export ','',s,flags=re.M);s=s.replace('https://tile.openstreetmap.org/{z}/{x}/{y}.png',tile);parts.append(s)
bundle='\n'.join(parts)
prelude='''
const location = new URL('https://preview.example/explorer/');
const memory={}; const localStorage={getItem:k=>memory[k]??null,setItem:(k,v)=>memory[k]=String(v),removeItem:k=>delete memory[k]};const sessionStorage=localStorage;
const window={isSecureContext:true,addEventListener:globalThis.addEventListener.bind(globalThis)};
let geoId=0;const watchers=new Map();const navigator={geolocation:{watchPosition:(ok,error)=>{const id=++geoId;watchers.set(id,ok);setTimeout(()=>ok({coords:{latitude:45.4642,longitude:9.19,accuracy:10}}),30);return id;},clearWatch:id=>watchers.delete(id)}};
globalThis.__moveGPS=(lat,lon)=>{for(const ok of watchers.values())ok({coords:{latitude:lat,longitude:lon,accuracy:12}})};
const mockSeed=SNAPSHOT;let mockSite=false,mockConnected=false,mockSyncs=0;
let mockDashboard={stations:mockSeed.stations.map(s=>({...s,updatedAt:mockSeed.capturedAt})),visitedStationIds:[],lastSync:null,totalRideCount:0};
const fetch=async(url,options={})=>{
 let value,status=200;const path=String(url);
 if(path==='./data/stations.json')value=mockSeed;
 else if(path==='/api/health')value={ok:true,mode:'node-playwright'};
 else if(path==='/api/explorer/login'){mockSite=true;value={token:'test-token'};}
 else if(!mockSite){status=401;value={code:'UNAUTHORIZED'};}
 else if(path==='/api/explorer/profiles')value={profiles:['me']};
 else if(path.startsWith('/api/bikemi/connection/'))value={state:mockConnected?'CONNECTED':'NOT_CONNECTED'};
 else if(path.startsWith('/api/bikemi/dashboard/'))value=mockDashboard;
 else if(path==='/api/bikemi/stations')value={stations:mockDashboard.stations,live:false};
 else if(path==='/api/bikemi/connect/start')value={status:'WAITING_FOR_SMS',authAttemptId:'11111111-1111-4111-8111-111111111111'};
 else if(path==='/api/bikemi/connect/verify'){mockConnected=true;value={state:'CONNECTED'};}
 else if(path==='/api/bikemi/sync'){
   mockSyncs++;mockDashboard={...mockDashboard,visitedStationIds:[mockSeed.stations[0].stationId,mockSeed.stations[1].stationId],lastSync:{completedAt:'2026-10-22T10:00:00Z',rideCount:1},totalRideCount:1};
   value={dashboard:mockDashboard,connection:{state:'CONNECTED'},newStations:mockSyncs===1?2:0,newRides:mockSyncs===1?1:0,rideCount:1,stationCount:0,warning:null};
 }else{status=404;value={code:'NOT_FOUND'};}
 return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
};
'''.replace('SNAPSHOT',json.dumps(seed))
results=[];errors=[]
def ok(s):results.append(s);print('PASS',s,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_TEST_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':393,'height':852},is_mobile=True,has_touch=True);page.set_default_timeout(4500);page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html);page.add_script_tag(content='(function(){'+prelude+'\n'+bundle+'\n})();')
 expect(page.locator('#total-count')).to_have_text('317');ok('317 real stations from saved public snapshot')
 expect(page.locator('#visited-count')).to_have_text('0');ok('No automatic GPS or station-list visits')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');ok('Mobile layout has no horizontal overflow')
 page.locator('.mobile-sync').click();expect(page.locator('#site-key')).to_be_visible();ok('Private site access required before BikeMi account')
 page.locator('#site-key').fill('demo-test-site-key-not-for-production-000');page.locator('#login-form button').click();expect(page.locator('#phone')).to_be_visible();ok('Site unlock opens BikeMi phone form')
 page.locator('#phone').fill('+39 333 123 4567');page.locator('#phone-form button').click();expect(page.locator('#otp')).to_be_visible();ok('BikeMi phone -> SMS form, no file import')
 page.locator('#otp').fill('123456');page.locator('#otp-form button').click();expect(page.locator('#visited-count')).to_have_text('2');expect(page.locator('#panel')).not_to_be_visible();ok('OTP verification triggers sync and updates visited count')
 page.locator('.mobile-sync').click();page.wait_for_timeout(100);expect(page.locator('#visited-count')).to_have_text('2');ok('Repeated sync is idempotent')
 page.locator('#location-intro-no').click();page.locator('#locate').click();page.locator('[data-action="enable-location"]').click();expect(page.locator('.user-dot')).to_be_visible();ok('GPS permission flow displays simulated live position')
 page.evaluate('globalThis.__moveGPS(45.47,9.18)');expect(page.locator('#visited-count')).to_have_text('2');ok('GPS updates never mark a station as visited')
 page.locator('#nearest').click();expect(page.locator('.station-details a')).to_have_attribute('target','_blank');ok('Nearest missing station opens details and directions')
 page.locator('#close-panel').click();page.locator('#language-quick').click();expect(page.locator('html')).to_have_attribute('lang','en');expect(page.locator('.mobile-sync')).to_contain_text('Update from BikeMi');ok('Italian -> English switch works')
 page.locator('[data-nav="settings"]').click();expect(page.locator('#panel h2')).to_contain_text('Profile');ok('Settings are translated')
 assert page.locator('input[type=file]').count()==0;ok('No manual history upload control')
 page.locator('#close-panel').click();page.locator('#show-milan').click();page.evaluate('document.getElementById("toast").hidden=true');page.wait_for_timeout(100);page.screenshot(path=str(OUTPUT/'corrected-mobile.png'));ok('Mobile map layout rendered')
 page.set_viewport_size({'width':1440,'height':960});page.wait_for_timeout(100);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUTPUT/'corrected-desktop.png'));ok('Desktop layout rendered without horizontal overflow')
 assert not errors,errors;ok('No unhandled JavaScript errors')
 browser.close()
(OUTPUT/'browser-results.json').write_text(json.dumps({'method':'Chromium in-memory DOM with simulated API, GPS and neutral tile fixtures','checks':results,'errors':errors},indent=2))
print('TOTAL',len(results))
