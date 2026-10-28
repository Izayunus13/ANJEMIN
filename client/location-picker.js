let activePicker=null,leafletPending=null,leafletStylePending=null;
const DEFAULT_CENTER={lat:-7.058,lng:110.441};
const DEFAULT_TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
function point(value){
 if(!value)return null;
 const lat=typeof value.lat==='function'?value.lat():value.lat;
 const lng=typeof value.lng==='function'?value.lng():value.lng;
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}
function leafletStyles(){
 if(leafletStylePending)return leafletStylePending;
 leafletStylePending=new Promise((resolve,reject)=>{
  const link=document.createElement('link');link.rel='stylesheet';
  link.href=new URL('./vendor/leaflet/leaflet.css',import.meta.url).href;
  const timer=setTimeout(()=>fail(),15000);
  function fail(){clearTimeout(timer);link.remove();reject(Error('Styles unavailable'));}
  link.onload=()=>{clearTimeout(timer);resolve();};link.onerror=fail;document.head.append(link);
 }).catch(error=>{leafletStylePending=null;throw error;});
 return leafletStylePending;
}
function loadLeaflet(){
 if(leafletPending)return leafletPending;
 const scriptReady=window.L?.map?Promise.resolve():new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.async=true;
  script.src=new URL('./vendor/leaflet/leaflet.js',import.meta.url).href;
  const timer=setTimeout(()=>fail(),15000);
  function fail(){clearTimeout(timer);script.remove();reject(Error('Map unavailable'));}
  script.onload=()=>{clearTimeout(timer);if(window.L?.map)resolve();else fail();};script.onerror=fail;
  document.head.append(script);
 });
 leafletPending=Promise.all([leafletStyles(),scriptReady]).then(()=>window.L).catch(error=>{leafletPending=null;throw error;});
 return leafletPending;
}

