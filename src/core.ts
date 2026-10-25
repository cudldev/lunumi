export type PlacePhoto={url:string,sourceUrl:string,attribution:string,license:string,licenseUrl:string};
export type Place={id:string,name:string,lat:number,lon:number,tags:Record<string,string>,distance:number,photo?:PlacePhoto,stale?:boolean};
type Coordinates={lat:number,lon:number};
// One best-effort public request per search; use cache or stale results on failure.
const overpassEndpoint='https://overpass.private.coffee/api/interpreter';
const nearbyCache=new Map<string,{places:Place[],savedAt:number}>();
const nearbyCacheTtl=5*60*1000;
const nearbyStaleTtl=7*24*60*60*1000;
const nearbyCacheStorageKey='lunumi-nearby-cache-v1';
const helsinkiMetroBounds={south:60.0,north:60.5,west:24.0,east:25.8};
type PrebuiltPlace={id:string,name:string,lat:number,lon:number,amenity:string,cuisine?:string,opening_hours?:string,[key:string]:unknown};
type PrebuiltDataset={coverage:{type:'MultiPolygon',coordinates:number[][][][]},places:PrebuiltPlace[]};
let prebuiltDatasetPromise:Promise<PrebuiltDataset|null>|null=null;
export const haversine=(a:Coordinates,b:Coordinates)=>{const r=6371000,p=Math.PI/180,dLat=(b.lat-a.lat)*p,dLon=(b.lon-a.lon)*p,x=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;return 2*r*Math.asin(Math.sqrt(x))};
export const meal=()=>{const h=new Date().getHours()+new Date().getMinutes()/60;return h>=6&&h<10.5?'breakfast':h<14.5?'lunch':h<17?'afternoon':h<21.5?'dinner':'late night'};
export const directionsUrl=(place:Pick<Place,'lat'|'lon'|'name'>,userAgent=typeof navigator==='undefined'?'':navigator.userAgent)=>{const destination=`${place.lat},${place.lon}`;if(/Android/i.test(userAgent)){const url=new URL('geo:0,0');url.searchParams.set('q',`${destination}${place.name?`(${place.name})`:''}`);return url.toString()}if(/iPhone|iPad|iPod/i.test(userAgent)||(/Macintosh/i.test(userAgent)&&typeof navigator!=='undefined'&&navigator.maxTouchPoints>1)){const url=new URL('https://maps.apple.com/');url.searchParams.set('daddr',destination);url.searchParams.set('dirflg','d');return url.toString()}const url=new URL('https://www.google.com/maps/dir/');url.searchParams.set('api','1');url.searchParams.set('destination',destination);return url.toString()};
export const webDirectionsUrl=(place:Pick<Place,'lat'|'lon'>)=>{const url=new URL('https://www.google.com/maps/dir/');url.searchParams.set('api','1');url.searchParams.set('destination',`${place.lat},${place.lon}`);return url.toString()};
export const mapsSearchUrl=(lat:number,lon:number,query='restaurants')=>{const term=encodeURIComponent(query.trim()||'restaurants');return `https://www.google.com/maps/search/${term}/@${lat},${lon},15z`};
export const nearbyQuery=(lat:number,lon:number,radius:number)=>`[out:json];(${['restaurant','cafe','fast_food','food_court'].map(amenity=>`nwr["amenity"="${amenity}"](around:${radius},${lat},${lon});`).join('')});out center tags;`;
let lastGeocode=0;export async function geocode(query:string,signal?:AbortSignal):Promise<{lat:number,lon:number,label:string}>{if(signal?.aborted)throw new DOMException('Location lookup cancelled','AbortError');const wait=Math.max(0,1100-(Date.now()-lastGeocode));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));if(signal?.aborted)throw new DOMException('Location lookup cancelled','AbortError');lastGeocode=Date.now();const url=new URL('https://nominatim.openstreetmap.org/search');url.search=new URLSearchParams({q:query,format:'jsonv2',limit:'1'}).toString();const controller=new AbortController(),abort=()=>controller.abort(),timeout=setTimeout(abort,8000);signal?.addEventListener('abort',abort,{once:true});try{const res=await fetch(url,{signal:controller.signal});if(!res.ok)throw new Error('Location lookup is unavailable right now. Please try again.');const results=await res.json();if(!results.length)throw new Error('We couldn’t find that place. Try adding a city or region.');return{lat:Number(results[0].lat),lon:Number(results[0].lon),label:results[0].display_name.split(',').slice(0,2).join(',')}}catch(error){if(signal?.aborted)throw error;if(controller.signal.aborted)throw new Error('Location lookup timed out. Please try again.');throw error}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}}
async function queryOverpass(endpoint:string,query:string,parentSignal?:AbortSignal):Promise<any[]>{const controller=new AbortController();const abort=()=>controller.abort();parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)controller.abort();try{const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query),signal:controller.signal,referrerPolicy:'unsafe-url'});if(!res.ok)throw new Error(`Overpass HTTP ${res.status}`);const data=await res.json();if(!Array.isArray(data.elements))throw new Error('Unexpected Overpass response');return data.elements}catch(error){if(parentSignal?.aborted)throw error;throw error}finally{parentSignal?.removeEventListener('abort',abort)}}
function readStoredNearbyCache():Record<string,{places:Place[],savedAt:number}>{try{if(typeof localStorage==='undefined')return{};const parsed=JSON.parse(localStorage.getItem(nearbyCacheStorageKey)||'{}');return parsed&&typeof parsed==='object'?parsed:{}}catch{return{}}}
function getCachedNearby(key:string):{places:Place[],savedAt:number}|undefined{return nearbyCache.get(key)||readStoredNearbyCache()[key]}
function saveNearby(key:string,places:Place[]):void{const cached={places,savedAt:Date.now()};nearbyCache.set(key,cached);if(nearbyCache.size>30){const oldest=[...nearbyCache.entries()].sort((a,b)=>a[1].savedAt-b[1].savedAt)[0]?.[0];if(oldest)nearbyCache.delete(oldest)}try{if(typeof localStorage==='undefined')return;const store=readStoredNearbyCache();store[key]=cached;const entries=Object.entries(store).sort((a,b)=>b[1].savedAt-a[1].savedAt).slice(0,30);localStorage.setItem(nearbyCacheStorageKey,JSON.stringify(Object.fromEntries(entries)))}catch{/* Search still works when browser storage is full or unavailable. */}}
function insideRing(lon:number,lat:number,ring:number[][]):boolean{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const[xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>lat)!==(yj>lat)&&lon<((xj-xi)*(lat-yi))/(yj-yi)+xi)inside=!inside}return inside}
function insideCoverage(lon:number,lat:number,coverage:PrebuiltDataset['coverage']):boolean{return coverage.coordinates.some(polygon=>insideRing(lon,lat,polygon[0])&&!polygon.slice(1).some(ring=>insideRing(lon,lat,ring)))}
function mayBeInHelsinkiMetro(lat:number,lon:number):boolean{return lat>=helsinkiMetroBounds.south&&lat<=helsinkiMetroBounds.north&&lon>=helsinkiMetroBounds.west&&lon<=helsinkiMetroBounds.east}
async function loadPrebuiltDataset():Promise<PrebuiltDataset|null>{if(!prebuiltDatasetPromise)prebuiltDatasetPromise=(async()=>{try{const response=await fetch(`${import.meta.env.BASE_URL}data/helsinki-metro.json`);if(!response.ok)return null;const data=await response.json();return data?.schema===1&&data?.coverage?.type==='MultiPolygon'&&Array.isArray(data?.places)?data as PrebuiltDataset:null}catch{return null}})();const result=await prebuiltDatasetPromise;if(!result)prebuiltDatasetPromise=null;return result}
export function filterNearby(places:Place[],query=''):Place[]{const term=query.trim().toLowerCase();return places.filter(place=>!term||`${place.name} ${place.tags.cuisine||''} ${place.tags.amenity||''} ${Object.entries(place.tags).filter(([key])=>key==='food'||key.startsWith('food:')||key.startsWith('diet:')).map(([key,value])=>`${key} ${value}`).join(' ')}`.toLowerCase().includes(term))}
export async function nearby(lat:number,lon:number,radius:number,query='',signal?:AbortSignal):Promise<Place[]>{
 if(signal?.aborted)throw new DOMException('Search cancelled','AbortError');
 const key=`${lat},${lon},${radius}`;
 if(mayBeInHelsinkiMetro(lat,lon)){
  const dataset=await loadPrebuiltDataset();
  if(signal?.aborted)throw new DOMException('Search cancelled','AbortError');
  if(dataset&&insideCoverage(lon,lat,dataset.coverage)){
   const places=dataset.places.map(place=>({id:place.id,name:place.name,lat:place.lat,lon:place.lon,tags:Object.fromEntries(Object.entries(place).filter(([key,value])=>!['id','name','lat','lon','photo'].includes(key)&&typeof value==='string')) as Record<string,string>,distance:haversine({lat,lon},place),photo:place.photo&&typeof place.photo==='object'?place.photo as PlacePhoto:undefined})).filter(place=>place.distance<=radius).sort((a,b)=>a.distance-b.distance);
   saveNearby(key,places);return filterNearby(places,query);
  }
 }
 const cached=getCachedNearby(key);
 if(cached&&Date.now()-cached.savedAt<nearbyCacheTtl)return filterNearby(cached.places,query);
 const q=nearbyQuery(lat,lon,radius),controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 try{
  const elements=await queryOverpass(overpassEndpoint,q,controller.signal);
  if(signal?.aborted)throw new DOMException('Search cancelled','AbortError');
  const places=elements.map((e:any)=>{const p=e.center||e;return{id:`osm:${e.type}/${e.id}`,name:e.tags?.name,lat:p.lat,lon:p.lon,tags:e.tags||{},distance:haversine({lat,lon},p)}}).filter((place:Place)=>place.name&&place.distance<=radius).sort((a:Place,b:Place)=>a.distance-b.distance);
  saveNearby(key,places);return filterNearby(places,query);
 }catch(error){if(signal?.aborted)throw error;if(cached&&Date.now()-cached.savedAt<nearbyStaleTtl)return filterNearby(cached.places.map(place=>({...place,stale:true})),query);const detail=error instanceof Error?error.message:'temporarily unavailable';throw new Error(`Nearby search ${detail}. Change location or try again.`)}finally{signal?.removeEventListener('abort',abort);controller.abort()}
}