// Keep every edit in the dialog until the user explicitly confirms.
export function chooseLocation({title='Pilih lokasi',initial=null,initialAddress='',tileUrl=DEFAULT_TILES,locate=false,requireAddress=true}={}){
 if(activePicker)return activePicker;
 let resolve;
 const promise=new Promise(done=>{resolve=done;});activePicker=promise;
 const previousFocus=document.activeElement,previousOverflow=document.body.style.overflow;
 const dialog=document.createElement('dialog');dialog.className='location-picker';
 dialog.setAttribute('aria-labelledby','location-picker-title');dialog.setAttribute('aria-describedby','location-picker-description');
 dialog.innerHTML=`
 <header class="location-picker-head"><div><span class="kicker">OPENSTREETMAP</span><h2 id="location-picker-title"></h2><p id="location-picker-description">Ketuk peta atau geser pin. Tulis alamat dan patokan agar mudah ditemukan.</p></div><button type="button" class="iconbtn" data-lp-close aria-label="Tutup peta"><svg class="ico" aria-hidden="true"><use href="#i-x"></use></svg></button></header>
 <div class="location-picker-map-wrap"><div class="location-picker-map" aria-label="Peta untuk memilih lokasi"></div><div class="location-picker-map-state" role="status"><span class="spinner"></span><p>Memuat peta...</p><button type="button" class="button secondary tiny" data-lp-retry hidden>Coba muat peta lagi</button></div><button type="button" class="button secondary tiny location-picker-gps" data-lp-gps>Gunakan GPS saya</button><button type="button" class="button secondary tiny location-picker-center" data-lp-center disabled>Pilih tengah peta</button></div>
 <div class="location-picker-selection"><label for="location-picker-address"></label><textarea id="location-picker-address" rows="2" placeholder="Contoh: Gerbang selatan kampus, depan pos satpam."></textarea><p class="location-picker-accuracy" hidden></p><p class="location-picker-status" role="status" aria-live="polite">Pilih titik pada peta atau gunakan GPS, lalu tulis alamatnya.</p></div>
 <footer class="location-picker-footer"><a class="location-picker-external" target="_blank" rel="noopener noreferrer">Lihat di OpenStreetMap ↗</a><div><button type="button" class="button secondary" data-lp-cancel>Batal</button><button type="button" class="button" data-lp-apply disabled>Gunakan lokasi ini</button></div></footer>`;
 dialog.querySelector('h2').textContent=title;
 dialog.querySelector('.location-picker-selection label').textContent=requireAddress?'Alamat atau patokan lokasi':'Patokan lokasi (opsional)';
 const mapElement=dialog.querySelector('.location-picker-map'),fallback=dialog.querySelector('.location-picker-map-state');
 const retry=dialog.querySelector('[data-lp-retry]'),centerButton=dialog.querySelector('[data-lp-center]');
 const address=dialog.querySelector('textarea'),status=dialog.querySelector('.location-picker-status'),accuracy=dialog.querySelector('.location-picker-accuracy');
 const gps=dialog.querySelector('[data-lp-gps]'),apply=dialog.querySelector('[data-lp-apply]'),external=dialog.querySelector('a');
 let selected=point(initial),map=null,marker=null,closed=false,revision=0,loading=false;
 address.value=/^Titik (?:GPS|peta) \(/.test(initialAddress)?'':initialAddress;
 function update(){
  apply.disabled=!selected||(requireAddress&&address.value.trim().length<5);
  const p=selected||DEFAULT_CENTER;
  external.href='https://www.openstreetmap.org/?mlat='+p.lat+'&mlon='+p.lng+'#map=17/'+p.lat+'/'+p.lng;
 }
 function message(text,error=false){if(closed)return;status.textContent=text;status.classList.toggle('is-error',error);}
 function finish(value){
  if(closed)return;closed=true;revision++;
  map?.remove();
  document.body.style.overflow=previousOverflow;
  if(dialog.open)dialog.close();dialog.remove();activePicker=null;
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  resolve(value);
 }
 function select(value,gpsAccuracy=null){
  const coords=point(value);if(closed||!coords)return;
  selected=coords;revision++;
  accuracy.hidden=!(Number.isFinite(gpsAccuracy)&&gpsAccuracy>0);
  accuracy.textContent=accuracy.hidden?'':'Akurasi GPS sekitar '+Math.round(gpsAccuracy)+' meter. Sesuaikan pin bila perlu.';
  if(map){marker.setLatLng(coords).setOpacity(1);marker.dragging.enable();marker.getElement().tabIndex=0;map.panTo(coords);}
  update();
  message(requireAddress&&address.value.trim().length<5?'Titik sudah dipilih. Tulis alamat atau patokan di bawah.':'Periksa pin dan alamat, lalu gunakan lokasi ini.');
 }
 async function useGps(){
  if(gps.disabled||closed)return;
  if(!window.isSecureContext||!navigator.geolocation){message('GPS belum bisa diakses di browser ini. Pilih titik pada peta.',true);return;}
  gps.disabled=true;gps.textContent='Mencari lokasimu...';const before=revision;
  message('Mencari lokasi perangkat. Kamu tetap bisa memilih titik secara manual.');
  try{
   const position=await new Promise((done,fail)=>navigator.geolocation.getCurrentPosition(done,fail,{enableHighAccuracy:true,timeout:15000,maximumAge:30000}));
   if(!closed&&before===revision)select({lat:position.coords.latitude,lng:position.coords.longitude},position.coords.accuracy);
  }catch(error){
   if(!closed&&before===revision)message(error.code===1?'Izin GPS ditolak. Kamu tetap bisa mengetuk peta atau menggeser pin.':'GPS belum menemukan lokasimu. Kamu tetap bisa memilih titik pada peta.',true);
  }finally{if(!closed){gps.disabled=false;gps.textContent='Gunakan GPS saya';}}
 }
 async function load(){
  if(loading||map||closed)return;loading=true;
  retry.hidden=true;fallback.hidden=false;fallback.querySelector('.spinner').hidden=false;
  fallback.querySelector('p').textContent='Memuat peta...';
  try{
   const L=await loadLeaflet();if(closed)return;
   const start=selected||DEFAULT_CENTER;
   map=L.map(mapElement,{zoomControl:false,scrollWheelZoom:true}).setView(start,selected?17:14);
   L.control.zoom({zoomInTitle:'Perbesar peta',zoomOutTitle:'Perkecil peta'}).addTo(map);
   const tiles=L.tileLayer(tileUrl||DEFAULT_TILES,{
    maxZoom:19,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:1,
    referrerPolicy:'strict-origin-when-cross-origin',
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
   }).addTo(map);
   tiles.once('tileerror',()=>message('Sebagian peta belum termuat. Coba lagi, gunakan GPS, atau tulis alamat secara manual.',true));
   const icon=L.divIcon({className:'location-map-pin',iconSize:[34,44],iconAnchor:[17,44],
    html:'<svg viewBox="0 0 34 44" aria-hidden="true"><path d="M17 1C8.2 1 1 8.2 1 17c0 11 16 26 16 26s16-15 16-26C33 8.2 25.8 1 17 1Z" fill="currentColor" stroke="white" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="white"/></svg>'});
   marker=L.marker(start,{icon,draggable:true,autoPan:true,title:'Geser pin untuk mengatur lokasi',opacity:selected?1:0}).addTo(map);
   if(!selected){marker.dragging.disable();marker.getElement().tabIndex=-1;}
   map.on('click',event=>select(event.latlng));
   marker.on('dragend',()=>select(marker.getLatLng()));
   fallback.hidden=true;centerButton.disabled=false;
  }catch{
   if(map){map.remove();map=null;marker=null;}
   if(!closed){fallback.querySelector('.spinner').hidden=true;fallback.querySelector('p').textContent='Peta belum bisa dimuat. Gunakan GPS dan tulis alamat, atau lihat titik di OpenStreetMap.';retry.hidden=false;}
  }finally{loading=false;}
 }
 address.addEventListener('input',()=>{update();if(selected)message(requireAddress&&address.value.trim().length<5?'Titik sudah dipilih. Tulis alamat atau patokan di bawah.':'Periksa pin dan alamat, lalu gunakan lokasi ini.');});
 gps.addEventListener('click',()=>void useGps());retry.addEventListener('click',()=>void load());
 centerButton.addEventListener('click',()=>{if(map)select(map.getCenter());});
 dialog.querySelector('[data-lp-close]').addEventListener('click',()=>finish(null));
 dialog.querySelector('[data-lp-cancel]').addEventListener('click',()=>finish(null));
 apply.addEventListener('click',()=>{if(!apply.disabled&&selected)finish({...selected,address:address.value.trim()||'Lokasi pilihan'});});
 dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
 dialog.addEventListener('close',()=>finish(null));
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)finish(null);
 });
 document.body.append(dialog);document.body.style.overflow='hidden';dialog.showModal();update();void load();if(locate)void useGps();
 return promise;
}
