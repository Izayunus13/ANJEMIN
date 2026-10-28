import {chooseLocation} from './location-picker.js';
// ANJEMIN Frontend — Vanilla JavaScript, dimuat oleh Next.js setelah hidrasi.
const $=selector=>document.querySelector(selector);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'Rp'+Number(n||0).toLocaleString('en-US');
const ico=(name,cls='')=>`<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const state={user:null,config:null,page:'home',sideHidden:localStorage.getItem('anjemin-side')==='true',theme:localStorage.getItem('anjemin-theme')||'light',dropdown:false,modal:null,authTab:'login',authRole:'CUSTOMER',authVerified:false,authPhone:'',authOtpRequested:false,authOtpCode:'',authOtpResendAt:0,authOtpExpiresAt:0,authOtpVerifiedUntil:0,authOtpDevelopment:false,service:'RIDE',selectedPlace:null,coords:null,orders:[],listings:[],conversations:[],thread:null,activeChat:null,ready:false,stream:null,filter:'ALL'};
const labels={RIDE:'ANJEMIN',DELIVERY:'ANJEMIN Barang',JASTIP:'Jasa Titip',MARKET:'Marketplace'};
const icons={RIDE:'bike',DELIVERY:'package',JASTIP:'shopping',MARKET:'store'};
const subtitles={RIDE:'Mau pergi? Kita anterin.',DELIVERY:'Kirim paket, buku, sampai barang kos.',JASTIP:'Titip jajan dan kebutuhan harian.',MARKET:'Jual, beli, dan nego barang mahasiswa.'};
function toast(text,err=false){const item=document.createElement('div');item.className='toast'+(err?' err':'');item.textContent=text;$('#toast-area').append(item);setTimeout(()=>item.remove(),4600);}
async function api(url,opts={}){
 const r=await fetch(url,{credentials:'same-origin',...opts,headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}});
 let d={};try{d=await r.json();}catch{};
 if(r.status===401&&state.user)clearAccountSession('Sesi berakhir. Silakan masuk kembali.');
 if(d.code==='PROFILE_INCOMPLETE'&&state.user){state.user.profile_complete=false;go('profile');}
 if(!r.ok)throw Error(d.error||'Permintaan gagal.');return d;
}
const get=url=>api(url);
const post=(url,payload={})=>api(url,{method:'POST',body:JSON.stringify(payload)});
function setTheme(value){state.theme=value;document.documentElement.classList.toggle('dark',value==='dark');localStorage.setItem('anjemin-theme',value);document.querySelector('[name="theme-color"]')?.setAttribute('content',value==='dark'?'#171421':'#f9f6ff');}
function go(page,{keepSidebar=false}={}){
 if(profileNeeded()&&!['profile','privacy','terms','contact'].includes(page)){toast('Lengkapi profil dulu agar bisa mulai menggunakan ANJEMIN.');page='profile';}
 if(state.page==='profile'&&page!=='profile')releaseProfileDraft();
 const pageChanged=page!==state.page;
 const inMarketplace=['market','market-orders','market-history','chat'].includes(page);
 const submenu=$('#market-submenu'),arrow=$('.side-market-arrow');
 const closing=!inMarketplace&&submenu?{height:submenu.getBoundingClientRect().height,opacity:getComputedStyle(submenu).opacity,margin:getComputedStyle(submenu).marginBottom,arrow:arrow?getComputedStyle(arrow).transform:'none'}:null;
 state.page=page;state.marketMenuOpen=inMarketplace;state.dropdown=false;if(window.innerWidth<760&&!keepSidebar)state.sideHidden=true;window.scrollTo({top:0,behavior:'smooth'});render();if(pageChanged)$('#app main')?.classList.add('page-fade-enter');animateMarketplaceClose(closing);if(page==='market')loadListings();if(['market-orders','market-history'].includes(page))loadMarketOrders();if(page==='orders')loadOrders();if(page==='driver')loadDriverJobs();if(page==='chat')loadConversations();if(page==='admin')loadAdmin();if(page==='admin-profits')loadProfitStats();if(page==='admin-users')loadAdminUsers();if(['admin-reports','admin-driver-reports'].includes(page))loadOrderReports();if(page==='wallet')loadWallet();if(page==='achievements')loadAchievements();}
function requireLogin(){if(state.user)return true;openModal('auth');return false;}
function serviceTiles(){return `<div class="service-grid">${['RIDE','DELIVERY','JASTIP','MARKET'].map((v,i)=>`<article class="service-card" data-service="${v}" role="button" tabindex="0"><div class="service-icon">${ico(icons[v],'lg')}</div><h3>${labels[v]}</h3><p>${subtitles[v]}</p><span class="service-chevron">${ico('chevron','sm')}</span></article>`).join('')}</div>`;}
let headerWalletCache=null,headerWalletPending=null;
function headerWalletAmount(){return headerWalletCache?.userId===state.user?.id?'Rp '+Number(headerWalletCache.available).toLocaleString('id-ID'):'...';}
async function refreshHeaderWallet(force=false){
 if(state.user?.role!=='DRIVER')return;
 const userId=state.user.id;
 if(headerWalletPending?.userId===userId)return headerWalletPending.promise;
 if(!force&&headerWalletCache?.userId===userId&&Date.now()-headerWalletCache.updatedAt<15000)return;
 const request={userId};
 request.promise=(async()=>{
  try{
   const d=await get('/api/driver/wallet');
   if(state.user?.id!==userId||state.user?.role!=='DRIVER')return;
   headerWalletCache={userId,available:d.available,updatedAt:Date.now()};
   const el=$('#header-wallet-amount');if(el)el.textContent=headerWalletAmount();
  }catch{if(state.user?.id===userId){const el=$('#header-wallet-amount');if(el&&headerWalletCache?.userId!==userId)el.textContent='--';}}
  finally{if(headerWalletPending===request)headerWalletPending=null;}
 })();
 headerWalletPending=request;return request.promise;
}
function header(){return `<header class="site-head"><div class="head-wrap">
 ${state.user?`<button class="iconbtn sidebar-toggle" title="${state.sideHidden?'Tampilkan':'Sembunyikan'} sidebar" aria-label="${state.sideHidden?'Tampilkan':'Sembunyikan'} sidebar" aria-controls="app-sidebar" aria-expanded="${!state.sideHidden}" data-action="side"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path class="sidebar-toggle-arrow" d="m15 9-3 3 3 3"/></svg></button>`:''}
 <a href="#" class="brand" data-nav="home"><span class="brand-symbol brand-rider" aria-hidden="true"><svg class="brand-y2k" viewBox="0 0 60 60"><path d="M30 2 34 20 50 10 40 26 58 30 40 34 50 50 34 40 30 58 26 40 10 50 20 34 2 30 20 26 10 10 26 20Z"/></svg><svg class="brand-motor" viewBox="0 0 48 48" fill="none"><circle cx="12" cy="35" r="6" fill="var(--surface)" stroke="currentColor" stroke-width="3"/><circle cx="37" cy="35" r="6" fill="var(--surface)" stroke="currentColor" stroke-width="3"/><path d="M10 28h13l7 7H17l-6-5M32 23h5l3 12M32 23l-3-4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m22 17-5 9h9l4 6" stroke="var(--surface)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="m22 17-5 9h9l4 6m-8-15 7 7h6" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 10a6 6 0 0 1 12 0v3H18Z" fill="currentColor"/><path d="M23 10h7" stroke="var(--peach)" stroke-width="2.5" stroke-linecap="round"/><path d="M20 14a4 4 0 0 0 7 1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></span>ANJEMIN<span class="brand-dot">.</span></a>
 <div class="head-spacer"></div>${state.user?.role==='DRIVER'?'<button type="button" class="header-wallet" data-nav="wallet" title="Lihat saldo tersedia Penganjem"><span>Saldo :</span> <strong id="header-wallet-amount" aria-live="polite">'+headerWalletAmount()+'</strong></button>':''}<nav class="head-links"><a href="#layanan" data-anchor="layanan">Layanan</a><a href="#promo" data-anchor="promo">Promo</a><a href="#" data-nav="privacy">Privasi</a></nav>
 <button class="iconbtn" title="Mode terang/gelap" aria-label="Ganti tema" data-action="theme">${ico(state.theme==='dark'?'sun':'moon')}</button>
 ${state.user?`<details class="header-account-menu"><summary class="header-account" aria-label="Menu akun @${esc(state.user.username)}">${profileAvatar(state.user)}<span class="header-account-label">@${esc(state.user.username)}</span>${ico('chevron','sm account-menu-arrow')}</summary><div class="account-submenu">${['CUSTOMER','DRIVER'].includes(state.user.role)?'<button type="button" data-nav="profile">Profil</button>':''}<button type="button" data-action="change-password">Ganti Password</button><button type="button" class="account-logout" data-action="logout">Keluar</button></div></details>`:`<button class="button tiny" data-action="login">Masuk / Daftar</button>`}
 </div></header>`;}
function footer(){return `<footer class="footer"><div class="container"><div class="footer-grid">
 <div><a class="brand" href="#" data-nav="home">ANJEMIN<span class="brand-dot">.</span></a><p>Ekosistem layanan harian yang dirancang untuk memudahkan mobilitas, pengiriman, titip belanja, dan jual beli di lingkungan mahasiswa. Dibangun dengan semangat saling bantu dari Tembalang.</p><span class="tag">Mager? ANJEMIN Aja!</span></div>
 <div><h4>Jelajahi</h4><a href="#" data-service="RIDE">ANJEMIN</a><a href="#" data-service="DELIVERY">ANJEMIN Barang</a><a href="#" data-service="JASTIP">Jasa Titip</a><a href="#" data-nav="market">Marketplace</a></div>
 <div><h4>Informasi & Bantuan</h4><a href="#" data-nav="privacy">Kebijakan Privasi</a><a href="#" data-nav="terms">Syarat & Ketentuan</a><a href="#" data-nav="contact">Pusat Bantuan</a><a href="#" data-nav="home">Beranda</a></div>
 </div><div class="footer-end"><span>© ${new Date().getFullYear()} ANJEMIN. Hak cipta dilindungi.</span><span>Dirancang untuk komunitas, dikembangkan dengan perhatian pada keamanan · <strong>by ANJEMINAJA</strong></span></div></div></footer>`;}
function landing(){return `${header()}<main class="y2k-page">${y2kBackdrop()}<section class="hero"><div class="softblob"></div><div class="container"><div><span class="kicker">✦ Dari Tembalang, buat hari-harimu</span><h1>Gak perlu ribet.<br/><em>ANJEMIN</em> aja!</h1><p class="hero-description">Butuh anjem ke kampus, titip jajan, kirim barang, atau cari barang kos? Semuanya bisa di satu tempat yang terasa dekat dan gampang dipakai.</p><div class="hero-buttons"><button class="button" data-action="login">Mulai sekarang ${ico('chevron')}</button><button class="button secondary" data-anchor="layanan">Lihat layanan ${ico('chevron')}</button></div><div class="hero-tags" aria-label="Layanan ANJEMIN">${[['bike','Antar-jemput'],['package','Kirim barang'],['shopping','Jasa Titip'],['store','Marketplace']].map(([icon,title])=>`<a class="hero-service" href="#layanan" data-anchor="layanan">${ico(icon,'sm')}<strong>${title}</strong></a>`).join('')}</div></div>
 <div class="hero-art"><div class="rider-wrap"><img src="/anjemin-logo-transparent.png" alt="Ilustrasi pengendara motor ANJEMIN dan identitas merek"/></div><div class="phone-ui"><div class="phone-notch"></div><div class="phone-map" aria-hidden="true"><svg class="phone-journey" viewBox="0 0 155 194"><path class="journey-road" d="M40 36 61 119Q64 134 79 130L127 116"/><path class="journey-trail" d="M40 36 61 119Q64 134 79 130L127 116" pathLength="100"/><circle cx="40" cy="36" r="5" fill="#9470db"/><circle class="journey-beacon" cx="127" cy="116" r="11"/><circle cx="127" cy="116" r="5" fill="#ffb79d" stroke="white" stroke-width="2"/><g class="journey-traveler"><circle r="11" fill="#a486e0" opacity=".22"/><circle r="5.5" fill="#7555bd" stroke="white" stroke-width="2"/><animateMotion dur="5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.12;0.85;1" keyPoints="0;0;1;1" keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1" path="M40 36 61 119Q64 134 79 130L127 116"/></g></svg><span class="journey-live"><span></span>DALAM PERJALANAN</span></div><div class="phone-bottom">📍 Tujuanmu tinggal pilih!<br/><span class="muted">ANJEMIN siap bantu.</span></div></div><div class="float-card one">✨ Satu akun, empat layanan</div><div class="float-card two">🛵 Mager? ANJEMIN aja!</div></div></div><div class="hero-edge"></div></section>
 <section id="layanan" class="section"><div class="container"><span class="kicker">Kenalan dulu, yuk</span><h2 class="section-title">Mau ngapain hari ini?</h2><p class="section-copy">Dari perjalanan singkat sampai jual beli barang kebutuhan, pilih layanan yang paling pas buat kamu.</p>${serviceTiles()}</div></section>
 <section id="promo" class="section"><div class="container"><div class="promo"><div><span class="chip">PROMO REFERRAL</span><h2>Ajak temen, hemat barengan!</h2><p>Bagikan kode referral kamu. Pengguna baru bisa mendapat voucher Rp500 dan pengajak bisa memperoleh voucher Rp300 setelah syarat transaksi terpenuhi. Promo dapat berubah.</p><button class="button peach" data-action="login">Ambil kode referral ${ico('chevron','sm')}</button></div><div class="mockvoucher"><div>🎟️ VOUCHER ANJEMIN</div><strong>Rp500</strong><span>Hai, pengguna baru!</span></div></div></div></section>
 <section class="section"><div class="container"><span class="kicker">Tentang ANJEMIN</span><h2 class="section-title">Dekat dengan mahasiswa.<br/>Dibuat untuk keseharian.</h2><p class="section-copy">ANJEMIN dirancang sebagai ruang digital untuk saling membantu. Ada halaman penumpang, pengemudi terverifikasi, serta marketplace dengan ruang nego langsung. Platform ini masih tahap pengembangan; ketersediaan layanan dan tarif komersial menunggu verifikasi operasional.</p></div></section></main>${footer()}`;}
const menusFor=role=>role==='ADMIN'?[['home','Beranda','map'],['admin','Pengelola','store'],['admin-profits','Statistik Keuntungan','chart'],['admin-users','Data Pengguna','store'],['admin-reports','Laporan Transaksi','eye'],['admin-driver-reports','Laporan Penganjem','bike'],['privacy','Kebijakan Privasi','eye']]:role==='DRIVER'?[['home','Dashboard','map'],['driver','Tarik Order','bike'],['wallet','Saldo Penganjem','store'],['achievements','Pencapaian','trophy'],['market','Marketplace','store'],['orders','Riwayat','package'],['privacy','Privasi','eye']]:[['home','Beranda','map'],['service','Pesan Layanan','bike'],['market','Marketplace','store'],['orders','Pesananku','package'],['referral','Kode Referral','spark'],['privacy','Privasi','eye']];
function sidebar(){
 const editable=['CUSTOMER','DRIVER'].includes(state.user.role),tag=editable?'button':'div';
 return `<aside id="app-sidebar" class="sidebar" ${state.sideHidden?'inert':''}><div class="kicker" style="padding:6px 13px 13px">Menu ${state.user.role==='DRIVER'?'Penganjem':state.user.role==='ADMIN'?'Pengelola':'Customer'}</div>${menusFor(state.user.role).map(([v,l,i])=>sidebarMenuItem(v,l,i)).join('')}<div class="side-bottom"><${tag} class="side-profile ${editable?'side-profile-link':''}" ${editable?'type="button" data-nav="profile" aria-label="Buka profil saya"':''}>${profileAvatar(state.user,'side-profile-avatar')}<strong class="side-profile-name">${esc(state.user.full_name)}</strong><span class="side-profile-username">@${esc(state.user.username)}</span><span class="side-profile-role">${accountRole(state.user.role)}</span>${editable?'<span class="side-profile-edit">Lihat dan edit profil</span>':''}<span class="side-profile-credit">by ANJEMINAJA</span></${tag}></div></aside>`;
}
function authDashboard(){const u=state.user,driver=u.role==='DRIVER',admin=u.role==='ADMIN';return `<div class="dash-top"><div><span class="kicker">${driver?'PANEL PENGANJEM':admin?'PANEL DEVELOPER':'DASHBOARD CUSTOMER'}</span><h1>Halo, ${esc(u.full_name.split(' ')[0])}! 👋</h1><p>${driver?'Ada order baru? Nyalain Ready dulu.':admin?'Pantau layanan dan validasi akun driver.':'Mau dibantu apa hari ini?'}</p></div><button class="iconbtn" title="Notifikasi" data-action="notifications">${ico('bell')}</button></div><section class="dashboard-hero"><div class="dashboard-promo-copy" style="position:relative;z-index:2"><span class="chip">✦ ANJEMIN TODAY</span><h2>${driver?'Gas cari order, cuan bareng!':admin?'Semua layanan, satu kendali.':'Mager? Tenang, ANJEMIN aja!'}</h2><p>${driver?'Bantu mahasiswa sekitar kampus dengan layanan cepat dan terpercaya.':admin?'Statistik usaha, persetujuan driver, dan komisi dalam satu panel.':'Anjem, anterin barang, jastip, sampai berburu barang kos — semua lebih gampang.'}</p><button class="button peach tiny" data-nav="${driver?'driver':admin?'admin':'service'}">${driver?'Lihat order':'Mulai jelajah'} ${ico('chevron','sm')}</button></div><div class="dashboard-promo-art"><span class="promo-scene-glow" aria-hidden="true"></span>${dashboardPromoScene()}<span class="promo-scene-spark spark-one" aria-hidden="true">&#10022;</span><span class="promo-scene-spark spark-two" aria-hidden="true">&#10022;</span></div><div class="bubble">✦</div></section>
 <div class="card-head"><div><h2 class="section-title" style="font-size:25px;margin:0">${driver?'Layanan untuk Penganjem':'Pilih layanan favoritmu'}</h2><p class="muted small">Satu akun untuk kebutuhan yang beda-beda.</p></div></div>${serviceTiles()}
 <div class="promo" style="margin-top:27px;min-height:175px"><div><span class="chip">AJAK TEMAN</span><h2>Share kodenya, dapet hematnya!</h2><p>Kode referralmu: <strong>${esc(u.referral_code)}</strong></p><button class="button peach tiny" data-action="copy-referral">Salin kode ${ico('spark','sm')}</button></div><div class="mockvoucher"><div>KODE MILIKMU</div><strong style="font-size:27px">${esc(u.referral_code)}</strong><span>Siap dibagikan ✨</span></div></div>`;}
function loggedShell(content){return `${header()}<div class="app-shell ${state.sideHidden?'hidden-side':''}">${sidebar()}<main class="main-area y2k-page">${y2kBackdrop()}${content}</main></div>${footer()}`;}
function servicePage(){
 const options=['RIDE','DELIVERY','JASTIP'].map(type=>`<button type="button" class="booking-option ${state.serviceChosen&&state.service===type?'active':''}" data-service="${type}" aria-pressed="${!!state.serviceChosen&&state.service===type}">${ico(icons[type])}<strong>${labels[type]}</strong>${state.serviceChosen?'':`<span>${subtitles[type]}</span>`}</button>`).join('');
 if(!state.serviceChosen)return `<div class="dash-top"><div><span class="kicker">Pesan layanan</span><h1>Pilih layananmu</h1><p>Pilih layanan yang sesuai dengan kebutuhanmu.</p></div></div><div class="booking-choices">${options}</div>`;
 return `<nav class="booking-switcher" aria-label="Ganti layanan"><div>${options}</div></nav>${serviceForm()}`;
}
function serviceForm(type=state.service){if(type==='JASTIP'&&state.user?.role==='CUSTOMER')return jastipCustomerForm();return `<div class="dash-top"><div><span class="kicker">Pesan layanan</span><h1 style="font-weight:800">${labels[type]}</h1><p>${subtitles[type]}</p></div><span class="tag">Tarif contoh, belum penawaran resmi</span></div>
 <div class="split"><div class="card"><div class="card-head"><h3>Detail permintaanmu</h3><span class="tag">${ico(icons[type],'sm')} ${labels[type]}</span></div>
 <form id="order-form" data-type="${type}">${type==='RIDE'?`<fieldset class="vehicle-choice"><legend>Pilihan kendaraan *</legend><div class="vehicle-options"><label><input type="radio" name="vehicle_type" value="MOTOR" required checked/><span>Motor</span></label><label><input type="radio" name="vehicle_type" value="MOBIL" required/><span>Mobil</span></label></div></fieldset>`:''}<div class="field"><label>Lokasi jemput / pengambilan *</label><input name="pickup" required minlength="5" placeholder="Contoh: Kos Jl. Banjarsari..."/></div>
 <div class="form-actions" style="margin:-4px 0 15px"><button type="button" class="button secondary tiny" data-location-target="pickup">${ico('map','sm')} Pilih titik jemput</button><button type="button" class="button secondary tiny" data-action="gps">${ico('map','sm')} Gunakan GPS saya</button></div>
 ${type==='JASTIP'?`<div class="field"><label>Cari tempat titip (Google Places)</label><div class="form-actions" style="margin:0"><input id="place-query" style="flex:1;min-width:150px" placeholder="Contoh: ayam geprek, kopi, fotokopi"/><button type="button" class="button tiny" data-action="search-place">Cari</button></div></div><div id="place-results" class="places-list"><p class="form-hint">Hasil tempat muncul di sini, diurutkan berdasarkan rating, ulasan, dan pesanan ANJEMIN selesai.</p></div><input type="hidden" name="place_id" id="selected-place-id"/><input type="hidden" name="place_name" id="selected-place-name"/>`:''}
 <div class="field"><label>${type==='RIDE'?'Lokasi tujuan *':type==='JASTIP'?'Alamat pengantaran / penerima *':'Lokasi tujuan pengiriman *'}</label><input name="destination" id="destination" required minlength="5" placeholder="Tulis alamat atau pilih lokasi dari peta"/></div><div class="location-field-actions"><button type="button" class="button secondary tiny" data-location-target="destination">${ico('map','sm')} Pilih titik antar</button></div>
 ${type!=='RIDE'?`<div class="field"><label>${type==='JASTIP'?'Mau titip apa?':'Nama barang'} *</label><input name="item_name" required placeholder="Contoh: buku, nasi ayam, charger..."/></div>`:''}
 ${type==='DELIVERY'?`<div class="form-row"><div class="field"><label>Tipe barang *</label><select name="item_category" required><option value="">Pilih tipe</option><option>Dokumen</option><option>Elektronik</option><option>Pakaian</option><option>Buku</option><option>Lainnya</option></select></div><div class="field"><label>Berat (kg) *</label><input type="number" name="item_weight" step="0.1" min="0.1" max="100" required placeholder="0.5"/></div></div><div class="field"><label>Foto barang (PNG/JPG/WebP, maks 4MB) *</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp" required/></div>`:''}
 <div class="form-row"><div class="field"><label>Estimasi tarif (Rp) *</label><input name="fare" type="text" inputmode="numeric" data-money="true" required data-min="1000" data-max="5000000" value="6,000"/></div><div class="field"><label>Voucher aktif</label><select name="voucher_id" id="voucher-select"><option value="">Tanpa voucher</option></select></div></div>
 <div class="field"><label>Catatan tambahan</label><textarea name="notes" placeholder="Patokan lokasi, detail barang, instruksi driver..."></textarea></div>
 <div class="note warning">Tarif Rp6.000 hanya simulasi MVP, bukan tarif resmi untuk ojek online. Driver harus memenuhi ketentuan keselamatan dan tarif sebelum layanan komersial dibuka. Pembayaran tersedia setelah penganjem menerima pesanan. Dana ditahan sampai kamu mengonfirmasi selesai.</div>
 <button class="button full" type="submit">${ico('bike')} Cari Penganjem</button></form></div>
 <div class="card"><div class="card-head"><h3>Tentukan lokasi antar</h3><span class="tag">OpenStreetMap</span></div><div class="location-preview">${ico('map')}<p data-location-summary="destination">Titik tujuan belum dipilih. Kamu juga bisa menulis alamat.</p><button type="button" class="button" data-location-target="destination">Buka peta tujuan</button></div><p class="form-hint" style="margin-top:14px">Ketuk peta atau geser pin pada popup, lalu tulis alamat dan patokannya. Lokasi diterapkan setelah kamu mengonfirmasinya.</p></div></div>`;}
function marketPage(){return `<div class="dash-top"><div><span class="kicker">Student Marketplace</span><h1>Lapak mahasiswa 🛍️</h1><p>Cari barang incaran, tawar langsung dengan penjual, atau buka lapakmu sendiri.</p></div><button class="button" data-action="add-listing">+ Jual barang</button></div><div class="card"><div class="form-row"><div class="field" style="margin:0"><label>Cari barang</label><input id="market-query" placeholder="Laptop, kipas, buku, sepatu..."/></div><div class="field" style="margin:0"><label>Kategori</label><select id="market-category"><option value="ALL">Semua kategori</option>${categories.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div></div><div id="market-results" class="product-grid"><div class="center-loader"><span class="spinner"></span></div></div><div class="note">Checkout dan bayar lewat website. Dana ditahan sampai barang diterima dan pembeli menyelesaikan transaksi. Saat ini pembayaran marketplace menggunakan simulasi, tanpa uang sungguhan.</div>`;}
const categories=['Fashion','Sepatu','Preloved','Kosmetik','Barang Kos','Elektronik','Buku & Alat Tulis','Kendaraan','Hobi','Asap (belum dibuka)','Lainnya'];
function imageUrl(name){return '/api/image/'+encodeURIComponent(name||'');}
function orderStatus(s){return {OPEN:'Menunggu',CLAIMED:'Diambil driver',COMPLETED:'Selesai',CANCELLED:'Dibatalkan'}[s]||s;}
function customerOrders(){return `<div class="dash-top"><div><span class="kicker">Aktivitas</span><h1>Riwayat pesanan</h1><p>Order ANJEMIN, Barang, dan Jastip milikmu.</p></div><button class="button secondary tiny" data-action="refresh-orders">Refresh</button></div><div id="wallet-summary"></div><div class="note">${paymentEnvironment(state.config?.paymentMode)} Dana dilepas setelah customer mengonfirmasi selesai.</div><div class="card" id="orders-results">Memuat...</div>`;}
function driverPage(){let approved=state.user.driver_status==='APPROVED';let ready=state.ready;return `<div class="dash-top"><div><span class="kicker">PANEL PENGANJEM</span><h1>Tarik Anjeman 🛵</h1><p>Order tersedia untuk driver yang sudah disetujui dan Ready.</p></div><span class="tag ${approved?'success':'warning'}">${approved?'Terverifikasi':'Verifikasi: '+state.user.driver_status}</span></div>
 <div class="switch-row ${ready?'on':'off'}"><div><strong>${ready?'READY ANJEM':'NOT READY ANJEM'}</strong><div class="small">${!approved?'Menunggu verifikasi KTM, email kampus, dan kendaraan oleh pengelola.':ready?'Kamu akan menerima notifikasi order baru secara langsung.':'Aktifkan saat siap mengambil pesanan.'}</div></div><button role="switch" aria-checked="${ready}" class="switch" data-action="toggle-ready" ${!approved?'disabled':''} title="Ubah ketersediaan"></button></div>
 <div class="service-grid" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr));margin:0 0 27px">${[['RIDE','Tarik Anjeman'],['JASTIP','Tarik Jasa Titip'],['DELIVERY','Tarik Barang'],['MARKET','Marketplace']].map(([type,label])=>`<div class="service-card" data-driverfilter="${type}" tabindex="0" role="button" style="min-height:150px;padding:17px"><div class="service-icon" style="margin-bottom:10px">${ico(icons[type])}</div><h3 style="font-size:13px">${label}</h3><p>${type==='MARKET'?'Jual dan beli barang':'Pantau order masuk'}</p></div>`).join('')}</div>
 <div class="card"><div class="card-head"><h3>Order masuk <span id="driver-count" class="tag">0</span></h3><button class="button secondary tiny" data-action="refresh-driver">Refresh</button></div><div class="form-row"><div class="field"><label for="driver-sort">Urutkan order</label><select id="driver-sort">${[['NEWEST','Urutan masuk'],['NEAREST','Terdekat dengan saya (GPS)'],['PRICE_HIGH','Harga tertinggi'],['PRICE_LOW','Harga terendah']].map(([v,l])=>`<option value="${v}" ${(state.driverSort||'NEWEST')===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label for="driver-type">Jenis layanan</label><select id="driver-type">${[['','Semua layanan'],['RIDE','ANJEMIN'],['JASTIP','Jasa Titip'],['DELIVERY','ANJEMIN Barang']].map(([v,l])=>`<option value="${v}" ${(state.driverFilter||'')===v?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="actions"><button class="button secondary tiny" data-action="driver-gps">Perbarui lokasi saya</button><span id="driver-gps-status" class="small muted" aria-live="polite">${esc(state.driverGpsMessage||'Pilih Terdekat untuk mengaktifkan GPS.')}</span></div><div id="driver-results"><p class="muted small">Aktifkan Ready untuk melihat order.</p></div></div>`;}
function referralPage(){return `<div class="dash-top"><div><span class="kicker">Ajak teman</span><h1>Referral ANJEMIN ✨</h1><p>Kamu dan teman bisa dapat promo. Kodenya tinggal salin!</p></div></div><div class="promo"><div><span class="chip">KODE PRIBADI</span><h2>${esc(state.user.referral_code)}</h2><p>Bagikan saat teman mendaftar. Teman dapat voucher Rp500, kamu dapat Rp300 setelah teman menyelesaikan perjalanan pertamanya. Voucher 7 hari.</p><button class="button peach" data-action="copy-referral">Salin kode referral</button></div><div class="mockvoucher">🎁<strong>Hemat!</strong>Bagikan ke temanmu</div></div><div class="card" style="margin-top:24px"><h3>Voucher milikku</h3><div id="voucher-results" class="muted small">Memuat...</div></div>`;}
function chatPage(){return `<div class="dash-top"><div><span class="kicker">Marketplace</span><h1>Chat & Nego 💬</h1><p>Tawar harga dan diskusi langsung sesama pengguna.</p></div></div><div class="card"><div class="chat-layout"><div id="chat-list" class="chat-list">Memuat chat...</div><div id="chat-detail"><div class="center-loader" style="height:360px">Pilih chat untuk mulai negosiasi.</div></div></div></div>`;}
function adminPage(){return `<div class="dash-top"><div><span class="kicker">DEVELOPER / PENGELOLA</span><h1>Management Center</h1><p>Persetujuan driver, data transaksi, dan audit komisi yang sudah tercatat.</p></div><button class="button secondary tiny" data-action="refresh-admin">Refresh laporan</button></div><div class="summary-grid" id="admin-stats"><div class="center-loader">Memuat statistik...</div></div><div class="card"><h3>Verifikasi calon Penganjem</h3><div id="admin-drivers">Memuat...</div></div><div class="card" style="margin-top:20px"><h3>${state.config?.paymentMode==='SIMULATION'?'Komisi simulasi (data uji)':'Pencatatan komisi (bukan dana otomatis diterima)'}</h3><div class="note warning">${state.config?.paymentMode==='SIMULATION'?'Mode SIMULASI: komisi pembayaran website otomatis tercatat setelah pembeli atau customer menyelesaikan transaksi. Semua nominal adalah data uji.':''} "Komisi tercatat" belum berarti uang sudah diterima developer. Untuk COD diperlukan rekonsiliasi dan penagihan yang transparan. Tombol "Catat diterima" khusus operator setelah pembayaran diverifikasi.</div><div id="admin-ledger">Memuat...</div></div>`;}
function contactPage(){return `<div class="legal"><span class="kicker">Bantuan pengguna</span><h1>Pusat Bantuan</h1><p>Kontak resmi ANJEMIN harus diisi pengelola sebelum membuka platform untuk publik.</p><div class="card"><h3>Hubungi pengelola</h3><p>Email: ${state.config?.supportEmail?esc(state.config.supportEmail):'<em>Belum ditentukan</em>'}</p><p>WhatsApp: ${state.config?.supportWhatsapp?esc(state.config.supportWhatsapp):'<em>Belum ditentukan</em>'}</p><p class="form-hint">Jangan menggunakan kontak dari situs referensi: ANJEMIN adalah pengelola berbeda.</p></div></div>`;}
function privacyPage(){return `<div class="legal"><span class="kicker">Dokumen informasi pengguna · Draft 0.1</span><h1>Kebijakan Privasi ANJEMIN</h1><p class="muted">Terakhir disusun: 21 Oktober 2026 · Berlaku setelah pengelola meninjau dan menerbitkan kebijakan final.</p><aside><strong>Catatan sebelum peluncuran:</strong> Ini draf orisinal untuk implementasi ANJEMIN, bukan salinan Anjem.me. Lengkapi identitas badan/penanggung jawab, alamat kontak resmi, jangka retensi data, vendor pembayaran, dan prosedur hak pengguna. Minta tinjauan hukum sebelum digunakan untuk layanan komersial.</aside>
 <article><h2>01. Tentang layanan dan penanggung jawab</h2><p>ANJEMIN adalah rancangan platform yang menghubungkan pengguna dengan layanan antar-jemput, antar barang, jasa titip, dan jual beli produk antarpengguna. Pengelola memutuskan tujuan dan cara pemrosesan data yang terjadi di aplikasi. Identitas lengkap pengelola dan saluran kontak akan diumumkan sebelum layanan publik diaktifkan.</p></article>
 <article><h2>02. Informasi yang diberikan saat membuat akun</h2><p>Kami meminta nama lengkap, nama pengguna, email, nomor telepon yang diverifikasi melalui kode sekali pakai, dan kata sandi yang disimpan dalam bentuk hash, bukan teks asli. Nomor yang telah digunakan tidak dapat dipakai untuk akun kedua.</p></article>
 <article><h2>03. Informasi calon Penganjem</h2><p>Pendaftaran Penganjem membutuhkan foto KTM, email kampus, keterangan kendaraan, pilihan SIM A atau SIM C, foto SIM, serta pernyataan mengenai kelayakan berkendara. Berkas KTM dan SIM disimpan dalam ruang privat yang hanya dapat diakses Pengelola terotorisasi untuk verifikasi. Pernyataan mandiri tidak menggantikan pemeriksaan dan ketentuan keselamatan berkendara.</p></article>
 <article><h2>04. Aktivitas pemesanan dan marketplace</h2><p>Sistem memproses titik jemput, alamat tujuan, rincian barang kiriman atau jastip, harga, status pesanan, dan catatan layanan. Untuk marketplace, kami menyimpan informasi barang, foto, harga, identitas akun penjual, data reservasi, dan percakapan negosiasi di dalam aplikasi. Profil akun juga menyimpan foto profil. Nama, username, dan foto profil dapat ditampilkan kepada pengguna yang masuk saat bertransaksi; nomor telepon dan email tetap terbatas untuk pemilik akun dan Pengelola.</p></article>
 <article><h2>05. Lokasi dan akses perangkat</h2><p>Pengambilan lokasi GPS terjadi saat pengguna menekan tombol lokasi serta memberikan izin dari browser. Lokasi digunakan untuk memilih titik jemput, antar, belanja, atau lokasi Penganjem. Popup peta memakai OpenStreetMap; penyedia tile menerima IP, origin situs, dan area peta yang dilihat saat peta dibuka. Alamat dan patokan yang diketik tidak dikirim untuk geocoding. Apabila Google Maps/Places diaktifkan, data permintaan lokasi dan pencarian tertentu dapat diproses oleh Google sesuai kebijakan penyedianya. Izin bisa dicabut dari pengaturan browser.</p></article>
 <article><h2>06. Alasan penggunaan data</h2><p>Data digunakan untuk membuat akun, mengonfirmasi nomor telepon, memfasilitasi transaksi, mempertemukan pelanggan dengan pengemudi, memproses permintaan pengguna, mencegah penyalahgunaan referral, dan menangani pengaduan. Penggunaan data memerlukan dasar pemrosesan yang sesuai hukum, termasuk pelaksanaan perjanjian, persetujuan bila relevan, atau kewajiban hukum.</p></article>
 <article><h2>07. Pihak yang menerima data</h2><p>Identitas dan informasi pesanan yang diperlukan dibagikan secara terbatas kepada pihak yang menjalankan transaksi. Penyedia server, layanan SMS, serta Google Maps/Places dapat memproses data teknis sesuai kontrak dan pengaturannya. Kami tidak menyatakan menjual data pribadi pengguna. Penerima data aktual harus didata dalam kebijakan final.</p></article>
 <article><h2>08. Pengamanan dan pembatasan akses</h2><p>Platform menggunakan autentikasi cookie HttpOnly, hash kata sandi, pembatasan percobaan login/OTP, persetujuan driver oleh admin, dan pembatasan akses foto KTM. Penggunaan HTTPS, backup, monitoring, dan konfigurasi operasional harus dipastikan ketika ditempatkan di server produksi.</p></article>
 <article><h2>09. Masa penyimpanan dan penghapusan</h2><p>Data disimpan selama diperlukan untuk menjalankan layanan, memenuhi kewajiban yang sah, dan menyelesaikan sengketa. Masa retensi rinci, cara menghapus akun, salinan cadangan, dan prosedur penghancuran berkas KTM harus diputuskan serta diterapkan oleh pengelola sebelum layanan publik.</p></article>
 <article><h2>10. Hak dan permintaan pengguna</h2><p>Pengguna dapat meminta akses, perbaikan, penjelasan pemrosesan, penarikan persetujuan yang relevan, atau penghapusan data sesuai peraturan berlaku. Prosedur pengajuan akan disediakan lewat kontak resmi pada halaman bantuan, termasuk verifikasi identitas pemohon.</p></article>
 <article><h2>11. Penggunaan cookie dan sesi</h2><p>Cookie sesi dipakai untuk mempertahankan login. Penyimpanan lokal perangkat digunakan untuk mengingat preferensi tema dan keadaan sidebar. Sistem MVP ini tidak memasang pelacak pemasaran pihak ketiga.</p></article>
 <article><h2>12. Keamanan pengguna muda dan transaksi</h2><p>ANJEMIN dirancang terutama untuk mahasiswa. Pengguna yang belum memenuhi persyaratan usia dan keselamatan untuk jasa transportasi tidak boleh menjadi driver. Barang terlarang atau membutuhkan izin khusus tidak diperkenankan dijual tanpa kepatuhan yang berlaku. Sengketa transaksi dapat dilaporkan kepada pengelola.</p></article>
 <article><h2>13. Perubahan kebijakan dan komunikasi</h2><p>Pembaruan substantif akan ditampilkan di aplikasi sebelum berlaku. Kontak pengelola ANJEMIN wajib diumumkan agar pengguna mengetahui kepada siapa mereka dapat bertanya tentang data pribadi.</p></article>
 <article><h2>14. Landasan kepatuhan</h2><p>Pengelola perlu menilai kewajiban berdasarkan UU Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, aturan penyelenggaraan sistem elektronik, regulasi perdagangan melalui sistem elektronik, serta ketentuan terkait transportasi dan keselamatan. Dokumen ini bukan jaminan bahwa kewajiban perizinan sudah terpenuhi.</p></article></div>`;}
function termsPage(){return `<div class="legal"><span class="kicker">Dokumen pengguna · Draft</span><h1>Syarat & Ketentuan</h1><aside>Halaman ini masih rancangan untuk pengujian teknis dan harus disahkan pengelola sebelum layanan komersial.</aside><article><h2>Akun dan keamanan</h2><p>Pengguna harus memberikan informasi yang benar, menjaga keamanan akses, dan tidak menggunakan nomor orang lain. Penganjem hanya dapat menerima order setelah persetujuan pengelola.</p></article><article><h2>Transaksi dan biaya</h2><p>Komisi internal yang dimodelkan pada MVP adalah 6% dari jasa Anjem/Anterin/Jastip dan 3% marketplace maksimal Rp20.000. Semua tarif, biaya pihak ketiga, hak driver, dan mekanisme komersial wajib divalidasi sebelum penggunaan nyata. Layanan demo saat ini tidak memproses dana secara online.</p></article><article><h2>Jual beli dan jastip</h2><p>Pengguna bertanggung jawab atas keaslian foto, rincian, kondisi barang, dan kesepakatan serah terima. Pada alur pembayaran website, dana ditahan sampai pembeli mengonfirmasi barang diterima. Fitur marketplace ini masih simulasi; belum memproses uang sungguhan.</p></article><article><h2>Keselamatan</h2><p>Driver wajib memenuhi dokumen serta standar keselamatan yang relevan. Platform tidak boleh dioperasikan secara komersial sebelum prosedur darurat, penanganan komplain, dan kepatuhan hukum siap.</p></article></div>`;}
function render(){
 if(profileNeeded()&&!['profile','privacy','terms','contact'].includes(state.page))state.page='profile';
 const page=state.page;
 let body;
 if(!state.user){body=page==='privacy'?`${header()}${privacyPage()}${footer()}`:page==='terms'?`${header()}${termsPage()}${footer()}`:page==='contact'?`${header()}${contactPage()}${footer()}`:landing();}
 else if(page==='privacy')body=loggedShell(privacyPage());
 else if(page==='terms')body=loggedShell(termsPage());
 else if(page==='contact')body=loggedShell(contactPage());
 else if(page==='profile'&&['CUSTOMER','DRIVER'].includes(state.user.role))body=loggedShell(accountProfilePage());
 else if(page==='service')body=loggedShell(servicePage());
 else if(page==='market')body=loggedShell(marketPage());
 else if(page==='market-orders'&&['CUSTOMER','DRIVER'].includes(state.user.role))body=loggedShell(marketOrdersPage());
 else if(page==='market-history'&&['CUSTOMER','DRIVER'].includes(state.user.role))body=loggedShell(marketOrdersPage(true));
 else if(page==='orders')body=loggedShell(customerOrders());
 else if(page==='wallet'&&state.user.role==='DRIVER')body=loggedShell(walletPage());
 else if(page==='achievements'&&state.user.role==='DRIVER')body=loggedShell(achievementsPage());
 else if(page==='driver'&&state.user.role==='DRIVER')body=loggedShell(driverPage());
 else if(page==='admin-driver-reports'&&state.user.role==='ADMIN')body=loggedShell(orderReportsPage(true));
 else if(page==='admin-reports'&&state.user.role==='ADMIN')body=loggedShell(orderReportsPage());
 else if(page==='admin-users'&&state.user.role==='ADMIN')body=loggedShell(adminUsersPage());
 else if(page==='admin-profits'&&state.user.role==='ADMIN')body=loggedShell(profitStatsPage());
 else if(page==='admin'&&state.user.role==='ADMIN')body=loggedShell(adminPage());
 else if(page==='chat')body=loggedShell(chatPage());
 else if(page==='referral')body=loggedShell(referralPage());
 else body=loggedShell(authDashboard());
 $('#app').innerHTML=body;
 const landingHero=$('.hero');if(landingHero)landingHero.insertAdjacentHTML('afterbegin',landingSceneBackdrop());
 const dashboardHero=$('.dashboard-hero');if(dashboardHero)dashboardHero.insertAdjacentHTML('afterbegin',dashboardCityBackdrop());
 if(state.user?.role==='DRIVER')refreshHeaderWallet();
 renderModal();
 if(page==='profile'&&state.user)refreshProfilePhoneStatus();
 if(page==='service'&&state.user&&state.serviceChosen){populateVouchers();if(!$('#order-form[data-jastip-form]')){if(state.service==='JASTIP'&&state.config?.placesEnabled){const q=$('#place-query');if(q){q.value='makanan';searchPlaces().catch(()=>{});}}}}
 if(page==='referral'&&state.user)populateReferralVouchers();
}
function openModal(which,extra={}){cleanupOrderChatReceipts();releaseOrderChatAttachment();clearTimeout(orderChatTimer);releaseListingPhotos();state.modal={which,...extra};renderModal();}
let activeConfirmation=null;
function confirmAction({title='Konfirmasi tindakan',message='',confirmLabel='Lanjutkan',cancelLabel='Kembali',danger=false}={}){
 if(activeConfirmation)return Promise.resolve(false);
 const root=$('#modal-root');if(!root)return Promise.resolve(false);
 const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const blocked=[$('#app'),...root.children].filter(Boolean).map(element=>({element,inert:element.inert,ariaHidden:element.getAttribute('aria-hidden')}));
 for(const {element} of blocked){element.inert=true;element.setAttribute('aria-hidden','true');}
 const overlay=document.createElement('div');overlay.className='discard-confirm-scrim';
 overlay.innerHTML=`<section class="discard-confirm" role="alertdialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-copy"><span class="discard-confirm-icon ${danger?'is-danger':'is-primary'}" aria-hidden="true">${ico(danger?'x':'check','lg')}</span><h2 id="action-confirm-title">${esc(title)}</h2><p id="action-confirm-copy">${esc(message)}</p><div class="discard-confirm-actions"><button type="button" class="button secondary" data-confirm-cancel>${esc(cancelLabel)}</button><button type="button" class="button ${danger?'discard-danger':''}" data-confirm-accept>${esc(confirmLabel)}</button></div></section>`;
 root.append(overlay);
 return new Promise(resolve=>{
  const finish=accepted=>{
   if(activeConfirmation?.overlay!==overlay)return;
   overlay.remove();
   for(const {element,inert,ariaHidden} of blocked){element.inert=inert;if(ariaHidden===null)element.removeAttribute('aria-hidden');else element.setAttribute('aria-hidden',ariaHidden);}
   activeConfirmation=null;if(returnFocus?.isConnected)returnFocus.focus();resolve(accepted);
  };
  activeConfirmation={overlay,finish};
  overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest('[data-confirm-cancel]'))finish(false);else if(event.target.closest('[data-confirm-accept]'))finish(true);});
  queueMicrotask(()=>overlay.querySelector('[data-confirm-cancel]')?.focus());
 });
}
function discardModalChanges(){
 const root=$('#modal-root');
 root?.querySelectorAll('input[type="password"]').forEach(input=>{input.value='';input.defaultValue='';});
 root?.querySelectorAll('form').forEach(form=>form.reset());
 if(state.modal?.which==='auth')clearSignupOtpState();
 closeModal();
}
async function requestCloseModal(){
 if(!state.modal||activeConfirmation)return;
 const hasForm=!!$('#modal-root')?.querySelector('form');
 if(hasForm){
  const discard=await confirmAction({title:'Batalkan pengisian?',message:'Data yang belum disimpan akan hilang. Kamu masih bisa kembali dan melanjutkan pengisian.',confirmLabel:'Buang perubahan',cancelLabel:'Lanjut mengisi',danger:true});
  if(discard&&state.modal)discardModalChanges();return;
 }
 closeModal();
}
function closeModal(){if(activeConfirmation)activeConfirmation.finish(false);cleanupOrderChatReceipts();releaseOrderChatAttachment();releaseListingPhotos();clearTimeout(orderChatTimer);stopSignupOtpTimer();state.modal=null;$('#modal-root').innerHTML='';}
function renderModal(){const m=state.modal;if(!m){$('#modal-root').innerHTML='';return;}
 if(m.which==='user-profile'){renderPublicProfile(m);return;}
 if(m.which==='account-status'){renderAccountStatusForm(m);return;}
 if(m.which==='report'){renderOrderReportForm(m.id);return;}
 if(m.which==='market-withdrawal'){renderMarketWithdrawal(m);return;}
 if(m.which==='market-payment'){renderMarketPaymentModal(m.id);return;}
 if(m.which==='payment'){renderPaymentModal(m.id);return;}
 if(m.which==='order-chat'){renderOrderChat(m.id);return;}
 if(m.which==='change-password'){renderChangePassword();return;}
 if(m.which==='auth'){renderAuthModal();return;}
 if(m.which==='listing'){renderListingModal();return;}
 if(m.which==='notifications'){$('#modal-root').innerHTML=modalWrap('Notifikasi',`<p class="muted small">${state.user?.role==='DRIVER'?'Aktifkan Ready agar menerima pemberitahuan order baru dari sistem realtime.':'Pantau order melalui menu Riwayat Pesanan.'}</p>`);return;}
 if(m.which==='detail'){$('#modal-root').innerHTML=modalWrap('Detail barang',listingDetailHtml(m.item));return;}
}
function modalWrap(title,inside,wide=false){return `<div class="modal-scrim" data-action="scrim"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="iconbtn" data-action="close-modal" aria-label="Tutup">${ico('x')}</button></div>${inside}</section></div>`;}
function rememberedLogin(){try{return localStorage.getItem('anjemin-login-identifier')||'';}catch{return '';}}
function normalizedAuthPhone(value){
 const clean=String(value||'').replace(/[\s.()-]/g,'');
 return clean.startsWith('0')?'62'+clean.slice(1):clean.startsWith('+')?clean.slice(1):clean;
}
function maskedAuthPhone(value){
 const phone=normalizedAuthPhone(value);
 if(!phone)return 'nomor yang kamu masukkan';
 const local=phone.startsWith('62')?phone.slice(2):phone;
 if(local.length<7)return '+'+phone;
 return `${phone.startsWith('62')?'+62 ':'+'}${local.slice(0,3)} •••• ${local.slice(-4)}`;
}
function otpClock(seconds){const safe=Math.max(0,Number(seconds)||0);return `${String(Math.floor(safe/60)).padStart(2,'0')}:${String(safe%60).padStart(2,'0')}`;}
function signupOtpPanel(){
 const requested=state.authOtpRequested,verified=state.authVerified;
 return `<section id="signup-otp-panel" class="otp-panel ${requested?'is-sent':''} ${verified?'is-verified':''}" aria-labelledby="signup-otp-title">
  <div class="otp-panel-head"><span id="otp-panel-icon" class="otp-panel-icon">${ico(verified?'check':'lock')}</span><div><span class="otp-eyebrow">KEAMANAN AKUN</span><h3 id="signup-otp-title">Verifikasi nomor HP</h3><p id="otp-panel-description">${verified?'Nomormu sudah siap digunakan untuk akun ANJEMIN.':'Kami akan mengirim kode rahasia melalui SMS.'}</p></div><span id="otp-state-badge" class="otp-state-badge ${verified?'is-success':''}">${verified?'Terverifikasi':requested?'Menunggu kode':'Belum dikirim'}</span></div>
  <div id="otp-idle" class="otp-idle" ${requested?'hidden':''}><button type="button" class="button secondary full otp-send-button" data-action="request-otp">${ico('chat','sm')} Kirim kode OTP</button><p>Pastikan nomor aktif dan dapat menerima SMS.</p></div>
  <div id="otp-challenge" class="otp-challenge" ${!requested||verified?'hidden':''}>
   <div class="otp-delivery-line"><span class="otp-delivery-pulse" aria-hidden="true"></span><span>Kode dikirim ke <strong id="otp-destination">${esc(maskedAuthPhone(state.authPhone))}</strong></span><span id="otp-expiry-clock" class="otp-expiry-clock">Berlaku 05:00</span></div>
   <div class="field otp-code-field"><label for="signup-otp">Masukkan 6 digit kode</label><input id="signup-otp" class="otp-code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" enterkeyhint="done" placeholder="------" value="${esc(state.authOtpCode)}" aria-describedby="otp-confirmation otp-security-note"/></div>
   <button type="button" class="button full otp-verify-button" data-action="verify-otp" ${state.authOtpCode.length===6?'':'disabled'}>${ico('check','sm')} Verifikasi nomor</button>
   <div class="otp-resend-row"><span>Belum menerima SMS?</span><button type="button" data-action="request-otp" data-otp-resend>Kirim ulang</button><span id="otp-resend-clock" aria-hidden="true"></span></div>
  </div>
  <div id="otp-success" class="otp-success" tabindex="-1" ${verified?'':'hidden'}><span>${ico('check')}</span><div><strong>Nomor berhasil diverifikasi</strong><small id="otp-success-phone">${esc(maskedAuthPhone(state.authPhone))}</small><small id="otp-success-expiry" class="otp-success-expiry"></small></div><button type="button" data-action="change-otp-number">Ganti nomor</button></div>
  <p id="otp-confirmation" class="otp-status" role="status" aria-live="polite" aria-atomic="true">${verified?'Verifikasi berhasil.':requested?'Masukkan kode yang baru saja dikirim.':'Kirim kode untuk melanjutkan pendaftaran.'}</p>
  <p id="otp-security-note" class="otp-security-note">${ico('lock','sm')} Jangan berikan kode OTP kepada siapa pun, termasuk pihak yang mengaku sebagai ANJEMIN.</p>
 </section>`;
}
function authHtml(){if(state.authTab==='login')return `<div class="auth-tabs"><button class="active" data-auth-tab="login">Masuk</button><button data-auth-tab="signup">Daftar akun</button></div><p class="sub">Selamat datang di ANJEMIN!</p><form id="login-form"><div class="field"><label>Email atau username</label><input name="identifier" autocomplete="username" value="${esc(rememberedLogin())}" required placeholder="nama@email.com / username"/></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required placeholder="Password akun"/></div><label class="remember-login"><input type="checkbox" name="remember" ${rememberedLogin()?'checked':''}/><span><strong>Ingat saya</strong><small>Simpan akun dan tetap masuk selama 30 hari di perangkat ini.</small></span></label><button class="button full" type="submit">Masuk ke ANJEMIN ${ico('chevron','sm')}</button></form><p class="form-hint" style="text-align:center;margin-top:18px">Belum punya akun? <a href="#" data-auth-tab="signup" style="color:var(--primary2);font-weight:800">Daftar dulu</a></p>`;
 return `<div class="auth-tabs"><button data-auth-tab="login">Masuk</button><button class="active" data-auth-tab="signup">Daftar akun</button></div>
 <div class="step-numbers"><span class="active">01 · Isi data</span><span class="${state.authVerified?'active':''}">02 · Verifikasi nomor</span><span class="${state.authVerified?'active':''}">03 · Buat akun</span></div>
 
 <form id="signup-form"><div class="role-switch"><label><input type="radio" name="role" value="CUSTOMER" ${state.authRole==='CUSTOMER'?'checked':''}/><span>🛍️ Customer Anjem</span></label><label><input type="radio" name="role" value="DRIVER" ${state.authRole==='DRIVER'?'checked':''}/><span>🛵 Penganjem</span></label></div>
 <div class="form-row"><div class="field"><label>Nama lengkap *</label><input required minlength="3" maxlength="80" name="full_name" placeholder="Nama sesuai identitas"/></div><div class="field"><label>Username *</label><input required pattern="[a-z0-9_]{3,24}" name="username" placeholder="nama_pengguna"/></div></div>
 <div class="field"><label>Email *</label><input required type="email" name="email" placeholder="nama@email.com"/></div>
 <div class="field"><label for="signup-phone">Nomor telepon aktif (+62) *</label><input required type="tel" inputmode="tel" autocomplete="tel" name="phone" id="signup-phone" placeholder="081234567890" value="${esc(state.authPhone)}" aria-describedby="otp-confirmation"/></div>
 ${signupOtpPanel()}
 <div class="field"><label>Password (minimal 10 karakter) *</label><input required type="password" minlength="10" name="password" autocomplete="new-password" placeholder="Buat password kuat"/></div>
 ${state.authRole==='DRIVER'?`<section class="driver-rules" aria-labelledby="driver-rules-title"><span class="kicker">Wajib dibaca sebelum mendaftar</span><h3 id="driver-rules-title">Komitmen Penganjem ANJEMIN</h3><ul><li><strong>Jujur dan bertanggung jawab.</strong> Dilarang menipu, menggelapkan uang atau barang, memalsukan identitas/dokumen, serta meminta OTP atau password pengguna.</li><li><strong>Hormati dan lindungi pengguna.</strong> Dilarang melakukan pelecehan seksual maupun verbal, ancaman, kekerasan, diskriminasi, atau tindakan yang membahayakan keselamatan.</li><li><strong>Jaga privasi.</strong> Dilarang menyebarkan atau menyalahgunakan nomor telepon, alamat, foto, percakapan, dan data pribadi pengguna.</li><li><strong>Jalankan layanan sesuai kesepakatan.</strong> Patuhi aturan lalu lintas, jaga barang titipan, serta jangan meminta biaya tambahan tanpa persetujuan atau menggunakan layanan untuk kegiatan melanggar hukum.</li></ul><div class="driver-rules-consequence"><strong>Pelanggaran memiliki konsekuensi.</strong><p>Akun dapat dibekukan setelah peninjauan. Dugaan penipuan, pelecehan, kekerasan, atau tindak pidana lainnya dapat dilaporkan kepada pihak berwenang. Data identitas, dokumen verifikasi, riwayat transaksi, dan bukti terkait dapat diserahkan melalui proses yang sah, sebatas yang relevan dan sesuai ketentuan hukum. Data pribadi tidak disebarkan kepada publik.</p></div><label class="driver-document-check"><input type="checkbox" name="driver_rules_accepted" required/> Saya telah membaca dan menyetujui peraturan Penganjem ANJEMIN, memahami konsekuensi pelanggaran, dan berkomitmen mematuhinya.</label></section><fieldset class="driver-documents"><legend>Dokumen Penganjem</legend><div class="field"><label for="signup-campus">Email kampus *</label><input id="signup-campus" name="campus_email" required type="email" placeholder="nama@students.undip.ac.id"/></div><div class="field"><label for="signup-vehicle">Kendaraan dan nomor polisi *</label><input id="signup-vehicle" name="vehicle" required placeholder="Contoh: Honda Beat H 1234 XX"/></div><div class="field"><label for="signup-ktm">Foto KTM *</label><input id="signup-ktm" name="ktm_photo" required type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="driver-document-hint"/></div><div class="field"><label for="signup-sim-type">Jenis SIM *</label><select id="signup-sim-type" name="sim_type" required><option value="">Pilih jenis SIM</option><option value="A">SIM A</option><option value="C">SIM C</option></select></div><div class="field"><label for="signup-sim-photo">Foto SIM *</label><input id="signup-sim-photo" name="sim_photo" required type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="driver-document-hint"/></div><p class="form-hint" id="driver-document-hint">Unggah foto yang jelas dan terbaca. Format JPG, PNG, atau WebP, maksimal 4 MB per foto. Foto KTM dan SIM hanya dapat dilihat Pengelola untuk verifikasi.</p><label class="driver-document-check"><input name="sim_declared" type="checkbox" required/> Saya menyatakan SIM masih berlaku, data sesuai dokumen, dan kendaraan layak digunakan.</label></fieldset>`:''}
 <div class="field" style="margin-top:17px"><label>Kode referral (opsional)</label><input name="referral" placeholder="Contoh: AJ12AB34CD"/></div>
 <label class="form-hint"><input type="checkbox" required name="agree"/> Saya telah membaca <a data-nav="privacy" href="#" style="color:var(--primary2)">informasi privasi</a> dan menyetujui syarat penggunaan.</label>
 <button type="submit" class="button full" style="margin-top:20px" ${state.authVerified?'':'disabled'}>Buat akun ${state.authRole==='DRIVER'?'Penganjem':'Customer'} ${ico('chevron','sm')}</button></form>`;
}
function renderAuthModal(){const modal=modalWrap(state.authTab==='login'?'Selamat datang! ✨':'Bikin akun dulu, yuk!',authHtml());$('#modal-root').innerHTML=modal;if(state.authTab==='signup')updateSignupVerification();}
function renderListingModal(){const inside=`<p class="sub">Pasang foto barang asli, isi deskripsi sejelas mungkin, dan tentukan harga yang masuk akal.</p><form id="listing-form"><div class="form-row"><div class="field"><label>Nama barang *</label><input name="title" required minlength="4" maxlength="100" placeholder="Kipas Angin Kos"/></div><div class="field"><label>Tipe barang *</label><select name="category" required>${categories.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div><div class="field"><label>Harga (Rp) *</label><input type="text" inputmode="numeric" data-money="true" name="price" required data-min="1000" placeholder="75,000"/></div><div class="field"><label>Keterangan *</label><textarea name="description" required minlength="10" placeholder="Kondisi barang, kelengkapan, minus, lokasi serah terima..." ></textarea></div><div class="field"><label>Foto barang (1 sampai 5 foto, total maks 4MB) *</label><input id="listing-photo-picker" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden/><div id="listing-photo-previews" class="listing-photo-previews"></div><p id="listing-photo-count" class="form-hint" role="status"></p></div><div class="note">Komisi platform 3%, maksimal Rp20.000. Pada pembayaran website, komisi dipisahkan saat pembeli menyelesaikan transaksi; sisanya masuk saldo penjual. Saat ini masih simulasi.</div><button class="button full">Publikasikan barang</button></form>`;
 $('#modal-root').innerHTML=modalWrap('Buka Lapak 📦',inside);
 paintListingPhotos();
}
function listingDetailHtml(item){if(!item)return '<p>Barang tidak ditemukan.</p>';return `<div class="split">${listingGallery(item,true)}<div><span class="tag">${esc(item.category)}</span><h2 style="font-size:25px;margin:17px 0 7px">${esc(item.title)}</h2><p class="price">${money(item.price)}</p>${identityChip(item.seller_profile)}<p class="small" style="line-height:1.8;white-space:pre-wrap">${esc(item.description)}</p>${state.user?.id!==item.seller_id?`<div class="form-actions"><button class="button" data-buy="${esc(item.id)}">Checkout</button><button class="button secondary" data-negotiate="${esc(item.id)}">Tawar Penjual ${ico('chat','sm')}</button></div>`:'<span class="tag success">Ini lapakmu</span>'}</div></div>`;}
function dashboardRoute(){if(!state.user)return 'home';if(profileNeeded())return 'profile';return state.user.role==='ADMIN'?'admin':state.user.role==='DRIVER'?'driver':'home';}
async function authRefresh(){const d=await get('/api/auth/me');state.user=d.user;state.ready=!!d.user?.ready;}
async function handleLogin(form){const obj=Object.fromEntries(new FormData(form));obj.remember=form.elements.remember.checked;const data=await post('/api/auth/login',obj);try{if(obj.remember)localStorage.setItem('anjemin-login-identifier',obj.identifier.trim());else localStorage.removeItem('anjemin-login-identifier');}catch{}state.user=data.user;state.ready=!!data.user.ready;state.page=dashboardRoute();state.sideHidden=window.innerWidth<760;closeModal();render();toast('Berhasil masuk. Selamat datang! 🎉');setupStream();if(state.page==='driver')loadDriverJobs();if(state.page==='admin')loadAdmin();}
async function logout(){releaseProfileDraft();await post('/api/auth/logout');headerWalletCache=null;state.user=null;state.ready=false;state.page='home';state.stream?.close();state.stream=null;state.sideHidden=false;clearSignupOtpState();render();openModal('auth');toast('Berhasil keluar dari akun.');}
async function file64(file){if(!file)throw Error('Pilih foto terlebih dahulu.');if(file.size>4*1024*1024)throw Error('Foto maksimal 4MB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Format foto harus JPG, PNG, atau WebP.');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
function pickFormValues(form){const fd=new FormData(form);for(const input of form.querySelectorAll('[data-money]'))fd.set(input.name,input.value.replaceAll(',',''));return Object.fromEntries(fd.entries());}
async function handleSignup(form){const b=pickFormValues(form);if(!state.authVerified||normalizedAuthPhone(b.phone)!==state.authPhone)throw Error('Nomor telepon wajib diverifikasi dulu.');
 b.role=state.authRole;b.sim_declared=!!form.elements.sim_declared?.checked;
 b.driver_rules_accepted=!!form.elements.driver_rules_accepted?.checked;
 b.driver_rules_version='2026-10-26';
 if(state.authRole==='DRIVER'){
  if(!b.driver_rules_accepted)throw Error('Baca dan setujui peraturan Penganjem terlebih dahulu.');
  if(!['A','C'].includes(b.sim_type))throw Error('Pilih jenis SIM A atau SIM C.');
  if(!form.elements.sim_photo.files[0])throw Error('Lampirkan foto SIM terlebih dahulu.');
  [b.ktm_photo,b.sim_photo]=await Promise.all([file64(form.elements.ktm_photo.files[0]),file64(form.elements.sim_photo.files[0])]);
 }
 const d=await post('/api/auth/signup',b);state.user=d.user;state.ready=false;state.page=dashboardRoute();clearSignupOtpState();closeModal();render();toast(d.message);setupStream();}
let signupOtpTimer=null;
function stopSignupOtpTimer(){clearInterval(signupOtpTimer);signupOtpTimer=null;}
function clearSignupOtpState(){stopSignupOtpTimer();document.querySelector('.otp-delivery-toast')?.remove();state.authVerified=false;state.authPhone='';state.authOtpRequested=false;state.authOtpCode='';state.authOtpResendAt=0;state.authOtpExpiresAt=0;state.authOtpVerifiedUntil=0;state.authOtpDevelopment=false;}
function otpDeliveryNotice(phone,development=false){
 const area=$('#toast-area');if(!area)return;
 area.querySelector('.otp-delivery-toast')?.remove();
 const item=document.createElement('article');item.className='otp-delivery-toast';item.setAttribute('role','status');
 item.innerHTML=`<span class="otp-toast-icon">${ico('lock')}</span><div class="otp-toast-copy"><span>SMS KEAMANAN</span><strong>Kode OTP sudah dikirim</strong><p>Masukkan 6 digit yang dikirim ke ${esc(maskedAuthPhone(phone))}. Kode berlaku 5 menit.</p>${development?'<small>Mode lokal: lihat kode di terminal server.</small>':''}<button type="button" data-action="focus-otp">Masukkan kode sekarang</button></div><button type="button" class="otp-toast-close" data-action="dismiss-otp-notice" aria-label="Tutup notifikasi">${ico('x','sm')}</button><span class="otp-toast-progress" aria-hidden="true"></span>`;
 area.append(item);
 let remaining=8500,started=Date.now(),timer,running=false;
 const dismiss=()=>{clearTimeout(timer);running=false;if(!item.isConnected)return;item.classList.add('is-leaving');setTimeout(()=>item.remove(),220);};
 const resume=()=>{if(running||item.matches(':hover')||item.contains(document.activeElement))return;started=Date.now();running=true;timer=setTimeout(dismiss,remaining);};
 const pause=()=>{if(!running)return;clearTimeout(timer);remaining=Math.max(800,remaining-(Date.now()-started));running=false;};
 item.addEventListener('mouseenter',pause);item.addEventListener('mouseleave',resume);item.addEventListener('focusin',pause);item.addEventListener('focusout',event=>{if(!item.contains(event.relatedTarget))resume();});resume();
}
function setSignupOtpBusy(mode=''){
 const panel=$('#signup-otp-panel');if(!panel)return;
 panel.dataset.busy=mode;panel.setAttribute('aria-busy',String(!!mode));
 panel.querySelectorAll('button').forEach(button=>button.disabled=!!mode);
 if(mode){const status=$('#otp-confirmation');if(status){status.dataset.tone='';status.textContent=mode==='sending'?'Sedang mengirim kode aman...':'Sedang memeriksa kode...';}}
 else{
  panel.querySelectorAll('button').forEach(button=>button.disabled=false);
  const verify=panel.querySelector('[data-action="verify-otp"]');if(verify)verify.disabled=state.authOtpCode.length!==6||state.authVerified;
  updateSignupOtpCountdown();
 }
}
function updateSignupOtpCountdown(){
 const panel=$('#signup-otp-panel');if(!panel||!state.authOtpRequested){stopSignupOtpTimer();return;}
 if(state.authVerified){
  const grantSeconds=Math.max(0,Math.ceil((state.authOtpVerifiedUntil-Date.now())/1000)),grant=$('#otp-success-expiry');if(grant)grant.textContent=`Selesaikan pendaftaran dalam ${otpClock(grantSeconds)}`;
  if(grantSeconds<=0)resetSignupOtp('Waktu verifikasi telah berakhir. Kirim kode OTP baru untuk melanjutkan.');return;
 }
 const now=Date.now(),resendSeconds=Math.max(0,Math.ceil((state.authOtpResendAt-now)/1000)),expiresSeconds=Math.max(0,Math.ceil((state.authOtpExpiresAt-now)/1000));
 const resend=panel.querySelector('[data-otp-resend]'),clock=$('#otp-resend-clock');
 if(resend){resend.disabled=!!panel.dataset.busy||resendSeconds>0;resend.textContent=resendSeconds>0?'Kirim ulang dalam':'Kirim ulang kode';}
 if(clock)clock.textContent=resendSeconds>0?otpClock(resendSeconds):'';
 const expiry=$('#otp-expiry-clock');if(expiry)expiry.textContent=expiresSeconds>0?`Berlaku ${otpClock(expiresSeconds)}`:'Kode kedaluwarsa';
 const input=$('#signup-otp'),verify=panel.querySelector('[data-action="verify-otp"]'),expired=expiresSeconds<=0;
 if(input)input.disabled=expired||!!panel.dataset.busy;
 if(verify)verify.disabled=expired||!!panel.dataset.busy||state.authOtpCode.length!==6;
 if(expired&&panel.dataset.expiryAnnounced!=='true'){
  panel.dataset.expiryAnnounced='true';const status=$('#otp-confirmation');if(status){status.dataset.tone='error';status.textContent='Kode telah kedaluwarsa. Kirim ulang untuk mendapatkan kode baru.';}
 }
 if(!expired)panel.dataset.expiryAnnounced='false';
 if(resendSeconds<=0&&expiresSeconds<=0)stopSignupOtpTimer();
}
function startSignupOtpTimer(){stopSignupOtpTimer();updateSignupOtpCountdown();if(state.authOtpRequested)signupOtpTimer=setInterval(updateSignupOtpCountdown,1000);}
function resetSignupOtp(message='Nomor diubah. Kirim kode baru untuk memverifikasinya.'){
 stopSignupOtpTimer();state.authVerified=false;state.authOtpRequested=false;state.authOtpCode='';state.authOtpResendAt=0;state.authOtpExpiresAt=0;state.authOtpVerifiedUntil=0;state.authOtpDevelopment=false;state.authPhone='';updateSignupVerification(message,'error');
}
function handleSignupPhoneEdit(input){
 input.setAttribute('aria-invalid','false');
 if((state.authOtpRequested||state.authVerified)&&normalizedAuthPhone(input.value)!==state.authPhone)resetSignupOtp();
}
function handleSignupOtpInput(input){
 const digits=input.value.replace(/\D/g,'').slice(0,6);input.value=digits;state.authOtpCode=digits;input.setAttribute('aria-invalid','false');
 const verify=$('#signup-otp-panel [data-action="verify-otp"]');if(verify)verify.disabled=digits.length!==6||Date.now()>=state.authOtpExpiresAt||!!$('#signup-otp-panel')?.dataset.busy;
 const status=$('#otp-confirmation');if(status&&status.dataset.tone==='error'){status.dataset.tone='';status.textContent='Masukkan kode yang baru saja dikirim.';}
}
async function requestOTP(){
 const input=$('#signup-phone'),phone=input?.value.trim();if(!phone){updateSignupVerification('Masukkan nomor telepon aktif terlebih dahulu.','error','phone');input?.focus();throw Error('Masukkan nomor telepon dulu.');}
 if(state.authOtpRequested&&normalizedAuthPhone(phone)===state.authPhone&&state.authOtpResendAt>Date.now())return;
 input.setAttribute('aria-invalid','false');state.authVerified=false;state.authOtpVerifiedUntil=0;setSignupOtpBusy('sending');
 try{
  const out=await post('/api/auth/otp/request',{phone});
  state.authPhone=out.normalizedPhone||normalizedAuthPhone(phone);state.authOtpRequested=true;state.authOtpCode='';state.authOtpDevelopment=!!out.development;
  state.authOtpResendAt=Date.now()+Number(out.retryAfterSeconds||60)*1000;state.authOtpExpiresAt=Date.now()+Number(out.expiresInSeconds||300)*1000;
  updateSignupVerification(out.development?'Kode siap. Pada mode lokal, lihat terminal server lalu masukkan 6 digitnya.':'SMS terkirim. Masukkan 6 digit kode untuk melanjutkan.','success');
  otpDeliveryNotice(state.authPhone,out.development);requestAnimationFrame(()=>$('#signup-otp')?.focus());
 }catch(error){const target=/nomor|telepon|format|terdaftar/i.test(error.message||'')?'phone':'';updateSignupVerification(error.message||'Kode belum dapat dikirim. Coba lagi.','error',target);throw error;}
 finally{setSignupOtpBusy('');}
}
async function verifyOTP(){
 const input=$('#signup-phone'),phone=normalizedAuthPhone(input?.value),code=String($('#signup-otp')?.value||'').replace(/\D/g,'');
 if(phone!==state.authPhone){resetSignupOtp('Nomor berubah. Kirim kode baru untuk nomor ini.');input?.focus();throw Error('Nomor berubah. Kirim kode baru untuk nomor ini.');}
 if(code.length!==6){updateSignupVerification('Masukkan seluruh 6 digit kode OTP.','error','otp');$('#signup-otp')?.focus();throw Error('Masukkan 6 digit kode OTP.');}
 if(state.authOtpExpiresAt&&Date.now()>=state.authOtpExpiresAt){updateSignupVerification('Kode telah kedaluwarsa. Kirim ulang kode baru.','error','otp');throw Error('Kode telah kedaluwarsa. Kirim ulang kode baru.');}
 setSignupOtpBusy('verifying');
 try{
  const out=await post('/api/auth/otp/verify',{phone,code});
  if(normalizedAuthPhone($('#signup-phone')?.value)!==phone)throw Error('Nomor berubah. Verifikasi kembali nomor yang digunakan.');
  state.authPhone=phone;state.authVerified=true;state.authOtpCode='';state.authOtpVerifiedUntil=Date.now()+Number(out.verifiedForSeconds||900)*1000;updateSignupVerification('Nomor berhasil diverifikasi. Kamu bisa melanjutkan pendaftaran.','success');requestAnimationFrame(()=>$('#otp-success')?.focus());toast('Nomor berhasil diverifikasi!');
 }catch(error){const otp=$('#signup-otp');if(otp){otp.setAttribute('aria-invalid','true');otp.select();}updateSignupVerification(error.message||'Kode tidak dapat diverifikasi.','error','otp');throw error;}
 finally{setSignupOtpBusy('');}
}
function updateSignupVerification(message='',tone='',errorTarget=''){
 const form=$('#signup-form');if(!form)return;
 const panel=$('#signup-otp-panel'),currentPhone=normalizedAuthPhone($('#signup-phone')?.value),samePhone=!!state.authPhone&&currentPhone===state.authPhone;
 if(state.authVerified&&!samePhone)state.authVerified=false;
 const requested=state.authOtpRequested&&samePhone,verified=state.authVerified&&samePhone;
 panel?.classList.toggle('is-sent',requested);panel?.classList.toggle('is-verified',verified);
 const idle=$('#otp-idle'),challenge=$('#otp-challenge'),success=$('#otp-success');if(idle)idle.hidden=requested;if(challenge)challenge.hidden=!requested||verified;if(success)success.hidden=!verified;
 const destination=$('#otp-destination'),successPhone=$('#otp-success-phone');if(destination)destination.textContent=maskedAuthPhone(state.authPhone);if(successPhone)successPhone.textContent=maskedAuthPhone(state.authPhone);
 const badge=$('#otp-state-badge');if(badge){badge.textContent=verified?'Terverifikasi':requested?'Menunggu kode':'Belum dikirim';badge.classList.toggle('is-success',verified);}
 const icon=$('#otp-panel-icon');if(icon)icon.innerHTML=ico(verified?'check':'lock');
 const description=$('#otp-panel-description');if(description)description.textContent=verified?'Nomormu sudah siap digunakan untuk akun ANJEMIN.':requested?'Periksa SMS dan masukkan kode sebelum kedaluwarsa.':'Kami akan mengirim kode rahasia melalui SMS.';
 const phone=$('#signup-phone');if(phone)phone.setAttribute('aria-invalid',tone==='error'&&errorTarget==='phone'?'true':'false');
 const otp=$('#signup-otp');if(otp){otp.value=state.authOtpCode;otp.disabled=!requested||verified;otp.setAttribute('aria-invalid',tone==='error'&&errorTarget==='otp'?'true':'false');}
 const status=$('#otp-confirmation');if(status){status.dataset.tone=tone;if(message)status.textContent=message;else status.textContent=verified?'Verifikasi berhasil.':requested?(state.authOtpDevelopment?'Lihat kode di terminal server pada mode lokal.':'Masukkan kode yang baru saja dikirim.'):'Kirim kode untuk melanjutkan pendaftaran.';}
 form.querySelector('[type="submit"]').disabled=!verified;
 document.querySelectorAll('.step-numbers span').forEach((step,index)=>{const complete=index===0||verified;step.classList.toggle('active',complete);step.setAttribute('aria-current',index===1&&requested&&!verified?'step':index===2&&verified?'step':'false');});
 if(requested)startSignupOtpTimer();else stopSignupOtpTimer();
}
function rememberSignupInput(){const f=$('#signup-form');if(!f)return null;return Object.fromEntries(new FormData(f));}
function setAuthRole(value){const existing=rememberSignupInput();state.authRole=value;renderAuthModal();if(existing){const f=$('#signup-form');for(const [key,v] of Object.entries(existing)){const el=f.elements[key];if(el&&el.type!=='file'&&el.type!=='radio'&&el.type!=='checkbox')el.value=v;}}updateSignupVerification();}
async function loadListings(){if(!state.user)return;try{const data=await get('/api/listings');state.listings=data.listings;paintListings();}catch(e){toast(e.message,true);}}
function paintListings(){const el=$('#market-results');if(!el)return;const q=($('#market-query')?.value||'').toLowerCase(),category=$('#market-category')?.value||'ALL';const shown=state.listings.filter(x=>(category==='ALL'||category===x.category)&&(x.title+' '+x.description).toLowerCase().includes(q));
 el.innerHTML=shown.length?shown.map(it=>`<article class="product-card">${listingGallery(it)}<div class="product-body"><span class="tag">${esc(it.category)}</span><h3>${esc(it.title)}</h3><div class="price">${money(it.price)}</div>${identityChip(it.seller_profile)}<p class="small muted" style="margin-top:8px">${esc(it.description.slice(0,84))}${it.description.length>84?'…':''}</p><div class="product-actions"><button class="button secondary tiny" data-detail="${it.id}">Lihat</button>${it.seller_id!==state.user?.id?`<button class="button tiny" data-negotiate="${it.id}">Tawar ${ico('chat','sm')}</button>`:'<span class="tag">Barangmu</span>'}</div></div></article>`).join(''):'<div class="card" style="grid-column:1/-1"><h3>Belum ada barang di sini</h3><p class="muted small">Coba kata pencarian lain atau jadi yang pertama membuka lapak.</p><button class="button secondary tiny" data-action="add-listing">+ Jual barang</button></div>';
}
async function addListing(form){const b=pickFormValues(form);const files=(state.modal?.photos||[]).map(photo=>photo.file);if(files.length<1||files.length>5)throw Error('Pilih 1 sampai 5 foto barang.');if(files.reduce((total,file)=>total+file.size,0)>4*1024*1024)throw Error('Total ukuran foto maksimal 4MB.');delete b.image;b.images=await Promise.all(files.map(file64));await post('/api/listings',b);closeModal();toast('Barang sudah muncul di marketplace!');go('market');}
async function buyListing(id,price){
 const item=state.listings.find(o=>o.id===id),total=price||item?.price;
 if(!await confirmAction({title:'Lanjut checkout?',message:`${total?'Total checkout '+money(total)+'. ':''}Pembayaran simulasi ditahan sampai kamu menerima barang dan menyelesaikan transaksi.`,confirmLabel:'Ya, checkout',cancelLabel:'Kembali'}))return;
 const d=await post(`/api/listings/${id}/buy`,price?{agreed_price:price}:{});closeModal();toast(d.message);state.marketOrderView='BUYER';go('market-orders');
}
async function startNego(id){if(!requireLogin())return;const data=await post('/api/chat/start',{listing_id:id});closeModal();state.activeChat=data.conversation_id;go('chat');await loadConversations();await loadMessages(data.conversation_id);}
async function loadOrders(){if(!state.user)return;try{const d=await get('/api/orders/mine');state.orders=d.orders;paintOrders();if(state.page==='orders')loadWalletSummary();}catch(e){toast(e.message,true);}}
function paintOrders(){const el=$('#orders-results');if(!el)return;scheduleOrderStamps();el.innerHTML=state.orders.length?state.orders.map(x=>`<div class="list-row"><div><strong>${esc(labels[x.type])}</strong> <span class="tag ${x.status==='COMPLETED'?'success':x.status==='CANCELLED'?'danger':'warning'}">${orderStatus(x.status)}</span>${x.type==='RIDE'?`<p>Kendaraan: ${x.vehicle_type==='MOBIL'?'Mobil':'Motor'}</p>`:''}<p>${esc(x.pickup)} → ${esc(x.destination)}</p><p>Tarif ${money(x.fare)} · Diskon ${money(x.promo_discount)} · ${esc(x.driver_name?'Driver @'+x.driver_name:'Menunggu driver')}</p>${identityChip(x.customer_id===state.user.id?x.driver_profile:x.customer_profile)}</div><div class="actions">${showCompletedStamp(x)?completedOrderStamp():`${paymentActions(x)}${x.driver_id&&['CLAIMED','COMPLETED'].includes(x.status)?`<button class="button secondary tiny" data-orderchat="${x.id}">${ico('chat','sm')} ${x.customer_id===state.user.id?'Chat Penganjem':'Chat Customer'}</button>`:''}${x.status==='OPEN'&&x.customer_id===state.user.id?`<button class="button outline tiny" data-cancelorder="${x.id}">Batalkan</button>`:''}${x.status==='CLAIMED'&&!x.payment_required&&x.customer_id===state.user.id?`<button class="button tiny" data-completeorder="${x.id}">Selesai</button>`:''}`}<button class="button outline tiny report-order-button" data-reportorder="${x.id}">Laporkan</button></div></div>`).join(''):'<p class="muted small">Belum ada order. Coba pesan layanan pertama kamu.</p>';
}
async function loadDriverJobs(){if(!state.user||state.user.role!=='DRIVER')return;
 try{const data=await get('/api/driver/jobs');state.driverJobs=data.orders;paintDriverJobs();}catch(e){toast(e.message,true);}}
function paintDriverJobs(){const el=$('#driver-results');if(!el)return;const arr=(state.driverJobs||[]).filter(o=>!state.driverFilter||state.driverFilter===o.type).map(o=>({...o,distance:driverOrderDistance(o,state.driverCoords)}));
 if(state.driverSort==='PRICE_HIGH')arr.sort((a,b)=>b.fare-a.fare);
 if(state.driverSort==='PRICE_LOW')arr.sort((a,b)=>a.fare-b.fare);
 if(state.driverSort==='NEAREST'&&state.driverCoords)arr.sort((a,b)=>a.distance-b.distance);
$('#driver-count').textContent=String(arr.length);
 el.innerHTML=arr.length?arr.map(o=>`<div class="list-row"><div><strong>${esc(labels[o.type])}</strong> <span class="tag">${money(o.fare)}</span>${o.type==='RIDE'?`<p>Kendaraan: ${o.vehicle_type==='MOBIL'?'Mobil':'Motor'}</p>`:''}<p>${esc(o.pickup)} → ${esc(o.destination)}</p>${identityChip(o.customer_profile)}${state.driverSort==='NEAREST'?`<p class="small muted">${!state.driverCoords?'Aktifkan GPS untuk menghitung jarak.':Number.isFinite(o.distance)?'Jarak ke penjemputan: '+o.distance.toLocaleString('id-ID',{maximumFractionDigits:1})+' km (garis lurus)':'Lokasi GPS penjemputan belum tersedia.'}</p>`:''}${o.item_name?`<p>Barang: ${esc(o.item_name)}</p>`:''}<p class="small muted">Potensi komisi platform ${money(o.platform_fee)} · Bagian driver ${money(o.fare-o.platform_fee)}</p></div><button class="button tiny" data-claim="${o.id}">Ambil order ${ico('chevron','sm')}</button></div>`).join(''):`<div class="note">${state.ready?'Belum ada order tersedia. Pesanan baru akan langsung masuk di panel ini.':'Kamu sedang Not Ready atau belum diverifikasi. Aktifkan Ready dahulu.'}</div>`;
}
async function toggleReady(){if(!state.user||state.user.role!=='DRIVER')return;const desired=!state.ready;const d=await post('/api/driver/ready',{ready:desired});state.ready=d.ready;state.user.ready=state.ready;if(desired&&'Notification'in window&&Notification.permission==='default')try{await Notification.requestPermission();}catch{};
 render();loadDriverJobs();toast(state.ready?'Kamu Ready. Order baru akan muncul otomatis. 🟢':'Kamu Not Ready. 🔴');}
function setupStream(){pollOrderChatInbox();state.stream?.close();state.stream=null;if(state.user?.role!=='DRIVER')return;
 state.stream=new EventSource('/api/driver/stream');state.stream.addEventListener('account-frozen',()=>clearAccountSession('Akun dibekukan oleh Pengelola. Hubungi dukungan ANJEMIN untuk peninjauan.'));state.stream.addEventListener('payment-update',e=>{toast(JSON.parse(e.data).message);refreshHeaderWallet(true);if(state.page==='orders')loadOrders();if(state.page==='wallet')loadWallet();if(state.page==='achievements')loadAchievements();});state.stream.addEventListener('new-order',e=>{
  const o=JSON.parse(e.data);if(!state.ready)return;toast('🛵 Order '+labels[o.type]+' baru: '+o.pickup);
  if('Notification'in window&&Notification.permission==='granted')new Notification('Order ANJEMIN masuk!',{body:o.pickup+' → '+o.destination,icon:'/favicon.svg'});
  if(navigator.vibrate)navigator.vibrate([150,90,150]);if(state.page==='driver')loadDriverJobs();
 });state.stream.onerror=()=>{};
}
async function claimOrder(id){const r=await post(`/api/orders/${id}/claim`);toast(r.message);loadDriverJobs();go('orders');loadOrders();}
async function completeOrder(id){if(!await confirmAction({title:'Selesaikan pesanan?',message:'Dana akan masuk ke saldo Penganjem setelah konfirmasi ini.',confirmLabel:'Ya, selesaikan',cancelLabel:'Kembali'}))return;const r=await post(`/api/orders/${id}/complete`);toast(r.message);loadOrders();}
async function cancelOrder(id){if(!await confirmAction({title:'Batalkan pesanan?',message:'Pesanan masih menunggu Penganjem. Voucher akan dikembalikan jika pembatalan berhasil.',confirmLabel:'Batalkan pesanan',cancelLabel:'Kembali',danger:true}))return;await post(`/api/orders/${id}/cancel`);toast('Pesanan dibatalkan. Voucher dikembalikan jika ada.');loadOrders();}
function copyReferral(){navigator.clipboard?.writeText(state.user.referral_code).then(()=>toast('Kode referral disalin: '+state.user.referral_code)).catch(()=>toast('Kode referral: '+state.user.referral_code));}
async function populateVouchers(){
 const el=$('#voucher-select');if(!el)return;
 try{
  const r=await get('/api/account/vouchers');if(!el.isConnected)return;
  el.innerHTML='<option value="" data-amount="0">Tanpa voucher</option>'+r.vouchers.map(v=>`<option value="${esc(v.id)}" data-amount="${Number(v.amount)||0}">${esc(v.reason)} - ${money(v.amount)}</option>`).join('');
  const form=el.closest('[data-jastip-form]');if(form)updateJastipSummary(form);
 }catch{
  const hint=$('#jastip-voucher-hint');if(hint&&el.isConnected)hint.textContent='Voucher belum bisa dimuat. Kamu tetap bisa memesan tanpa voucher.';
 }
}
async function populateReferralVouchers(){try{const r=await get('/api/account/vouchers');const el=$('#voucher-results');if(el)el.innerHTML=r.vouchers.length?r.vouchers.map(v=>`<div class="list-row"><div><strong>${money(v.amount)} · ${esc(v.reason)}</strong><p>Berlaku hingga ${esc(new Date(v.expires_at).toLocaleDateString('id-ID'))}</p></div><span class="tag success">Aktif</span></div>`).join(''):'Belum ada voucher aktif.';}catch{}}
async function loadConversations(){if(!state.user)return;try{const d=await get('/api/chat');state.conversations=d.conversations;const el=$('#chat-list');if(!el)return;el.innerHTML=d.conversations.length?d.conversations.map(c=>`<button class="chat-item ${state.activeChat===c.id?'active':''}" data-chat="${c.id}"><span class="chat-person">${profileAvatar(c.partner_profile||{username:c.partner})}<span>${esc(c.partner_profile?.full_name||c.partner)}<small>@${esc(c.partner)}</small></span></span><br/><span class="tiny muted">${esc(c.title)}</span></button>`).join(''):'<p class="muted small">Belum ada chat. Pilih Tawar pada marketplace.</p>';if(state.activeChat)loadMessages(state.activeChat);}catch(e){toast(e.message,true);}}
async function loadMessages(id){try{const d=await get(`/api/chat/${id}/messages`);state.activeChat=id;state.thread=d;const pane=$('#chat-detail');if(!pane)return;
 const other=d.conversation.buyer_id===state.user.id?'Penjual':'Calon pembeli';
 pane.innerHTML=`${identityChip(d.partner_profile)}<div><strong>💬 Nego dengan ${other}</strong><p class="muted tiny">Komunikasi dan negosiasi tercatat dalam aplikasi.</p></div><div id="messages-scroll" class="chat-messages">${d.messages.map(msg=>`<div class="bubble-msg ${msg.sender_id===state.user.id?'mine':''}"><strong>@${esc(msg.sender_name)}</strong><br/>${esc(msg.body)}${msg.offer_amount?`<br/><strong>Harga penawaran: ${money(msg.offer_amount)}</strong>${msg.sender_id!==state.user.id&&d.conversation.buyer_id===state.user.id?`<br/><button class="button tiny" data-buy="${esc(d.conversation.listing_id)}" data-price="${msg.offer_amount}">Terima & Reservasi</button>`:''}`:''}<br/><span style="opacity:.65;font-size:9px">${esc(msg.created_at)}</span></div>`).join('')}</div><form id="message-form" class="chat-controls"><input type="hidden" name="conversation_id" value="${esc(id)}"/><input name="body" placeholder="Tulis pesan / nego yang sopan..." required minlength="1" maxlength="1000"/><input type="text" inputmode="numeric" data-money="true" name="offer_amount" data-min="1000" placeholder="Harga tawar (opsional)" style="width:145px"/><button class="button tiny" type="submit">Kirim</button></form>`;
 const sc=$('#messages-scroll');if(sc)sc.scrollTop=sc.scrollHeight;
 for(const btn of document.querySelectorAll('[data-chat]'))btn.classList.toggle('active',btn.dataset.chat===id);
 }catch(e){toast(e.message,true);}}
async function sendMessage(form){const b=pickFormValues(form),conv=b.conversation_id;await post(`/api/chat/${conv}/messages`,{body:b.body,offer_amount:b.offer_amount||null});await loadMessages(conv);}
async function loadAdmin(){if(state.user?.role!=='ADMIN')return;try{const d=await get('/api/admin/overview');const s=d.stats;
 const stats=[['Total akun',s.users],['Calon driver pending',s.driversPending],['Order menunggu',s.openOrders],['Order selesai',s.completeOrders],['Barang terjual',s.soldListings],[d.mode==='SIMULATION'?'Komisi simulasi tercatat':'Komisi tercatat',money(s.bookedCommission)],['Biaya voucher',money(s.promoExpense)],[d.mode==='SIMULATION'?'Diterima (simulasi)':'Benar-benar diterima',money(s.collectedCommission)]];
 const e1=$('#admin-stats');if(e1)e1.innerHTML=stats.map(([n,v])=>`<div class="stat"><span>${n}</span><strong>${v}</strong></div>`).join('');
 const e2=$('#admin-drivers');if(e2)e2.innerHTML=d.drivers.length?d.drivers.map(x=>`<div class="list-row"><div><strong>${esc(x.full_name)} · @${esc(x.username)}</strong> <span class="tag ${x.driver_status==='APPROVED'?'success':'warning'}">${x.driver_status}</span><p>${esc(x.campus_email)} | ${esc(x.vehicle)} | ${esc(x.phone)}</p><div class="driver-document-links">${x.ktm_path?`<a href="${imageUrl(x.ktm_path)}" target="_blank" rel="noopener">Lihat KTM</a>`:'<span>Foto KTM belum tersedia</span>'}${x.sim_path?`<a href="${imageUrl(x.sim_path)}" target="_blank" rel="noopener">Lihat foto SIM ${esc(x.sim_type||'')}</a>`:'<span>Foto SIM belum tersedia</span>'}</div><p>${x.sim_type?'Jenis SIM: SIM '+esc(x.sim_type):'Jenis SIM belum dilengkapi'} &middot; Pernyataan SIM: ${x.sim_declared?'Ada':'Belum'}</p></div>${x.driver_status==='APPROVED'?'':`<div class="actions"><button class="button tiny" data-driverstatus="${x.id}" data-status="APPROVED">Setujui</button><button class="button secondary tiny" data-driverstatus="${x.id}" data-status="REJECTED">Tolak</button></div>`}</div>`).join(''):'<p class="muted small">Belum ada calon driver.</p>';
 const e3=$('#admin-ledger');if(e3)e3.innerHTML=d.fees.length?d.fees.map(l=>`<div class="list-row"><div><strong>${l.source_type==='SERVICE'?'Anjem / jasa':'Lapak'} · ${money(l.gross_fee)}</strong><p>Subsidi promo: ${money(l.promo_cost)} · Sudah ditagih/diterima: ${money(l.collected)} · Belum diterima: ${money(l.gross_fee-l.collected)}</p></div>${l.collected<l.gross_fee?`<button class="button secondary tiny" data-collect="${l.id}" data-maxcollect="${l.gross_fee-l.collected}">Catat diterima</button>`:'<span class="tag success">Lunas</span>'}</div>`).join(''):'<p class="muted small">Belum ada komisi dari transaksi yang selesai.</p>';
 }catch(e){toast(e.message,true);}}
async function changeDriverStatus(id,status){if(!await confirmAction({title:'Ubah status Penganjem?',message:`Status akan diubah menjadi ${status}. Pastikan dokumen asli telah diperiksa.`,confirmLabel:'Ubah status',cancelLabel:'Kembali',danger:status==='REJECTED'}))return;await post(`/api/admin/drivers/${id}/status`,{status});toast('Status driver diperbarui.');loadAdmin();}
async function collectLedger(id,max){const v=prompt(`Masukkan nominal yang BENAR-BENAR sudah diterima (maks ${money(max)}):`,String(max));if(v===null)return;await post(`/api/admin/ledger/${id}/collected`,{amount:Number(v.replaceAll(',',''))});toast('Penerimaan dikonfirmasi.');loadAdmin();}
let placeSearchSequence=0;
async function searchPlaces(){
 const query=$('#place-query')?.value.trim();if(!query||query.length<2)throw Error('Tulis nama tempat minimal dua karakter.');
 const box=$('#place-results');if(!box)return;
 const sequence=++placeSearchSequence,form=box.closest('form'),modern=!!form?.matches('[data-jastip-form]');
 box.setAttribute('aria-busy','true');box.innerHTML='<p class="form-hint" role="status">Mencari tempat belanja...</p>';
 try{
  const loc=modern?state.destinationCoords:state.coords;
  const a=await get('/api/places?q='+encodeURIComponent(query)+(loc?'&lat='+loc.lat+'&lng='+loc.lng:''));
  if(sequence!==placeSearchSequence||!box.isConnected)return;
  state.places=a.places||[];
  box.innerHTML=state.places.length?state.places.map((p,i)=>`<button type="button" class="place ${modern?'jastip-place':''}" data-place="${i}"><span class="jastip-place-icon">${ico('store')}</span><span><strong>${esc(p.name)}</strong><span class="jastip-place-address">${esc(p.address)}</span><span class="jastip-place-rating">${p.rating?'Rating '+esc(p.rating):'Belum ada rating'} (${Number(p.count)||0} ulasan) - ${Number(p.visits)||0} jastip selesai</span></span>${ico('chevron','sm')}</button>`).join(''):'<p class="form-hint" role="status">Tempat belum ditemukan. Coba kata lain atau isi nama dan alamat toko secara manual.</p>';
  if(!modern&&a.ranking)toast(a.ranking);
 }catch(e){
  if(sequence===placeSearchSequence&&box.isConnected)box.innerHTML='<p class="form-hint" role="alert">Pencarian belum tersedia. Kamu tetap bisa mengisi nama dan alamat toko secara manual.</p>';
  throw e;
 }finally{if(sequence===placeSearchSequence&&box.isConnected)box.setAttribute('aria-busy','false');}
}
function selectPlace(index){
 const p=state.places?.[index];if(!p)return;
 const form=$('#order-form'),modern=!!form?.matches('[data-jastip-form]');if(!form)return;
 state.selectedPlace=p;form.elements.place_id.value=p.id;form.elements.place_name.value=p.name;
 if(modern){
  form.elements.pickup.value=p.address||p.name;
  state.jastipPickupCoords=Number.isFinite(p.lat)&&Number.isFinite(p.lng)?{lat:p.lat,lng:p.lng}:null;
  updateJastipSummary(form);
 }
 $$('.place').forEach((el,i)=>{el.classList.toggle('selected',i===index);el.setAttribute('aria-pressed',String(i===index));});
 toast('Tempat dipilih: '+p.name);
}
function $$(selector){return [...document.querySelectorAll(selector)];}
async function gps(){return pickOrderLocation('pickup',{locate:true});}
async function pickOrderLocation(target,{locate=false,form=$('#order-form')}={}){
 if(!form||!['pickup','destination'].includes(target))return null;
 const input=form.elements[target],modern=form.matches('[data-jastip-form]'),userId=state.user?.id;
 if(!input)return null;
 const initial=target==='destination'?state.destinationCoords:modern?state.jastipPickupCoords:state.coords;
 const title=target==='destination'?'Pilih lokasi antar':modern?'Pilih lokasi belanja':'Pilih lokasi jemput';
 const selected=await chooseLocation({title,initial,initialAddress:input.value,locate,tileUrl:state.config?.mapTileUrl});
 if(!selected||!form.isConnected||state.user?.id!==userId)return null;
 const coords={lat:selected.lat,lng:selected.lng};
 if(target==='destination')state.destinationCoords=coords;
 else{
  if(modern)state.jastipPickupCoords=coords;else state.coords=coords;
  state.selectedPlace=null;
  if(form.elements.place_id)form.elements.place_id.value='';
  form.querySelectorAll('[data-place]').forEach(button=>{button.classList.remove('selected');button.setAttribute('aria-pressed','false');});
 }
 input.value=selected.address;input.setCustomValidity('');
 const summary=$('[data-location-summary="'+target+'"]');if(summary)summary.textContent=selected.address;
 if(modern){
  const status=form.querySelector('#jastip-gps-status');if(status&&target==='destination')status.textContent='Lokasi antar dipilih di peta. Tambahkan nomor rumah atau patokan bila perlu.';
  updateJastipSummary(form);
 }
 toast('Lokasi '+(target==='destination'?'antar':modern?'belanja':'jemput')+' sudah dipilih.');
 return selected;
}
async function handleOrder(form){const b=pickFormValues(form);b.type=state.service;
 const pickupCoords=form.matches('[data-jastip-form]')?state.jastipPickupCoords:state.coords;
 if(pickupCoords){b.pickup_lat=pickupCoords.lat;b.pickup_lng=pickupCoords.lng;}
 if(state.destinationCoords){b.destination_lat=state.destinationCoords.lat;b.destination_lng=state.destinationCoords.lng;}
 if(state.selectedPlace&&state.service==='JASTIP'&&!form.matches('[data-jastip-form]')){b.place_id=state.selectedPlace.id;b.place_name=state.selectedPlace.name;}
 if(state.service==='DELIVERY')b.image=await file64(form.elements.image.files[0]);
 const result=await post('/api/orders',b);toast(`Order dibuat! Komisi platform ${money(result.order.platform_fee)} (catatan internal), potongan ${money(result.order.promo_discount)}.`);go('orders');loadOrders();}
function clearSelectedMap(){state.coords=null;state.destinationCoords=null;state.selectedPlace=null;state.jastipPickupCoords=null;state.driverFilter=null;}
// Semua handler dipasang satu kali agar tidak menggandakan event setelah setiap render.
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-market-menu],[data-orderchat],[data-action],[data-nav],[data-anchor],[data-service],[data-auth-tab],[data-detail],[data-negotiate],[data-buy],[data-claim],[data-completeorder],[data-cancelorder],[data-driverfilter],[data-driverstatus],[data-collect],[data-chat],[data-place]');if(!b)return;
 if(b.tagName==='A')event.preventDefault();const d=b.dataset;
 try{
 if(d.action==='scrim'&&event.target===b){await requestCloseModal();return;}if(d.action==='close-modal'){await requestCloseModal();return;}
 if(d.authTab){if(d.authTab!==state.authTab)clearSignupOtpState();state.authTab=d.authTab;renderAuthModal();return;}
 if('marketMenu' in d){
  if(state.page!=='market'){state.marketMenuOpen=true;go('market',{keepSidebar:true});}
  else {state.marketMenuOpen=!state.marketMenuOpen;b.setAttribute('aria-expanded',String(state.marketMenuOpen));const submenu=$('#market-submenu');if(submenu){submenu.classList.toggle('is-open',state.marketMenuOpen);submenu.inert=!state.marketMenuOpen;submenu.setAttribute('aria-hidden',String(!state.marketMenuOpen));}}
  return;
 }
 if(d.action==='side'){
 state.sideHidden=!state.sideHidden;
 localStorage.setItem('anjemin-side',String(state.sideHidden));
 $('.app-shell')?.classList.toggle('hidden-side',state.sideHidden);
 const sidebar=$('#app-sidebar');if(sidebar)sidebar.inert=state.sideHidden;
 b.setAttribute('aria-expanded',String(!state.sideHidden));
 b.title=b.ariaLabel=(state.sideHidden?'Tampilkan':'Sembunyikan')+' sidebar';
 return;
 }
 if(d.action==='theme'){
 const next=state.theme==='dark'?'light':'dark';
 const apply=()=>{setTheme(next);const button=$('[data-action="theme"]');if(button)button.innerHTML=ico(next==='dark'?'sun':'moon');};
 if(document.startViewTransition&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  if(state.themeTransition){await state.themeTransition.finished.catch(()=>{});}
  state.themeTransition=document.startViewTransition(apply);
 }else apply();
 return;
 }
 if(d.action==='login'){state.authTab='login';openModal('auth');return;}
 if(d.action==='change-password'){document.querySelector('.header-account-menu')?.removeAttribute('open');openModal('change-password');return;}
 if(d.action==='logout'){await logout();return;}
 if(d.action==='dismiss-otp-notice'){b.closest('.otp-delivery-toast')?.remove();return;}
 if(d.action==='focus-otp'){if(!$('#signup-otp')){state.authTab='signup';openModal('auth');}b.closest('.otp-delivery-toast')?.remove();setTimeout(()=>{const otp=$('#signup-otp'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;otp?.scrollIntoView({block:'center',behavior:reduced?'auto':'smooth'});otp?.focus();},80);return;}
 if(d.action==='change-otp-number'){resetSignupOtp('Silakan perbarui nomor, lalu kirim kode OTP baru.');const phone=$('#signup-phone');phone?.focus();phone?.select();return;}
 if(d.action==='request-otp'){await requestOTP();return;}if(d.action==='verify-otp'){await verifyOTP();return;}
 if(d.action==='add-listing'){if(requireLogin())openModal('listing');return;}
 if(d.action==='gps'){await gps();return;}
 if(d.action==='search-place'){await searchPlaces();return;}
 if(d.action==='toggle-ready'){await toggleReady();return;}
 if(d.action==='refresh-driver'){await loadDriverJobs();return;}
 if(d.action==='refresh-orders'){await loadOrders();return;}
 if(d.action==='refresh-admin'){await loadAdmin();return;}
 if(d.action==='copy-referral'){copyReferral();return;}
 if(d.action==='notifications'){openModal('notifications');return;}
 if(d.anchor){const target=document.getElementById(d.anchor);if(!target)go('home');setTimeout(()=>document.getElementById(d.anchor)?.scrollIntoView({behavior:'smooth'}),100);return;}
 if(d.service){if(!requireLogin())return;if(d.service==='MARKET')go('market');else{if(state.page==='service'&&state.serviceChosen&&state.service===d.service)return;state.service=d.service;state.serviceChosen=true;clearSelectedMap();go('service');}return;}
 if(d.nav){if(!state.user&&!['home','privacy','terms','contact'].includes(d.nav)){openModal('auth');return;}if(d.nav==='service'){state.serviceChosen=false;clearSelectedMap();}go(d.nav);return;}
 if(d.detail){const item=state.listings.find(x=>x.id===d.detail);if(item)openModal('detail',{item});return;}
 if(d.negotiate){await startNego(d.negotiate);return;}
 if(d.buy){await buyListing(d.buy,d.price?Number(d.price):null);return;}
 if(d.claim){await claimOrder(d.claim);return;}
 if(d.completeorder){await completeOrder(d.completeorder);return;}
 if(d.cancelorder){await cancelOrder(d.cancelorder);return;}
 if(d.driverfilter){if(d.driverfilter==='MARKET'){go('market');return;}state.driverFilter=d.driverfilter;if($('#driver-type'))$('#driver-type').value=d.driverfilter;paintDriverJobs();toast('Filter: '+labels[d.driverfilter]);return;}
 if(d.driverstatus){await changeDriverStatus(d.driverstatus,d.status);return;}
 if(d.collect){await collectLedger(d.collect,Number(d.maxcollect));return;}
 if(d.orderchat){openModal('order-chat',{id:d.orderchat});return;}
 if(d.chat){await loadMessages(d.chat);return;}
 if(d.place){selectPlace(Number(d.place));return;}
 }catch(e){toast(e.message||'Terjadi kesalahan.',true);}
});
document.addEventListener('change',event=>{if(event.target.matches('[name="role"]'))setAuthRole(event.target.value);if(event.target.matches('#market-category'))paintListings();if(event.target.matches('#signup-phone'))handleSignupPhoneEdit(event.target);});
document.addEventListener('input',event=>{if(event.target.matches('[data-money]'))formatMoneyInput(event.target);if(event.target.matches('#market-query'))paintListings();if(event.target.matches('#signup-phone'))handleSignupPhoneEdit(event.target);if(event.target.matches('#signup-otp'))handleSignupOtpInput(event.target);});
function formatMoneyInput(input){
 const before=input.value,position=input.selectionStart??before.length;
 const digitsBefore=before.slice(0,position).replace(/[^0-9]/g,'').length;
 const digits=before.replace(/[^0-9]/g,'').replace(/^0+(?=\d)/,'');
 input.value=digits.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 let cursor=0,count=0;
 while(cursor<input.value.length&&count<digitsBefore){if(/[0-9]/.test(input.value[cursor]))count++;cursor++;}
 input.setSelectionRange(cursor,cursor);
 const value=Number(digits),min=Number(input.dataset.min||0),max=Number(input.dataset.max||Number.MAX_SAFE_INTEGER);
 input.setCustomValidity(digits&&(!Number.isSafeInteger(value)||value<min||value>max)?`Masukkan nominal antara ${money(min)} dan ${money(max)}.`:'');
}
document.addEventListener('keydown',event=>{
 const confirmation=activeConfirmation?.overlay;
 if(event.key==='Enter'&&event.target.matches('#signup-otp')){event.preventDefault();const verify=$('#signup-otp-panel [data-action="verify-otp"]');if(verify&&!verify.disabled)verify.click();return;}
 if(event.key==='Escape'&&(activeConfirmation||state.modal)){event.preventDefault();if(activeConfirmation)activeConfirmation.finish(false);else requestCloseModal();}
 if(event.key==='Tab'&&confirmation){const controls=[...confirmation.querySelectorAll('button:not(:disabled)')];if(controls.length){const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
 if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-service]')){event.preventDefault();event.target.click();}
});
document.addEventListener('submit',async event=>{
 if(!['login-form','signup-form','listing-form','order-form','message-form','order-message-form'].includes(event.target.id))return;
 event.preventDefault();const form=event.target;if(form.matches('[data-jastip-form]')){const step=Number(form.dataset.step);if(step<3){setJastipStep(form,step+1);return;}if(!validateJastipFields(form,[1,2,3]))return;}const btn=form.querySelector('[type="submit"]');if(btn){btn.disabled=true;btn.dataset.old=btn.textContent;btn.textContent='Memproses...';}
 try{if(form.id==='login-form')await handleLogin(form);
 else if(form.id==='signup-form')await handleSignup(form);
 else if(form.id==='listing-form')await addListing(form);
 else if(form.id==='order-form')await handleOrder(form);
 else if(form.id==='order-message-form')await sendOrderMessage(form);
 else if(form.id==='message-form')await sendMessage(form);
 }catch(e){toast(e.message||'Terjadi kendala. Silakan coba lagi.',true);}
 finally{if(btn?.isConnected){btn.disabled=false;btn.textContent=btn.dataset.old;}if(form.id==='order-message-form')updateOrderChatComposer();}
});
async function init(){setTheme(state.theme);try{state.config=await get('/api/config');await authRefresh();}catch(e){console.error(e);toast('Layanan belum terhubung. Silakan coba lagi nanti.',true);}
 state.page=state.user?dashboardRoute():'home';state.sideHidden=state.user&&window.innerWidth<760?true:state.sideHidden;
 try{
  render();if(!state.user){state.authTab='login';openModal('auth');}else{setupStream();if(state.page==='driver')loadDriverJobs();if(state.page==='admin')loadAdmin();}
 }finally{window.finishAnjeminBoot?.();}
}
setInterval(()=>{if(state.user&&['market-orders','market-history'].includes(state.page)&&!document.hidden)loadMarketOrders({quiet:true});if(state.user?.role==='DRIVER'&&state.ready&&state.page==='driver')loadDriverJobs();if(state.page==='chat'&&state.activeChat&&state.user)loadMessages(state.activeChat);},15000);
init();

let orderChatTimer;
let orderChatGeneration=0;
const orderMediaTypes=['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'];
function releaseOrderChatAttachment(m=state.modal){
 if(m?.attachment?.preview)URL.revokeObjectURL(m.attachment.preview);
 if(m){m.attachment=null;m.mediaRequestId=null;}
}
function orderMediaSize(bytes){return bytes>=1024*1024?(bytes/(1024*1024)).toLocaleString('id-ID',{maximumFractionDigits:2})+' MB':Math.ceil(bytes/1024)+' KB';}
function orderChatDate(value){
 const raw=String(value||''),iso=/Z$|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(' ','T')+'Z',date=new Date(iso);
 if(!Number.isFinite(date.getTime()))return {iso:'',key:'unknown',day:'Tanggal tidak tersedia',clock:'Waktu tidak tersedia'};
 const options={timeZone:'Asia/Jakarta'},key=date.toLocaleDateString('en-CA',options),today=new Date().toLocaleDateString('en-CA',options),yesterday=new Date(Date.now()-86400000).toLocaleDateString('en-CA',options);
 return {iso:date.toISOString(),key,day:key===today?'Hari ini':key===yesterday?'Kemarin':date.toLocaleDateString('id-ID',{...options,day:'numeric',month:'long',year:'numeric'}),clock:date.toLocaleTimeString('id-ID',{...options,hour:'2-digit',minute:'2-digit',hour12:false}).replace('.',':')+' WIB'};
}
function orderChatBubble(message){
 const mine=message.sender_id===state.user.id,time=orderChatDate(message.created_at),media=message.media;
 const attachment=media?(media.kind==='image'?`<a class="order-chat-picture" href="${esc(media.url)}" target="_blank" rel="noopener" aria-label="Buka foto dari @${esc(message.sender_name)}"><img src="${esc(media.url)}" alt="Foto dari @${esc(message.sender_name)}" loading="lazy"/></a>`:`<video class="order-chat-video" src="${esc(media.url)}" controls playsinline preload="metadata" aria-label="Video dari @${esc(message.sender_name)}"></video>`):'';
 return `<article class="order-chat-bubble ${mine?'is-mine':'is-theirs'}" data-order-message="${message.id}"><span class="order-chat-author">${mine?'Kamu':'@'+esc(message.sender_name)}</span>${attachment}${!message.media_only?`<p class="order-chat-text">${esc(message.body)}</p>`:''}<div class="order-chat-meta"><time datetime="${esc(time.iso)}" title="${esc(time.day+' '+time.clock)}">${esc(time.clock)}</time>${mine?orderReceiptHtml(message):''}</div></article>`;
}
function appendOrderChatMessages(messages,m){
 const box=$('#order-chat-messages');if(!box||!messages.length)return;
 $('#order-chat-empty')?.remove();
 const follow=m.chatPinned!==false||box.scrollHeight-box.scrollTop-box.clientHeight<60;
 for(const message of messages){
  if(m.messageIds.has(message.id))continue;m.messageIds.add(message.id);
  const date=orderChatDate(message.created_at);
  if(m.lastChatDay!==date.key){box.insertAdjacentHTML('beforeend',`<div class="order-chat-day" role="separator" aria-label="${esc(date.day)}"><span>${esc(date.day)}</span></div>`);m.lastChatDay=date.key;}
  box.insertAdjacentHTML('beforeend',orderChatBubble(message));
 }
 m.chatPinned=follow;if(follow)box.scrollTop=box.scrollHeight;
}
function paintOrderChatAttachment(m=state.modal){
 const box=$('#order-chat-attachment-preview');if(!box||m?.which!=='order-chat')return;
 const a=m.attachment;box.hidden=!a;
 if(!a){box.innerHTML='';return;}
 box.innerHTML=`${a.file.type.startsWith('image/')?`<img src="${esc(a.preview)}" alt="Pratinjau lampiran"/>`:'<span class="order-chat-file-icon">'+ico('video')+'</span>'}<div><strong>${esc(a.file.name)}</strong><span>${orderMediaSize(a.file.size)} &middot; Belum dikirim</span></div><button class="iconbtn" type="button" data-order-media-remove aria-label="Hapus lampiran">${ico('x','sm')}</button>`;
}
function updateOrderChatComposer(m=state.modal){
 const form=$('#order-message-form');if(!form||m?.which!=='order-chat')return;
 const active=!!m.chatActive,usage=m.mediaUsage||{used:0,remaining:3*1024*1024,limit:3*1024*1024},file=m.attachment?.file,tooLarge=!!file&&file.size>usage.remaining;
 form.elements.body.disabled=!active;
 $('#order-chat-media-picker').disabled=!active||usage.remaining<=0;
 $('#order-chat-attach').disabled=!active||usage.remaining<=0||!!m.sending;
 $('#order-chat-send').disabled=!active||!!m.sending||(!form.elements.body.value.trim()&&!file)||tooLarge;
 $('#order-chat-media-budget').textContent='Media '+orderMediaSize(usage.used)+' / 3 MB';
 $('#order-chat-media-progress').value=usage.used;
 const hint=$('#order-chat-media-hint');hint.textContent=tooLarge?'Lampiran melebihi sisa kuota '+orderMediaSize(usage.remaining)+'. Pilih berkas lebih kecil.':usage.remaining<=0?'Kuota media pesanan ini sudah penuh. Kamu tetap bisa mengirim teks.':'Foto atau video pendek. Total maksimal 3 MB per pesanan untuk kedua pihak.';
 hint.classList.toggle('is-error',tooLarge);
}
function renderOrderChat(id){
 clearTimeout(orderChatTimer);const generation=++orderChatGeneration,m=state.modal;cleanupOrderChatReceipts(m);
 m.messageIds=new Set();m.lastChatDay=null;m.chatPinned=true;m.chatActive=false;
 $('#modal-root').innerHTML=modalWrap('Chat pesanan',`<section class="order-chat-panel"><div class="order-chat-header"><div id="order-chat-partner"></div><span id="order-chat-status" class="order-chat-status" role="status">Memuat chat...</span></div><p class="order-chat-privacy">Koordinasi pesanan di sini. Nomor telepon tetap privat.</p><div id="order-chat-messages" class="order-chat-thread" role="log" aria-label="Percakapan pesanan" aria-live="polite" aria-relevant="additions"><div id="order-chat-empty" class="order-chat-empty">${ico('chat','lg')}<strong>Percakapan pesananmu</strong><span>Kirim pesan, foto, atau video untuk memudahkan koordinasi.</span></div></div><form id="order-message-form" class="order-chat-composer"><input type="hidden" name="order_id" value="${esc(id)}"/><input id="order-chat-media-picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" hidden disabled/><div id="order-chat-attachment-preview" class="order-chat-attachment-preview" hidden></div><div class="order-chat-compose-row"><button id="order-chat-attach" class="iconbtn" type="button" data-order-media-attach aria-label="Lampirkan foto atau video" title="Kirim foto atau video" disabled>${ico('image')}</button><textarea name="body" rows="1" aria-label="Pesan" placeholder="Tulis pesan..." maxlength="1000" disabled>${esc(m.draftText||'')}</textarea><button id="order-chat-send" class="button" type="submit" disabled>Kirim</button></div><div class="order-chat-budget"><span id="order-chat-media-budget">Media 0 KB / 3 MB</span><progress id="order-chat-media-progress" max="3145728" value="0" aria-label="Kuota media pesanan"></progress></div><p id="order-chat-media-hint" class="order-chat-media-hint">Foto atau video pendek. Total maksimal 3 MB per pesanan untuk kedua pihak.</p></form></section>`,true);
 paintOrderChatAttachment(m);setupOrderChatReceipts(m);
 $('#order-chat-messages').addEventListener('scroll',e=>{m.chatPinned=e.target.scrollHeight-e.target.scrollTop-e.target.clientHeight<60;});
 let after=0,busy=false,refreshAgain=false;
 async function refresh(){
  if(state.modal!==m||generation!==orderChatGeneration)return;
  if(busy){refreshAgain=true;return;}busy=true;clearTimeout(orderChatTimer);
  let more=false;
  try{
   const d=await get(`/api/orders/${id}/messages?after=${after}`);if(state.modal!==m||generation!==orderChatGeneration)return;
   const partner=d.order.customer_id===state.user.id?d.order.driver_name:d.order.customer_name,identity=d.order.customer_id===state.user.id?d.order.driver_profile:d.order.customer_profile;
   $('#order-chat-partner').innerHTML=identity?identityChip(identity):'Chat dengan @'+esc(partner);
   m.chatActive=d.order.status==='CLAIMED';m.mediaUsage=d.media_usage;
   const status=$('#order-chat-status');status.textContent=m.chatActive?'Chat aktif':'Riwayat chat';status.classList.toggle('is-active',m.chatActive);
   $('#order-chat-media-hint').hidden=!m.chatActive;
   appendOrderChatMessages(d.messages,m);observeOrderChatMessages(d.messages,m);applyOrderChatReceipts(d.receipts);queueOrderReadReceipts(m);
   confirmOrderChatDelivery(d.messages,m.receiptOwner).catch(()=>{});if(d.messages.length)after=d.messages.at(-1).id;
   more=d.has_more;updateOrderChatComposer(m);
   if(!m.chatActive)$('#order-chat-media-hint').hidden=false,$('#order-chat-media-hint').textContent='Pesanan sudah berakhir. Pesan dan media tetap dapat dilihat.';
  }catch(e){if(state.modal===m)$('#order-chat-status').textContent='Belum tersambung';}
  finally{busy=false;if(state.modal===m&&generation===orderChatGeneration){const immediate=refreshAgain||more;refreshAgain=false;orderChatTimer=setTimeout(refresh,immediate?0:2000);}}
 }
 m.refreshOrderChat=refresh;refresh();
}
async function orderChatFile64(file){
 if(!orderMediaTypes.includes(file.type)||file.size>3*1024*1024)throw Error('Pilih foto atau video maksimal 3 MB.');
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Media belum bisa dibaca. Pilih ulang berkas.'));reader.readAsDataURL(file);});
}
async function sendOrderMessage(form){
 const m=state.modal,owner=state.user.id;if(m?.which!=='order-chat'||m.sending)return;
 const body=form.elements.body.value.trim(),file=m.attachment?.file;
 if(!body&&!file)throw Error('Tulis pesan atau pilih foto/video terlebih dahulu.');
 if(file&&file.size>(m.mediaUsage?.remaining??3*1024*1024))throw Error('Lampiran melebihi sisa kuota media pesanan.');
 m.sending=true;updateOrderChatComposer(m);
 try{
  const payload={body};if(file){payload.media=await orderChatFile64(file);payload.request_id=m.mediaRequestId||(m.mediaRequestId=crypto.randomUUID());}
  if(state.modal!==m||state.user?.id!==owner)return;
  const result=await post(`/api/orders/${form.elements.order_id.value}/messages`,payload);if(state.modal!==m)return;
  form.elements.body.value='';m.draftText='';m.mediaUsage=result.media_usage;
  releaseOrderChatAttachment(m);$('#order-chat-media-picker').value='';paintOrderChatAttachment(m);m.chatPinned=true;
  await m.refreshOrderChat();
 }catch(e){if(state.modal===m)m.refreshOrderChat();throw e;}
 finally{m.sending=false;if(state.modal===m)updateOrderChatComposer(m);}
}
document.addEventListener('input',e=>{
 if(!e.target.matches('#order-message-form [name="body"]'))return;
 const m=state.modal;if(m?.which==='order-chat'){m.draftText=e.target.value;m.mediaRequestId=null;updateOrderChatComposer(m);}
});
document.addEventListener('keydown',e=>{
 if(e.target.matches('#order-message-form [name="body"]')&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('#order-chat-send').disabled)e.target.form.requestSubmit();}
});
document.addEventListener('click',e=>{
 if(e.target.closest('[data-order-media-attach]'))$('#order-chat-media-picker')?.click();
 if(e.target.closest('[data-order-media-remove]')){releaseOrderChatAttachment();$('#order-chat-media-picker').value='';paintOrderChatAttachment();updateOrderChatComposer();}
});
document.addEventListener('change',e=>{
 if(e.target.id!=='order-chat-media-picker')return;
 const m=state.modal,file=e.target.files[0];if(m?.which!=='order-chat'||!file)return;
 try{
  if(!orderMediaTypes.includes(file.type))throw Error('Gunakan JPG, PNG, WebP, GIF, MP4, atau WebM.');
  if(file.size>(m.mediaUsage?.remaining??3*1024*1024))throw Error('Media melebihi sisa kuota pesanan '+orderMediaSize(m.mediaUsage?.remaining??3*1024*1024)+'.');
  releaseOrderChatAttachment(m);m.attachment={file,preview:URL.createObjectURL(file)};paintOrderChatAttachment(m);updateOrderChatComposer(m);
 }catch(err){e.target.value='';toast(err.message,true);}
});
for(const event of ['load','loadedmetadata'])document.addEventListener(event,e=>{
 if(!e.target.matches?.('.order-chat-picture img,.order-chat-video'))return;
 const box=$('#order-chat-messages');if(box&&state.modal?.chatPinned)box.scrollTop=box.scrollHeight;
},true);
function listingGallery(item,detail=false){
 let paths=[];try{paths=JSON.parse(item.image_paths||'[]');}catch{}
 if(!Array.isArray(paths)||!paths.length)paths=[item.image_path];
 paths=paths.filter(path=>typeof path==='string'&&path).slice(0,5);
 return `<div class="listing-gallery ${detail?'gallery-detail':''}" data-gallery data-index="0" role="region" aria-label="Foto ${esc(item.title)}"><div class="gallery-track">${paths.map((path,index)=>`<img class="product-photo" src="${imageUrl(path)}" alt="${esc(item.title)} - foto ${index+1}" loading="lazy"/>`).join('')}</div>${paths.length>1?`<div class="gallery-controls"><button type="button" data-gallery-step="-1" aria-label="Foto sebelumnya">&#8249;</button><span class="gallery-counter">1 / ${paths.length}</span><button type="button" data-gallery-step="1" aria-label="Foto berikutnya">&#8250;</button></div>`:''}</div>`;
}
function advanceGallery(gallery,step){
 const track=gallery.querySelector('.gallery-track'),count=track.children.length;
 if(count<2)return;
 const index=(Number(gallery.dataset.index)+step+count)%count;
 gallery.dataset.index=String(index);track.style.transform=`translateX(-${index*100}%)`;
 gallery.querySelector('.gallery-counter').textContent=`${index+1} / ${count}`;
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-gallery-step]');if(!button)return;
 const gallery=button.closest('[data-gallery]');advanceGallery(gallery,Number(button.dataset.galleryStep));gallery.dataset.lastInteraction=String(Date.now());
});
setInterval(()=>{
 if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 document.querySelectorAll('[data-gallery]').forEach(gallery=>{
  const rect=gallery.getBoundingClientRect();
  if(rect.bottom<=0||rect.top>=window.innerHeight||gallery.matches(':hover')||gallery.contains(document.activeElement)||Date.now()-Number(gallery.dataset.lastInteraction||0)<4000)return;
  advanceGallery(gallery,1);
 });
},4000);

function releaseListingPhotos(){
 for(const photo of state.modal?.photos||[])URL.revokeObjectURL(photo.url);
}
function paintListingPhotos(){
 const container=$('#listing-photo-previews');if(!container||state.modal?.which!=='listing')return;
 const photos=state.modal.photos??=[];
 container.innerHTML=photos.map((photo,index)=>`<div class="listing-photo-preview"><img src="${esc(photo.url)}" alt="Foto barang ${index+1}"/><span class="listing-photo-label">${index===0?'Cover':'Foto '+(index+1)}</span><button type="button" class="listing-photo-remove" data-remove-listing-photo="${index}" aria-label="Hapus foto ${index+1}">&times;</button></div>`).join('')+(photos.length<5?`<button type="button" class="listing-photo-add" data-add-listing-photo><span aria-hidden="true">+</span>Tambah foto</button>`:'');
 const total=photos.reduce((sum,photo)=>sum+photo.file.size,0);
 $('#listing-photo-count').textContent=`${photos.length}/5 foto - ${(total/1024/1024).toFixed(2)} MB dari 4 MB. Foto pertama menjadi cover.`;
}
document.addEventListener('click',event=>{
 if(event.target.closest('[data-add-listing-photo]')){$('#listing-photo-picker')?.click();return;}
 const remove=event.target.closest('[data-remove-listing-photo]');if(!remove||state.modal?.which!=='listing')return;
 const index=Number(remove.dataset.removeListingPhoto),photos=state.modal.photos||[];
 if(!photos[index])return;URL.revokeObjectURL(photos[index].url);photos.splice(index,1);paintListingPhotos();
});
document.addEventListener('change',event=>{
 if(event.target.id!=='listing-photo-picker'||state.modal?.which!=='listing')return;
 const input=event.target,files=[...input.files],photos=state.modal.photos??=[];
 input.value='';if(!files.length)return;
 if(photos.length+files.length>5){toast('Maksimal 5 foto. Hapus foto sebelum menambah yang baru.',true);return;}
 if(files.some(file=>!['image/png','image/jpeg','image/webp'].includes(file.type))){toast('Foto harus PNG, JPG, atau WebP.',true);return;}
 if([...photos.map(photo=>photo.file),...files].reduce((sum,file)=>sum+file.size,0)>4*1024*1024){toast('Total ukuran semua foto maksimal 4MB.',true);return;}
 photos.push(...files.map(file=>({file,url:URL.createObjectURL(file)})));paintListingPhotos();
});

function y2kBackdrop(){
 const shapes={
 spark:'<path d="M40 3C44 27 53 36 77 40 53 44 44 53 40 77 36 53 27 44 3 40 27 36 36 27 40 3Z"/>',
 star:'<path d="m40 5 10 23 25 3-19 17 5 26-21-13-21 13 5-26L5 31l25-3Z"/>',
 orbit:'<circle cx="40" cy="40" r="19"/><ellipse cx="40" cy="40" rx="36" ry="11" transform="rotate(-30 40 40)"/><circle class="orbit-dot" cx="69" cy="22" r="4"/>',
 ring:'<circle cx="40" cy="40" r="29"/><circle cx="40" cy="40" r="19"/>',
 cross:'<path d="M40 14v52M14 40h52"/>'
 };
 return `<div class="y2k-backdrop" aria-hidden="true">${['spark','orbit','star','ring','spark','cross','orbit','star','ring','spark'].map((shape,index)=>`<span class="y2k-ornament y2k-${shape} y2k-pos-${index}"><svg viewBox="0 0 80 80" focusable="false">${shapes[shape]}</svg></span>`).join('')}<span class="y2k-halo y2k-halo-one"></span><span class="y2k-halo y2k-halo-two"></span></div>`;
}

function paymentEnvironment(mode){
 return mode==='SIMULATION'?'SIMULASI - tidak menggunakan uang sungguhan.':mode==='MIDTRANS_SANDBOX'?'SANDBOX Midtrans - pembayaran uji coba.':mode==='MIDTRANS_LIVE'?'QRIS Midtrans.':'Pembayaran belum diaktifkan.';
}
function paymentLabel(p){return {CREATING:'Menyiapkan pembayaran',PENDING:'Menunggu pembayaran',HELD:'Lunas',RELEASED:'Lunas - saldo masuk',EXPIRED:'Pembayaran kedaluwarsa',FAILED:'Pembayaran gagal'}[p?.status]||'Belum dibayar';}
function paymentActions(o){
 if(!o.payment_required)return '';
 const p=o.payment,customer=o.customer_id===state.user.id,paid=['HELD','RELEASED'].includes(p?.status);
 const tone=o.status==='CANCELLED'||o.status==='OPEN'?'neutral':paid?'paid':'unpaid';
 const label=o.status==='CANCELLED'?'Dibatalkan':o.status==='OPEN'?'Menunggu penganjem':paymentLabel(p);
 let html='<div class="order-payment-actions"><span class="payment-status payment-'+tone+'"><span aria-hidden="true">'+(paid?'&#10003;':tone==='unpaid'?'!':'&#8226;')+'</span>'+esc(label)+'</span>';
 if(['CLAIMED','COMPLETED'].includes(o.status)&&(customer||p))html+='<button class="button tiny payment-detail payment-'+(paid?'paid':'unpaid')+'" data-payment="'+o.id+'">'+(customer&&!paid?'Bayar sekarang':'Detail pembayaran')+'</button>';
 if(o.status==='CLAIMED'&&p?.status==='HELD'){
  if(!customer&&!o.delivery_reported_at)html+='<button class="button tiny" data-delivered="'+o.id+'">Selesai antar</button>';
  if(o.delivery_reported_at)html+=customer?'<button class="button tiny" data-confirmfinish="'+o.id+'">Konfirmasi selesai</button>':'<span class="tag warning">Menunggu konfirmasi</span>';
 }
 return html+'</div>';
}
function walletPage(){return '<div class="dash-top"><div><span class="kicker">Pendapatan</span><h1>Saldo Penganjem</h1><p>Dana tertahan dilepas setelah konfirmasi customer.</p></div><button class="button secondary tiny" data-walletrefresh>Refresh</button></div><div id="wallet-results" aria-live="polite">Memuat saldo...</div>';}
function walletCards(d){
 return '<div class="note warning">'+esc(paymentEnvironment(d.mode))+'</div><div class="form-row"><div class="card"><p>Dana tertahan</p><h2>'+money(d.held)+'</h2><p class="small">Belum bisa digunakan.</p></div><div class="card"><p>Saldo tersedia</p><h2>'+money(d.available)+'</h2><p class="small">Pendapatan setelah komisi dan bonus pencapaian.</p>'+(d.rewards?'<p class="wallet-reward-total">'+ico('trophy','sm')+' Termasuk reward '+money(d.rewards)+'</p>':'')+'</div></div><p class="form-hint">Pencairan uang sungguhan belum diaktifkan. Penarikan simulasi dicatat pada saldo aplikasi.</p>';
}
function walletActivityDate(value){
 const raw=String(value||'');
 const date=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?raw:raw.replace(' ','T')+'Z');
 return Number.isNaN(date.getTime())?raw:date.toLocaleString('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' WIB';
}
function walletActivity({title,detail,date,amount,outgoing=false,reward=false}){
 return `<li class="wallet-activity ${outgoing?'is-outgoing':'is-incoming'}"><span class="activity-icon" aria-hidden="true">${reward?ico('trophy','sm'):outgoing?'&nearr;':'&swarr;'}</span><div class="activity-info"><strong>${esc(title)}</strong><span>${esc(detail)}</span><time>${esc(walletActivityDate(date))}</time></div><div class="activity-value"><strong>${outgoing?'&minus;':'+'}${money(amount)}</strong><span>${outgoing?'Simulasi':'Saldo masuk'}</span></div></li>`;
}
function walletHistory(title,rows,renderRow,empty){
 return `<section class="card wallet-history"><div class="card-head"><div><span class="kicker">Aktivitas saldo</span><h3>${title}</h3></div><span class="activity-count">${rows.length} transaksi</span></div>${rows.length?`<div class="activity-columns" aria-hidden="true"><span>Transaksi / waktu</span><span>Nominal</span></div><ul class="activity-list" aria-label="${title}">${rows.map(renderRow).join('')}</ul>`:`<div class="activity-empty"><span aria-hidden="true">${ico('history','lg')}</span><div><strong>Belum ada transaksi</strong><p>${empty}</p></div></div>`}</section>`;
}
async function loadWallet(){
 try{
  const d=await get('/api/driver/wallet'),el=$('#wallet-results');refreshHeaderWallet(true);if(!el)return;
  el.innerHTML=walletCards(d)+`<section class="card wallet-withdraw"><div class="card-head"><div><span class="kicker">Pencairan saldo</span><h3>Siap tarik pendapatanmu?</h3><p class="small muted">Cairkan ke rekening bank atau e-wallet.</p></div><button type="button" class="button" data-driver-withdraw ${d.withdrawalSimulationEnabled&&d.available>0?'':'disabled'}>Tarik Saldo &nearr;</button></div><p class="form-hint">${d.withdrawalSimulationEnabled?'Penarikan simulasi, tanpa transfer uang sungguhan.':'Pencairan belum tersedia pada mode pembayaran ini.'}</p></section>`+walletHistory('Riwayat penarikan',d.withdrawals||[],w=>walletActivity({title:withdrawalProviderName(d,w.channel,w.provider)+' '+w.masked_number,detail:w.account_name,date:w.created_at,amount:w.amount,outgoing:true}), 'Penarikan saldo akan muncul di sini.')+walletHistory('Riwayat saldo masuk',d.credits,c=>walletActivity({title:c.kind==='REWARD'?'Reward '+c.title+' / '+c.target+' anjeman':'Pesanan '+c.order_id.slice(0,8),detail:c.kind==='REWARD'?'Bonus pencapaian':'Pendapatan pesanan',date:c.created_at,amount:c.amount,reward:c.kind==='REWARD'}),'Pendapatan yang sudah dilepas akan muncul di sini.');
 }catch(e){toast(e.message,true);}
}
async function loadWalletSummary(){
 if(state.user?.role!=='DRIVER')return;
 try{const d=await get('/api/driver/wallet');const el=$('#wallet-summary');if(el)el.innerHTML=walletCards(d);}catch(e){toast(e.message,true);}
}
async function renderPaymentModal(id,refresh=false){
 const root=$('#modal-root');
 root.innerHTML=modalWrap('Pembayaran pesanan','<p role="status">Memuat pembayaran...</p>');
 try{
  let d=await (refresh?post('/api/orders/'+id+'/payment/refresh'):get('/api/orders/'+id+'/payment'));
  if(!d.payment&&state.user?.id===state.orders.find(o=>o.id===id)?.customer_id)d=await post('/api/orders/'+id+'/payment');
  if(state.modal?.which!=='payment'||state.modal.id!==id)return;
  const p=d.payment;if(!p)throw Error('Customer belum membuat pembayaran.');
  const customer=state.orders.find(o=>o.id===id)?.customer_id===state.user.id;
  let content='<div class="note warning">'+esc(paymentEnvironment(p.mode))+'</div><p>Nomor transaksi: <span style="overflow-wrap:anywhere">'+esc(p.id)+'</span></p><h2>'+money(p.amount)+'</h2><p role="status" class="payment-status payment-'+(['HELD','RELEASED'].includes(p.status)?'paid':'unpaid')+'"><strong>'+esc(paymentLabel(p))+'</strong></p>';
  if(p.status==='PENDING'){
   content+='<p>Batas bayar: '+esc(new Date(p.expires_at).toLocaleString('id-ID'))+'</p>';
   if(p.mode==='SIMULATION')content+='<div class="note">Ini invoice simulasi, bukan QRIS yang bisa dipindai. Tidak ada uang yang dipindahkan.</div>'+(customer?'<button class="button full" data-simulatepay="'+id+'">Simulasikan pembayaran berhasil</button>':'');
   else if(p.qr_url&&customer)content+='<img src="'+esc(p.qr_url)+'" alt="QRIS pembayaran pesanan" style="display:block;max-width:280px;width:100%;margin:20px auto;background:white;padding:12px"/><p class="small">Bayar sesuai nominal melalui aplikasi yang mendukung QRIS.</p>';
  }
  if(['FAILED','EXPIRED'].includes(p.status))content+='<div class="note warning">Hubungi pengelola untuk membuat ulang pembayaran. Jangan transfer di luar invoice ini.</div>';
  if(['HELD','RELEASED'].includes(p.status))content+='<p>'+ (p.status==='HELD'?'Pembayaran terverifikasi. Dana ditahan sampai customer mengonfirmasi selesai.':'Pendapatan sudah tercatat dalam saldo tersedia penganjem.')+'</p>';
  content+='<div class="form-actions"><button class="button secondary" data-refreshpay="'+id+'">Cek status pembayaran</button></div>';
  root.innerHTML=modalWrap('Pembayaran pesanan',content);
  if(state.page==='orders')loadOrders();
 }catch(e){
  if(state.modal?.which==='payment'&&state.modal.id===id)root.innerHTML=modalWrap('Pembayaran pesanan','<p role="alert">'+esc(e.message)+'</p><button class="button secondary" data-refreshpay="'+esc(id)+'">Cek status pembayaran</button>');
 }
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-payment],[data-refreshpay],[data-simulatepay],[data-delivered],[data-confirmfinish],[data-walletrefresh]');
 if(!b||b.disabled)return;
 b.disabled=true;
 try{
  const d=b.dataset;
  if(d.payment){openModal('payment',{id:d.payment});return;}
  if(d.refreshpay){await renderPaymentModal(d.refreshpay,true);return;}
  if(d.simulatepay){await post('/api/orders/'+d.simulatepay+'/payment/simulate');await renderPaymentModal(d.simulatepay);return;}
  if(d.delivered){const r=await post('/api/orders/'+d.delivered+'/delivered');toast(r.message);await loadOrders();return;}
  if(d.confirmfinish){await completeOrder(d.confirmfinish);return;}
  if('walletrefresh' in d)await loadWallet();
 }catch(e){toast(e.message,true);}
 finally{if(b.isConnected)b.disabled=false;}
});
setInterval(()=>{
 if(!state.user||document.hidden)return;
 if(state.page==='orders')loadOrders();
},10000);

const userRecapColumns=[['user_code','ID'],['full_name','Nama lengkap'],['username','Username'],['email','Email'],['phone','Telepon'],['role','Jenis akun'],['driver_status','Verifikasi penganjem'],['ready','Ready'],['campus_email','Email kampus'],['vehicle','Kendaraan'],['sim_type','Jenis SIM'],['sim_declared','Pernyataan SIM'],['referral_code','Kode referral'],['created_at','Tanggal daftar'],['account_status','Status akun'],['frozen_at','Dibekukan pada (UTC)'],['freeze_reason','Alasan pembekuan'],['orders_placed','Pesanan dibuat'],['jobs_completed','Order diantar selesai']];
let adminUsers=[];
function adminUsersPage(){return `<div class="dash-top"><div><span class="kicker">PENGELOLA</span><h1>Data Pengguna</h1><p>Rekap Customer ANJEMIN dan Penganjem. Geser tabel untuk melihat seluruh kolom.</p></div><div class="actions"><button class="button secondary tiny" data-action="refresh-users">Refresh</button><button class="button tiny" data-action="export-users">Ekspor CSV</button></div></div><div class="summary-grid" id="user-counts"></div><div class="card"><div class="user-filters"><label>Cari pengguna<input id="user-search" type="search" placeholder="Nama, username, email, nomor HP, atau ID"/></label><label>Jenis akun<select id="user-role"><option value="ALL">Semua</option><option value="CUSTOMER">Customer</option><option value="DRIVER">Penganjem</option></select></label><label>Verifikasi penganjem<select id="user-status"><option value="ALL">Semua status</option><option value="PENDING">Menunggu</option><option value="APPROVED">Disetujui</option><option value="REJECTED">Ditolak</option></select></label></div><p id="user-result-count" class="small muted" aria-live="polite"></p><div id="user-table" style="overflow-x:auto" tabindex="0" aria-label="Tabel data pengguna">Memuat...</div></div>`;}
function filteredAdminUsers(){const q=($('#user-search')?.value||'').trim().toLowerCase(),role=$('#user-role')?.value||'ALL',status=$('#user-status')?.value||'ALL';return adminUsers.filter(u=>(role==='ALL'||u.role===role)&&(status==='ALL'||(u.role==='DRIVER'&&u.driver_status===status))&&[u.user_code,u.id,u.full_name,u.username,u.email,u.phone].some(v=>String(v||'').toLowerCase().includes(q)));}
function recapValue(u,key){if(key==='sim_type')return u.role==='DRIVER'?(u.sim_type?'SIM '+u.sim_type:'Belum dilengkapi'):'-';if(key==='account_status')return u.account_status==='FROZEN'?'Dibekukan':'Aktif';if(key==='role')return u.role==='DRIVER'?'Penganjem':'Customer';if(['ready','sim_declared'].includes(key))return u.role==='DRIVER'?(u[key]?'Ya':'Tidak'):'-';if(key==='driver_status')return u.role==='DRIVER'?({PENDING:'Menunggu',APPROVED:'Disetujui',REJECTED:'Ditolak'}[u[key]]||u[key]):'-';return u[key]??'';}
function paintAdminUsers(){const el=$('#user-table');if(!el||state.user?.role!=='ADMIN')return;const rows=filteredAdminUsers();$('#user-result-count').textContent=`Menampilkan ${rows.length} dari ${adminUsers.length} pengguna. Ekspor mengikuti filter ini.`;el.innerHTML=rows.length?'<table class="user-recap"><thead><tr>'+userRecapColumns.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join('')+'<th scope="col">Tindakan akun</th></tr></thead><tbody>'+rows.map(u=>'<tr>'+userRecapColumns.map(([key])=>'<td>'+esc(recapValue(u,key))+'</td>').join('')+'<td>'+accountStatusButton(u)+'</td></tr>').join('')+'</tbody></table>':'<p>Tidak ada pengguna yang sesuai.</p>';}
async function loadAdminUsers(){if(state.user?.role!=='ADMIN')return;try{const d=await get('/api/admin/users');if(state.page!=='admin-users'||state.user?.role!=='ADMIN')return;adminUsers=d.users;$('#user-counts').innerHTML=[['Total pengguna',adminUsers.length],['Customer',adminUsers.filter(u=>u.role==='CUSTOMER').length],['Penganjem',adminUsers.filter(u=>u.role==='DRIVER').length],['Penganjem menunggu',adminUsers.filter(u=>u.driver_status==='PENDING').length]].map(([n,v])=>`<div class="stat"><span>${n}</span><strong>${v}</strong></div>`).join('');paintAdminUsers();}catch(e){const el=$('#user-table');if(el)el.textContent='Gagal memuat data. Klik Refresh untuk mencoba lagi.';toast(e.message,true);}}
function exportAdminUsers(){if(state.user?.role!=='ADMIN')return;const rows=filteredAdminUsers();if(!rows.length){toast('Tidak ada data untuk diekspor.');return;}const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,m=>"'"+m).replaceAll('"','""')+'"';const csv='\uFEFF'+[userRecapColumns.map(([,label])=>cell(label)).join(','),...rows.map(u=>userRecapColumns.map(([key])=>cell(recapValue(u,key))).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='anjemin-data-pengguna.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('input',e=>{if(e.target.id==='user-search')paintAdminUsers();});
document.addEventListener('change',e=>{if(['user-role','user-status'].includes(e.target.id))paintAdminUsers();});
document.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action==='refresh-users')loadAdminUsers();if(action==='export-users')exportAdminUsers();});

function driverOrderDistance(order,coords){
 if(!coords||order.pickup_lat==null||order.pickup_lng==null)return Infinity;
 const lat=Number(order.pickup_lat),lng=Number(order.pickup_lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return Infinity;
 const rad=n=>n*Math.PI/180,dLat=rad(lat-coords.lat),dLng=rad(lng-coords.lng);
 const a=Math.sin(dLat/2)**2+Math.cos(rad(coords.lat))*Math.cos(rad(lat))*Math.sin(dLng/2)**2;
 return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}
async function updateDriverGps(){
 if(state.user?.role!=='DRIVER'||state.driverGpsPending)return;
 state.driverGpsPending=true;
 const userId=state.user.id;
 try{
  const selected=await chooseLocation({title:'Atur lokasi saya',initial:state.driverCoords,locate:true,requireAddress:false,tileUrl:state.config?.mapTileUrl});
  if(!selected||state.user?.id!==userId||state.user.role!=='DRIVER')return;
  state.driverCoords={lat:selected.lat,lng:selected.lng};
  state.driverGpsMessage='Lokasi diperbarui dari titik yang kamu pilih. Jarak dihitung ke penjemputan.';
  const status=$('#driver-gps-status');if(status)status.textContent=state.driverGpsMessage;
  paintDriverJobs();
 }finally{state.driverGpsPending=false;}
}

document.addEventListener('change',e=>{
 if(e.target.id==='driver-sort'){state.driverSort=e.target.value;paintDriverJobs();if(state.driverSort==='NEAREST')updateDriverGps();}
 if(e.target.id==='driver-type'){state.driverFilter=e.target.value||null;paintDriverJobs();}
});
document.addEventListener('click',e=>{if(e.target.closest('[data-action="driver-gps"]'))updateDriverGps();});

let orderStampTimer;
function orderStampTime(order){
 if(state.user?.role!=='CUSTOMER'||order.customer_id!==state.user.id||order.status!=='COMPLETED')return Infinity;
 if(order.payment_required&&order.payment?.status!=='RELEASED')return Infinity;
 const timestamp=value=>{if(!value)return NaN;return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)?value:value.replace(' ','T')+'Z');};
 const completed=timestamp(order.completed_at),released=order.payment_required?timestamp(order.payment?.released_at):completed;
 return Number.isFinite(completed)&&Number.isFinite(released)?Math.max(completed,released)+120000:Infinity;
}
function showCompletedStamp(order){return Date.now()>=orderStampTime(order);}
function completedOrderStamp(){return '<div class="completed-order-note"><span class="completed-order-stamp"><span aria-hidden="true">&#10003;</span> Transaksi Selesai</span><p>Terima kasih sudah order di ANJEMIN!</p></div>';}
function scheduleOrderStamps(){
 clearTimeout(orderStampTimer);
 const next=Math.min(...state.orders.map(orderStampTime).filter(time=>time>Date.now()));
 if(Number.isFinite(next))orderStampTimer=setTimeout(()=>{if(state.page==='orders'&&state.user?.role==='CUSTOMER')paintOrders();},Math.min(Math.max(next-Date.now()+30,1),2147483647));
}

const reportCategories={DANGER:'Bahaya',SUSPICIOUS:'Aktivitas mencurigakan',LOST_ITEM:'Barang tertinggal'};
function renderOrderReportForm(id){$('#modal-root').innerHTML=modalWrap('Laporkan transaksi',`<p class="note warning">Jika sedang dalam bahaya, segera cari tempat aman dan bantuan langsung. Formulir ini tidak mengirim bantuan darurat secara otomatis.</p><form id="order-report-form" data-order-id="${esc(id)}"><div class="field"><label for="report-category">Apa yang terjadi?</label><select id="report-category" name="category" required>${Object.entries(reportCategories).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></div><div class="field"><label for="report-details">Ceritakan kejadiannya</label><textarea id="report-details" name="details" minlength="10" maxlength="2000" rows="4" required placeholder="Tuliskan kejadian, lokasi, atau ciri barang yang tertinggal."></textarea></div><p class="form-hint">Isi laporan dan kontak akunmu hanya dapat dilihat Pengelola untuk ditindaklanjuti.</p><button class="button full" type="submit">Kirim laporan</button></form>`);}
function orderReportsPage(driverOnly=false){
 const scope=state.driverReportScope||'ABOUT_DRIVER';
 return `<div class="dash-top"><div><span class="kicker">PENGELOLA</span><h1>${driverOnly?'Laporan Penganjem':'Laporan Transaksi'}</h1><p>${driverOnly?'Tinjau laporan terkait Penganjem dan tindak lanjuti akun yang perlu diperiksa.':'Khusus Pengelola. Tinjau laporan dan bekukan akun bila diperlukan.'}</p></div><button class="button secondary tiny" data-refreshreports>Refresh</button></div>${driverOnly?`<div class="user-filters driver-report-filters"><label for="driver-report-scope">Jenis laporan<select id="driver-report-scope"><option value="ABOUT_DRIVER" ${scope==='ABOUT_DRIVER'?'selected':''}>Laporan tentang Penganjem</option><option value="BY_DRIVER" ${scope==='BY_DRIVER'?'selected':''}>Laporan dari Penganjem</option></select></label><p class="small muted">Isi laporan hanya dapat dilihat Pengelola.</p></div>`:''}<div class="card"><p id="report-result-count" class="small muted" aria-live="polite"></p><div id="order-reports">Memuat laporan...</div></div>`;
}
let reportLoadSequence=0;
async function loadOrderReports(){
 if(state.user?.role!=='ADMIN'||!['admin-reports','admin-driver-reports'].includes(state.page))return;
 const page=state.page,scope=page==='admin-driver-reports'?(state.driverReportScope||'ABOUT_DRIVER'):'ALL',sequence=++reportLoadSequence;
 const loading=$('#order-reports');if(loading)loading.textContent='Memuat laporan...';
 const count=$('#report-result-count');if(count)count.textContent='';
 try{
  const d=await get('/api/admin/reports?scope='+encodeURIComponent(scope)),el=$('#order-reports');
  if(!el||state.user?.role!=='ADMIN'||state.page!==page||sequence!==reportLoadSequence)return;
  const summary=$('#report-result-count');if(summary)summary.textContent=`${d.reports.length} laporan | ${d.reports.filter(r=>r.status==='OPEN').length} perlu ditinjau`;
  el.innerHTML=d.reports.length?d.reports.map(r=>`<div class="list-row"><div><span class="tag ${r.status==='RESOLVED'?'success':'danger'}">${esc(reportCategories[r.category])} - ${r.status==='RESOLVED'?'Selesai':'Perlu ditinjau'}</span><p>Pelapor: <strong>${esc(r.full_name)}</strong> (@${esc(r.username)}) - ${esc(r.phone)}</p><p>${esc(r.pickup)} &rarr; ${esc(r.destination)}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.details)}</p><p class="small muted">${esc(r.created_at)} UTC | Pesanan ${esc(r.order_id)}</p><div class="report-account">${r.subject_id?`<p>Akun terkait: <strong>${esc(r.subject_name)}</strong> (@${esc(r.subject_username)}) <span class="tag ${r.subject_status==='FROZEN'?'danger':'success'}">${r.subject_status==='FROZEN'?'Dibekukan':'Aktif'}</span></p>${accountStatusButton({id:r.subject_id,full_name:r.subject_name,username:r.subject_username,user_code:r.subject_code,account_status:r.subject_status},r.id)}`:'<p class="small muted">Pesanan belum memiliki Penganjem. Akun dapat ditinjau melalui Data Pengguna.</p>'}</div></div>${r.status==='OPEN'?`<button class="button secondary tiny" data-resolvereport="${esc(r.id)}">Tandai selesai</button>`:''}</div>`).join(''):'<p>Belum ada laporan untuk pilihan ini.</p>';
 }catch(e){if(state.page===page&&sequence===reportLoadSequence){const el=$('#order-reports');if(el)el.textContent='Laporan belum dapat dimuat. Klik Refresh untuk mencoba lagi.';toast(e.message,true);}}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-reportorder],[data-refreshreports],[data-resolvereport]');if(!b)return;try{if(b.dataset.reportorder)openModal('report',{id:b.dataset.reportorder});if(b.hasAttribute('data-refreshreports'))await loadOrderReports();if(b.dataset.resolvereport){b.disabled=true;await post('/api/admin/reports/'+b.dataset.resolvereport+'/resolve');await loadOrderReports();}}catch(error){toast(error.message,true);b.disabled=false;}});
document.addEventListener('submit',async e=>{const form=e.target;if(form.id!=='order-report-form')return;e.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;try{const r=await post('/api/orders/'+form.dataset.orderId+'/reports',Object.fromEntries(new FormData(form)));closeModal();toast(r.message);}catch(error){toast(error.message,true);button.disabled=false;}});

function accountStatusButton(user,reportId=''){
 if(state.user?.role!=='ADMIN')return '';
 const frozen=user.account_status==='FROZEN';
 return `<button class="button tiny ${frozen?'secondary':'payment-unpaid'}" data-account-user="${esc(user.id)}" data-account-name="${esc(user.full_name)}" data-account-code="${esc(user.user_code)}" data-account-status="${frozen?'ACTIVE':'FROZEN'}" data-account-report="${esc(reportId)}">${frozen?'Aktifkan kembali':'Bekukan akun'}</button>`;
}
function renderAccountStatusForm(m){
 if(state.user?.role!=='ADMIN')return;
 const frozen=m.status==='FROZEN';
 $('#modal-root').innerHTML=modalWrap(frozen?'Bekukan akun':'Aktifkan kembali',`<p><strong>${esc(m.name)}</strong> <span class="tag">${esc(m.code)}</span></p><p class="note ${frozen?'warning':''}">${frozen?'Pengguna akan keluar dari semua sesi dan tidak dapat login atau melakukan aktivitas akun sampai diaktifkan kembali.':'Pengguna dapat login kembali. Penganjem perlu mengaktifkan Ready sendiri.'}</p><form id="account-status-form"><div class="field"><label for="account-reason">Alasan ${frozen?'pembekuan':'pengaktifan'}</label><textarea id="account-reason" name="reason" rows="3" minlength="5" maxlength="500" required placeholder="Catat alasan berdasarkan hasil peninjauan."></textarea></div><p class="form-hint">Tindakan dan alasan dicatat bersama akun Pengelola.</p><button class="button full ${frozen?'payment-unpaid':''}" type="submit">${frozen?'Bekukan akun ini':'Aktifkan akun ini'}</button></form>`);
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-account-user]');if(!b||state.user?.role!=='ADMIN')return;
 openModal('account-status',{id:b.dataset.accountUser,name:b.dataset.accountName,code:b.dataset.accountCode,status:b.dataset.accountStatus,reportId:b.dataset.accountReport});
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='account-status-form')return;e.preventDefault();
 const m=state.modal;if(state.user?.role!=='ADMIN'||m?.which!=='account-status')return;
 const button=e.target.querySelector('[type="submit"]');button.disabled=true;
 try{
  const r=await post('/api/admin/users/'+m.id+'/account-status',{status:m.status,reason:new FormData(e.target).get('reason'),report_id:m.reportId||null});
  closeModal();toast(r.message);
  if(['admin-reports','admin-driver-reports'].includes(state.page))await loadOrderReports();
  if(state.page==='admin-users')await loadAdminUsers();
 }catch(error){toast(error.message,true);button.disabled=false;}
});
function clearAccountSession(message){cleanupOrderChatReceipts();releaseOrderChatAttachment();releaseProfileDraft();
 state.stream?.close();state.stream=null;state.user=null;state.ready=false;state.orders=[];state.driverJobs=[];adminUsers=[];
 state.page='home';state.modal=null;state.authTab='login';state.sideHidden=false;
 render();openModal('auth');toast(message,true);
}
setInterval(async()=>{
 if(!state.user||document.hidden)return;
 try{const d=await get('/api/auth/me');if(!d.user&&state.user)clearAccountSession('Sesi berakhir. Silakan masuk kembali.');}catch{}
},15000);

document.addEventListener('change',e=>{
 if(e.target.id==='driver-report-scope'&&state.user?.role==='ADMIN'){
  state.driverReportScope=e.target.value;loadOrderReports();
 }
});

function landingSceneBackdrop(){
 return `<div class="landing-motion-backdrop" aria-hidden="true">
 <div class="landing-scene landing-scene-city">
  <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMax slice" focusable="false">
   <circle class="landing-scene-orb" cx="1165" cy="146" r="112"/>
   <g class="landing-cloud landing-cloud-a"><ellipse cx="198" cy="132" rx="78" ry="22"/><ellipse cx="153" cy="127" rx="36" ry="31"/><ellipse cx="215" cy="112" rx="45" ry="38"/><ellipse cx="268" cy="134" rx="36" ry="20"/></g>
   <g class="landing-scene-layer landing-scene-layer-far">
    <rect class="landing-silhouette-far" x="-45" y="316" width="148" height="274" rx="7"/><rect class="landing-silhouette-far" x="121" y="248" width="96" height="342" rx="7"/><rect class="landing-silhouette-far" x="239" y="354" width="142" height="236" rx="7"/><rect class="landing-silhouette-far" x="402" y="214" width="118" height="376" rx="7"/><rect class="landing-silhouette-far" x="542" y="302" width="170" height="288" rx="7"/><rect class="landing-silhouette-far" x="735" y="190" width="104" height="400" rx="7"/><rect class="landing-silhouette-far" x="862" y="277" width="145" height="313" rx="7"/><rect class="landing-silhouette-far" x="1028" y="231" width="128" height="359" rx="7"/><rect class="landing-silhouette-far" x="1180" y="326" width="126" height="264" rx="7"/><rect class="landing-silhouette-far" x="1326" y="257" width="150" height="333" rx="7"/>
    <path class="landing-silhouette-far" d="M436 214h50l-25-42Zm327-24h48l-24-38Zm294 41h70l-35-50Z"/>
   </g>
   <g class="landing-city-windows"><path d="M151 291h18v13h-18zm35 0h18v13h-18zm244-29h19v14h-19zm39 0h19v14h-19zm294-24h17v14h-17zm39 0h17v14h-17zm258 38h18v13h-18zm38 0h18v13h-18z"/><path class="landing-window-alt" d="M151 332h18v13h-18zm318-24h19v14h-19zm294-24h17v14h-17zm335 37h18v13h-18z"/></g>
   <g class="landing-scene-layer landing-scene-layer-near"><path class="landing-silhouette-near" d="M-30 480h205v112H-30zm270-54h190v166H240zm294 26h232v140H534zm333-43h204v183H867zm303 47h300v136h-300z"/></g>
   <path class="landing-ground" d="M-40 566c248-24 417 18 654-4 266-25 474 28 866-5v163H-40Z"/><path class="landing-road-line" d="M-20 620H1460"/>
  </svg>
 </div>
 <div class="landing-scene landing-scene-campus">
  <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMax slice" focusable="false">
   <circle class="landing-scene-orb landing-orb-mint" cx="266" cy="172" r="132"/>
   <g class="landing-cloud landing-cloud-b"><ellipse cx="1040" cy="135" rx="82" ry="22"/><ellipse cx="995" cy="130" rx="37" ry="31"/><ellipse cx="1055" cy="113" rx="46" ry="40"/><ellipse cx="1111" cy="136" rx="38" ry="21"/></g>
   <path class="landing-campus-hill" d="M-30 522c161-95 316-88 475-6 162 83 342 61 493-16 170-87 340-62 532 21v179H-30Z"/>
   <g class="landing-scene-layer landing-scene-layer-far landing-campus-building">
    <rect x="514" y="329" width="483" height="252" rx="12"/><path d="m480 332 275-150 278 150Z"/><rect class="landing-campus-cut" x="574" y="388" width="58" height="193" rx="27"/><rect class="landing-campus-cut" x="674" y="388" width="58" height="193" rx="27"/><rect class="landing-campus-cut" x="774" y="388" width="58" height="193" rx="27"/><rect class="landing-campus-cut" x="874" y="388" width="58" height="193" rx="27"/><circle class="landing-campus-cut" cx="755" cy="286" r="28"/>
   </g>
   <g transform="translate(151 371)"><g class="landing-scene-tree" style="--scene-tree-delay:-1s"><rect class="landing-tree-trunk" x="-9" y="68" width="18" height="144" rx="9"/><circle class="landing-tree-mint" cy="30" r="70"/><circle class="landing-tree-mint" cx="-48" cy="63" r="45"/><circle class="landing-tree-mint" cx="49" cy="65" r="47"/></g></g>
   <g transform="translate(1188 390)"><g class="landing-scene-tree" style="--scene-tree-delay:-4s"><rect class="landing-tree-trunk" x="-9" y="65" width="18" height="137" rx="9"/><circle class="landing-tree-lilac" cy="27" r="66"/><circle class="landing-tree-lilac" cx="-46" cy="58" r="43"/><circle class="landing-tree-lilac" cx="46" cy="60" r="44"/></g></g>
   <g transform="translate(356 455)"><g class="landing-scene-tree" style="--scene-tree-delay:-2.7s"><rect class="landing-tree-trunk" x="-6" y="45" width="12" height="92" rx="6"/><circle class="landing-tree-peach" cy="20" r="44"/><circle class="landing-tree-peach" cx="-31" cy="42" r="29"/><circle class="landing-tree-peach" cx="31" cy="42" r="30"/></g></g>
   <path class="landing-ground" d="M-30 576c264-34 434 25 701-2 269-27 478 19 799-4v150H-30Z"/><path class="landing-road-line" d="M-20 624H1460"/>
  </svg>
 </div>
 <div class="landing-scene landing-scene-market">
  <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMax slice" focusable="false">
   <circle class="landing-scene-orb landing-orb-peach" cx="1115" cy="173" r="145"/>
   <g class="landing-cloud landing-cloud-c"><ellipse cx="266" cy="154" rx="75" ry="20"/><ellipse cx="224" cy="148" rx="34" ry="29"/><ellipse cx="280" cy="132" rx="43" ry="37"/><ellipse cx="332" cy="155" rx="35" ry="19"/></g>
   <g class="landing-scene-layer landing-scene-layer-far landing-market-row">
    <rect x="58" y="355" width="286" height="228" rx="10"/><rect x="374" y="318" width="309" height="265" rx="10"/><rect x="713" y="367" width="281" height="216" rx="10"/><rect x="1024" y="330" width="350" height="253" rx="10"/>
    <path class="landing-market-roof" d="M41 355h320l-42-68H84Zm315-37h345l-44-72H402Zm340 49h315l-41-66H737Zm309-37h388l-49-78h-290Z"/>
    <path class="landing-market-awning" d="M58 397h286v42c-24 28-48 28-72 0-24 28-48 28-72 0-24 28-48 28-72 0-23 28-47 28-70 0Zm316-35h309v42c-26 28-52 28-78 0-26 28-52 28-78 0-25 28-51 28-77 0-25 28-51 28-76 0Zm339 49h281v40c-24 27-47 27-70 0-24 27-47 27-71 0-23 27-46 27-70 0-23 27-47 27-70 0Zm311-37h350v43c-29 29-58 29-87 0-29 29-58 29-88 0-29 29-58 29-87 0-29 29-58 29-88 0Z"/>
   </g>
   <g class="landing-market-lights"><circle cx="210" cy="497" r="11"/><circle cx="524" cy="472" r="11"/><circle cx="856" cy="505" r="11"/><circle cx="1199" cy="483" r="11"/></g>
   <g class="landing-street-lamp"><path d="M332 346v232m-24-231h49m-42 0c0-30 36-30 36 0"/><circle cx="333" cy="348" r="13"/></g><g class="landing-street-lamp landing-lamp-two"><path d="M1003 351v227m-24-226h49m-42 0c0-30 36-30 36 0"/><circle cx="1004" cy="353" r="13"/></g>
   <path class="landing-ground" d="M-30 574c219-21 411 20 666-2 277-23 484 21 834-3v151H-30Z"/><path class="landing-road-line" d="M-20 622H1460"/>
  </svg>
 </div>
 <div class="landing-rider-track">
  <svg class="landing-rider-silhouette" viewBox="0 0 220 110" focusable="false"><path class="landing-speed-line" d="M4 55h52M15 70h31M24 40h25"/><g class="landing-motor-bob"><g class="landing-wheel landing-wheel-back"><circle cx="52" cy="80" r="24"/><path d="M52 57v46M29 80h46M36 64l32 32m0-32L36 96"/></g><g class="landing-wheel landing-wheel-front"><circle cx="169" cy="80" r="24"/><path d="M169 57v46m-23-23h46m-39-16 32 32m0-32-32 32"/></g><path class="landing-bike-frame" d="M52 80 89 48l31 32H52l25-20m43 20 23-43h25l1 43M89 48l-9-18m-12 0h23m48 8h31"/><path class="landing-bike-body" d="M67 51h59c16 0 27 8 31 22H91c-17 0-27-7-24-22Z"/><circle class="landing-rider-head" cx="105" cy="18" r="12"/><path class="landing-rider-body" d="m100 30-20 28h38l18-15m-36-13 29 13 22-3"/><path class="landing-rider-helmet" d="M93 18c0-17 25-20 29-4l-1 7h-28Z"/><rect class="landing-rider-box" x="60" y="29" width="25" height="24" rx="5"/></g></svg>
 </div>
 <div class="landing-scene-dots"><i></i><i></i><i></i></div>
 </div>`;
}

function dashboardCityBackdrop(){
 return `<div class="dashboard-city-backdrop" aria-hidden="true">
 <svg class="dashboard-city-svg" viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" focusable="false">
  <g class="city-cloud city-cloud-one"><ellipse class="city-cloud-shape" cx="110" cy="58" rx="58" ry="18"/><ellipse class="city-cloud-shape" cx="76" cy="57" rx="27" ry="25"/><ellipse class="city-cloud-shape" cx="122" cy="45" rx="35" ry="31"/><ellipse class="city-cloud-shape" cx="160" cy="59" rx="30" ry="20"/></g>
  <g class="city-cloud city-cloud-two"><ellipse class="city-cloud-shape" cx="892" cy="82" rx="67" ry="18"/><ellipse class="city-cloud-shape" cx="858" cy="77" rx="31" ry="25"/><ellipse class="city-cloud-shape" cx="910" cy="65" rx="38" ry="32"/><ellipse class="city-cloud-shape" cx="953" cy="83" rx="28" ry="18"/></g>
  <path class="city-hill city-hill-back" d="M-30 246C95 174 197 214 305 181s209-20 319 31c105 49 184-20 287-28 110-8 196 38 319 2v134H-30Z"/>
  <g class="city-skyline city-skyline-back">
   <rect class="city-building-back" x="-30" y="184" width="110" height="118" rx="5"/><rect class="city-building-back" x="92" y="145" width="76" height="157" rx="5"/><rect class="city-building-back" x="180" y="201" width="105" height="101" rx="5"/><rect class="city-building-back" x="302" y="126" width="92" height="176" rx="5"/><rect class="city-building-back" x="410" y="173" width="132" height="129" rx="5"/><rect class="city-building-back" x="557" y="112" width="77" height="190" rx="5"/><rect class="city-building-back" x="650" y="188" width="118" height="114" rx="5"/><rect class="city-building-back" x="783" y="139" width="95" height="163" rx="5"/><rect class="city-building-back" x="894" y="178" width="128" height="124" rx="5"/><rect class="city-building-back" x="1038" y="121" width="82" height="181" rx="5"/><rect class="city-building-back" x="1136" y="164" width="104" height="138" rx="5"/>
   <path class="city-roof" d="M113 145h34l-17-30Zm215-19h40l-20-25Zm480 13h45l-22-28Zm252-18h40l-20-25Z"/>
   <g class="city-windows city-windows-a"><rect x="113" y="170" width="12" height="9" rx="2"/><rect x="136" y="170" width="12" height="9" rx="2"/><rect x="326" y="153" width="13" height="10" rx="2"/><rect x="351" y="153" width="13" height="10" rx="2"/><rect x="581" y="140" width="11" height="10" rx="2"/><rect x="606" y="140" width="11" height="10" rx="2"/><rect x="1061" y="149" width="12" height="10" rx="2"/><rect x="1085" y="149" width="12" height="10" rx="2"/></g>
   <g class="city-windows city-windows-b"><rect x="113" y="194" width="12" height="9" rx="2"/><rect x="351" y="181" width="13" height="10" rx="2"/><rect x="581" y="168" width="11" height="10" rx="2"/><rect x="807" y="169" width="12" height="10" rx="2"/><rect x="831" y="169" width="12" height="10" rx="2"/><rect x="1085" y="178" width="12" height="10" rx="2"/></g>
  </g>
  <g class="city-skyline city-skyline-front">
   <rect class="city-building-front" x="-40" y="239" width="155" height="67" rx="6"/><rect class="city-building-front" x="226" y="225" width="126" height="81" rx="6"/><rect class="city-building-front" x="455" y="236" width="150" height="70" rx="6"/><rect class="city-building-front" x="716" y="218" width="139" height="88" rx="6"/><rect class="city-building-front" x="977" y="232" width="145" height="74" rx="6"/><rect class="city-building-front" x="1160" y="211" width="96" height="95" rx="6"/>
  </g>
  <g transform="translate(72 232)"><g class="city-tree" style="--tree-delay:-1s"><rect class="city-tree-trunk" x="-4" y="31" width="8" height="40" rx="4"/><circle class="city-tree-crown city-tree-mint" cy="18" r="28"/><circle class="city-tree-crown city-tree-mint" cx="-17" cy="27" r="18"/><circle class="city-tree-crown city-tree-mint" cx="17" cy="28" r="19"/></g></g>
  <g transform="translate(188 247)"><g class="city-tree" style="--tree-delay:-3.2s"><rect class="city-tree-trunk" x="-3" y="23" width="7" height="35" rx="4"/><circle class="city-tree-crown city-tree-peach" cy="13" r="23"/><circle class="city-tree-crown city-tree-peach" cx="-14" cy="21" r="15"/><circle class="city-tree-crown city-tree-peach" cx="15" cy="22" r="16"/></g></g>
  <g transform="translate(642 238)"><g class="city-tree" style="--tree-delay:-4.5s"><rect class="city-tree-trunk" x="-4" y="28" width="8" height="40" rx="4"/><circle class="city-tree-crown city-tree-lilac" cy="15" r="27"/><circle class="city-tree-crown city-tree-lilac" cx="-17" cy="25" r="17"/><circle class="city-tree-crown city-tree-lilac" cx="18" cy="25" r="18"/></g></g>
  <g transform="translate(913 241)"><g class="city-tree" style="--tree-delay:-2.1s"><rect class="city-tree-trunk" x="-4" y="28" width="8" height="40" rx="4"/><circle class="city-tree-crown city-tree-mint" cy="15" r="26"/><circle class="city-tree-crown city-tree-mint" cx="-16" cy="24" r="17"/><circle class="city-tree-crown city-tree-mint" cx="17" cy="25" r="18"/></g></g>
  <g transform="translate(1134 235)"><g class="city-tree" style="--tree-delay:-5.4s"><rect class="city-tree-trunk" x="-4" y="31" width="8" height="40" rx="4"/><circle class="city-tree-crown city-tree-peach" cy="17" r="28"/><circle class="city-tree-crown city-tree-peach" cx="-17" cy="27" r="18"/><circle class="city-tree-crown city-tree-peach" cx="18" cy="27" r="19"/></g></g>
  <path class="city-ground" d="M-20 287C211 278 365 296 579 285c229-12 376 12 641-1v45H-20Z"/>
  <path class="city-road" d="M-20 304H1220"/><path class="city-road-dashes" d="M-20 304H1220"/>
 </svg></div>`;
}

function dashboardPromoScene(){
 // Each blink uses only the matching eye patches; the rest of the original scene stays still.
 return `<svg class="promo-scene-image" viewBox="0 0 1536 1024" width="1536" height="1024" role="img" aria-label="Penganjem naik motor dan dua mahasiswa dengan kedipan mata yang halus" focusable="false">
 <defs>
  <filter id="scene-eyelid-feather" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="1.2"/></filter>
  <mask id="scene-rider-eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1024"><g fill="white" filter="url(#scene-eyelid-feather)"><ellipse cx="546" cy="245" rx="26" ry="21"/><ellipse cx="605" cy="266" rx="23" ry="20"/></g></mask>
  <mask id="scene-student-eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1024"><g fill="white" filter="url(#scene-eyelid-feather)"><ellipse cx="863" cy="274" rx="17" ry="15"/><ellipse cx="900" cy="286" rx="16" ry="14"/></g></mask>
  <mask id="scene-shopper-eyes" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1024"><g fill="white" filter="url(#scene-eyelid-feather)"><ellipse cx="972" cy="329" rx="16" ry="14"/><ellipse cx="1009" cy="334" rx="16" ry="14"/></g></mask>
 </defs>
 <image href="/dashboard-promo-scene.png" width="1536" height="1024"/>
 <image class="promo-eye-blink blink-rider" href="/dashboard-promo-scene-blink.png" width="1536" height="1024" mask="url(#scene-rider-eyes)"/>
 <image class="promo-eye-blink blink-student" href="/dashboard-promo-scene-blink.png" width="1536" height="1024" mask="url(#scene-student-eyes)"/>
 <image class="promo-eye-blink blink-shopper" href="/dashboard-promo-scene-blink.png" width="1536" height="1024" mask="url(#scene-shopper-eyes)"/>
 </svg>`;
}

const profitModeNames={SIMULATION:'Simulasi',MIDTRANS_SANDBOX:'Uji coba gateway',MIDTRANS_LIVE:'Transaksi live',LEGACY:'Catatan lama'};
function profitStatsPage(){
 const mode=state.profitMode||(profitModeNames[state.config?.paymentMode]?state.config.paymentMode:'MIDTRANS_LIVE'),period=state.profitPeriod||'30';
 return `<div class="dash-top"><div><span class="kicker">PENGELOLA</span><h1>Statistik Keuntungan</h1><p>Pantau komisi, promo, dan hasil usaha dalam satu halaman.</p></div><button class="button secondary tiny" data-profit-refresh>Refresh statistik</button></div><div class="user-filters profit-filters"><label for="profit-period">Periode<select id="profit-period">${[['7','7 hari terakhir'],['30','30 hari terakhir'],['90','90 hari terakhir'],['ALL','Semua waktu']].map(([v,l])=>`<option value="${v}" ${period===v?'selected':''}>${l}</option>`).join('')}</select></label><label for="profit-mode">Data transaksi<select id="profit-mode">${Object.entries(profitModeNames).map(([v,l])=>`<option value="${v}" ${mode===v?'selected':''}>${l}</option>`).join('')}</select></label></div><div id="profit-results" aria-live="polite"><div class="card">Memuat statistik...</div></div>`;
}
let profitLoadSequence=0;
async function loadProfitStats(){
 if(state.user?.role!=='ADMIN'||state.page!=='admin-profits')return;
 const mode=$('#profit-mode')?.value,period=$('#profit-period')?.value,sequence=++profitLoadSequence;
 const el=$('#profit-results');if(!el)return;el.innerHTML='<div class="card">Memuat statistik...</div>';
 try{
  const d=await get('/api/admin/profits?'+new URLSearchParams({mode,period}));
  if(state.user?.role!=='ADMIN'||state.page!=='admin-profits'||sequence!==profitLoadSequence)return;
  el.innerHTML=profitStatsContent(d);
 }catch(e){if(state.page==='admin-profits'&&sequence===profitLoadSequence){el.innerHTML='<div class="card">Statistik belum dapat dimuat. Klik Refresh untuk mencoba lagi.</div>';toast(e.message,true);}}
}
function profitDate(value,full=false){return new Date(value+(value.length===7?'-01':'')+'T00:00:00+07:00').toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',...(value.length===7?{month:'short',year:'numeric'}:{day:'numeric',month:'short'}),...(full?{year:'numeric'}:{})});}
function profitStatsContent(d){
 const t=d.totals,testing=['SIMULATION','MIDTRANS_SANDBOX'].includes(d.mode);
 const cards=[['Komisi tercatat',money(t.commission),'Bagian platform dari transaksi selesai'],['Promo terpakai',money(t.promo),'Voucher yang dipakai pada transaksi selesai'],['Reward Penganjem',money(t.rewards),'Bonus pencapaian yang sudah diklaim'],['Transaksi selesai',t.transactions.toLocaleString('id-ID'),'Sesuai periode dan data yang dipilih']];
 return `<div class="profit-context"><span class="tag ${testing?'warning':'success'}">${esc(profitModeNames[d.mode])}</span><span>${esc(profitDate(d.start,true))} - ${esc(profitDate(d.end,true))} (WIB)</span></div><div class="note ${testing?'warning':''}">${testing?'Data uji coba, bukan uang sungguhan.':d.mode==='LEGACY'?'Catatan lama belum memiliki penanda mode pembayaran. Data ini disajikan terpisah.':'Hanya transaksi live yang sudah selesai.'}</div><div class="profit-cards"><div class="profit-stat profit-featured"><span>Estimasi keuntungan</span><strong class="${t.profit<0?'profit-loss':''}">${money(t.profit)}</strong><p>Komisi dikurangi promo dan reward Penganjem</p></div>${cards.map(([label,value,hint])=>`<div class="profit-stat"><span>${label}</span><strong>${value}</strong><p>${hint}</p></div>`).join('')}</div><div class="profit-layout"><div class="card profit-chart-card"><div class="card-head"><div><h3>Tren keuntungan</h3><p class="small muted">${d.granularity==='month'?'Rekap bulanan':'Rekap harian'} - arahkan ke batang untuk melihat detail.</p></div></div>${(t.transactions||t.rewards)?'<div class="profit-chart-desktop">'+profitChart(d.series)+'</div><div class="profit-chart-mobile">'+profitChart(d.series,400)+'</div>':'<div class="profit-empty"><span aria-hidden="true">'+ico('chart','lg')+'</span><h3>Belum ada transaksi selesai</h3><p>Coba periode atau data transaksi lain.</p></div>'}</div><div class="card profit-receipts"><h3>Penerimaan komisi</h3><div><span>${testing?'Diterima (uji coba)':'Sudah dicatat diterima'}</span><strong>${money(t.collected)}</strong></div><div><span>Belum diterima</span><strong>${money(t.outstanding)}</strong></div><div><span>Nilai transaksi</span><strong>${money(t.volume)}</strong></div><p class="small muted">Nilai transaksi adalah total tarif atau harga jual. Hanya komisi yang menjadi pendapatan platform.</p></div></div><div class="card profit-services"><h3>Rekap per layanan</h3><div class="profit-table-scroll"><table class="user-recap"><thead><tr><th scope="col">Layanan</th><th scope="col">Transaksi</th><th scope="col">Komisi</th><th scope="col">Promo</th><th scope="col">Reward</th><th scope="col">Estimasi keuntungan</th></tr></thead><tbody>${d.services.map(row=>`<tr><td><span class="profit-service-icon">${ico(icons[row.service]||'store','sm')}</span>${esc(labels[row.service]||'Jasa lainnya')}</td><td>${row.transactions}</td><td>${money(row.commission)}</td><td>${money(row.promo)}</td><td>${money(row.rewards)}</td><td class="${row.profit<0?'profit-negative':'profit-positive'}">${money(row.profit)}</td></tr>`).join('')}</tbody></table></div></div><p class="form-hint">Estimasi keuntungan belum mencakup biaya operasional, biaya gateway, dan pajak. Komisi diterima mengikuti pencatatan aplikasi, bukan saldo rekening bank. Rentang tanggal menggunakan WIB.</p>`;
}
function profitChart(series,width=840){
 const height=245,left=65,right=15,top=22,bottom=40;
 const min=Math.min(0,...series.map(r=>r.profit)),max=Math.max(1,...series.map(r=>r.profit));
 const y=n=>top+(max-n)/(max-min)*(height-top-bottom),baseline=y(0),step=(width-left-right)/series.length;
 const compact=n=>new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1}).format(n);
 const ticks=[max,(max+min)/2,min].map(value=>`<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" class="profit-grid-line"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end">${esc(compact(value))}</text>`).join('');
 const bars=series.map((row,i)=>{
  const x=left+i*step+step*.18,barY=Math.min(y(row.profit),baseline),barHeight=Math.max(Math.abs(y(row.profit)-baseline),(row.transactions||row.rewards)?2:0);
  const label=i===0||i===series.length-1||i%Math.max(1,Math.ceil(series.length/(width<=400?3:6)))===0;
  return `<rect class="profit-bar ${row.profit<0?'profit-bar-negative':''}" x="${x}" y="${barY}" width="${Math.max(1,step*.64)}" height="${barHeight}" rx="${Math.min(4,step*.2)}" tabindex="0" role="img" aria-label="${esc(profitDate(row.date)+': '+money(row.profit))}"><title>${esc(profitDate(row.date))}: ${money(row.profit)} | ${row.transactions} transaksi</title></rect>${label?`<text x="${left+i*step+step/2}" y="${height-14}" text-anchor="middle">${esc(profitDate(row.date))}</text>`:''}`;
 }).join('');
 return `<svg class="profit-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik estimasi keuntungan. Rincian per layanan tersedia di tabel di bawah.">${ticks}<line x1="${left}" x2="${width-right}" y1="${baseline}" y2="${baseline}" class="profit-zero-line"/>${bars}</svg>`;
}
document.addEventListener('change',e=>{
 if(['profit-period','profit-mode'].includes(e.target.id)&&state.user?.role==='ADMIN'){
  state.profitPeriod=$('#profit-period').value;state.profitMode=$('#profit-mode').value;loadProfitStats();
 }
});
document.addEventListener('click',e=>{if(e.target.closest('[data-profit-refresh]'))loadProfitStats();});

function sidebarMenuItem(page,label,icon){
 if(page!=='market')return `<button class="side-link ${state.page===page?'active':''}" data-nav="${page}">${ico(icon)} ${label}</button>`;
 const open=!!state.marketMenuOpen,active=['market','market-orders','market-history','chat'].includes(state.page);
 return `<div class="side-market-group"><button class="side-link side-market-parent ${active?'active':''}" data-market-menu aria-expanded="${open}" aria-controls="market-submenu">${ico(icon)} <span>Marketplace</span>${ico('chevron','sm side-market-arrow')}</button><div id="market-submenu" class="side-market-submenu ${open?'is-open':''}" aria-hidden="${!open}" ${open?'':'inert'}><div class="side-market-submenu-inner"><button class="side-link ${state.page==='market-orders'?'active':''}" data-nav="market-orders" ${state.page==='market-orders'?'aria-current="page"':''}>${ico('package','sm')} Pesananku</button><button class="side-link ${state.page==='market-history'?'active':''}" data-nav="market-history" ${state.page==='market-history'?'aria-current="page"':''}>${ico('history','sm')} Riwayat Pesanan</button><button class="side-link ${state.page==='chat'?'active':''}" data-nav="chat" ${state.page==='chat'?'aria-current="page"':''}>${ico('chat','sm')} Chat Nego</button></div></div></div>`;
}
function marketOrdersPage(history=false){
 return `<div class="dash-top"><div><span class="kicker">MARKETPLACE</span><h1>${history?'Riwayat Pesanan':'Pesananku'}</h1><p>${history?'Lihat kembali transaksi marketplace yang selesai atau dibatalkan.':'Pantau pesanan belanja dan penjualan yang masih aktif.'}</p></div><button class="button secondary tiny" data-market-order-refresh>Refresh</button></div><div class="market-order-toolbar card"><div class="market-order-tabs" role="group" aria-label="Jenis pesanan"><button class="button tiny ${(state.marketOrderView||'BUYER')==='BUYER'?'':'secondary'}" data-market-order-view="BUYER" aria-pressed="${(state.marketOrderView||'BUYER')==='BUYER'}">Pembelian</button><button class="button tiny ${state.marketOrderView==='SELLER'?'':'secondary'}" data-market-order-view="SELLER" aria-pressed="${state.marketOrderView==='SELLER'}">Penjualan</button></div>${history?`<div class="field"><label for="market-order-status">Status pesanan</label><select id="market-order-status">${[['ALL','Semua riwayat'],['SOLD','Selesai'],['CANCELLED','Dibatalkan']].map(([v,l])=>`<option value="${v}" ${(state.marketHistoryStatus||'ALL')===v?'selected':''}>${l}</option>`).join('')}</select></div>`:'<span class="tag warning">Pesanan aktif</span>'}</div><div class="note">${history?'Pesanan selesai dan dibatalkan tersimpan di sini.':'Bayar lewat website, lakukan serah terima, lalu pembeli konfirmasi barang diterima. Dana baru masuk saldo penjual setelah transaksi selesai. Saat ini masih simulasi.'}</div><div id="market-seller-wallet"></div><div id="market-order-results" aria-live="polite">Memuat pesanan...</div>`;
}
let marketOrderItems=[],marketOrderLoad=0;
async function loadMarketOrders({quiet=false}={}){
 if(!['CUSTOMER','DRIVER'].includes(state.user?.role)||!['market-orders','market-history'].includes(state.page))return;
 const page=state.page,userId=state.user.id,view=state.marketOrderView||'BUYER',sequence=++marketOrderLoad;if(!quiet)marketOrderItems=[];
 const el=$('#market-order-results');if(el&&!quiet)el.textContent='Memuat pesanan...';
 try{
  const [d,wallet]=await Promise.all([get('/api/market/orders/mine?view='+view),view==='SELLER'?get('/api/market/wallet'):Promise.resolve(null)]);
  if(state.user?.id!==userId||state.page!==page||sequence!==marketOrderLoad)return;
  marketOrderItems=d.orders;state.marketSellerWallet=wallet?{...wallet,owner_id:userId}:null;paintMarketOrders();const summary=$('#market-seller-wallet');if(summary)summary.innerHTML=wallet?marketSellerWallet(wallet):'';
 }catch(e){if(state.page===page&&sequence===marketOrderLoad){const target=$('#market-order-results');if(!quiet){if(target)target.textContent='Pesanan belum dapat dimuat. Klik Refresh untuk mencoba lagi.';toast(e.message,true);}}}
}
function paintMarketOrders(){
 const el=$('#market-order-results');if(!el||!['CUSTOMER','DRIVER'].includes(state.user?.role))return;
 const history=state.page==='market-history',status=history?(state.marketHistoryStatus||'ALL'):'RESERVED',selling=state.marketOrderView==='SELLER',rows=visibleMarketOrders(marketOrderItems,state.user.id,selling,history,status);
 el.innerHTML=rows.length?rows.map(o=>marketOrderCard(o,selling)).join(''):`<div class="card market-orders-empty">${ico('shopping','lg')}<h3>${history?(status==='ALL'?'Belum ada riwayat marketplace':'Tidak ada pesanan dengan status ini'):'Belum ada pesanan aktif'}</h3><p>${history?'Pesanan yang selesai atau dibatalkan akan muncul di sini.':selling?'Barang yang dipesan pembeli akan muncul di sini.':'Pesan barang dari marketplace untuk melihat pesananmu di sini.'}</p><button class="button secondary tiny" data-nav="market">Buka Marketplace</button></div>`;
}
document.addEventListener('change',e=>{if(e.target.id==='market-order-status'){state.marketHistoryStatus=e.target.value;paintMarketOrders();}});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-market-order-view],[data-market-order-refresh],[data-market-order-chat],[data-market-order-complete],[data-market-order-cancel]');if(!b)return;
 try{
  if(b.dataset.marketOrderView){state.marketOrderView=b.dataset.marketOrderView;render();await loadMarketOrders();return;}
  if(b.hasAttribute('data-market-order-refresh')){await loadMarketOrders();return;}
  if(b.dataset.marketOrderChat){state.activeChat=b.dataset.marketOrderChat;go('chat');await loadConversations();await loadMessages(state.activeChat);return;}
  const id=b.dataset.marketOrderComplete||b.dataset.marketOrderCancel,order=marketOrderItems.find(o=>o.id===id);if(!order)return;
  const complete=!!b.dataset.marketOrderComplete;
  if(!await confirmAction({title:complete?'Selesaikan transaksi?':'Batalkan pesanan?',message:complete?'Pastikan pembayaran COD sudah benar-benar diterima.':order.payment?.status==='HELD'?'Dana simulasi akan dikembalikan kepada pembeli.':'Pesanan marketplace ini akan dibatalkan.',confirmLabel:complete?'Selesaikan transaksi':'Batalkan pesanan',cancelLabel:'Kembali',danger:!complete}))return;
  b.disabled=true;await post('/api/listings/'+order.listing_id+(complete?'/complete':'/cancel'),{order_id:order.id});
  toast(complete?'Transaksi selesai. Lihat di Riwayat Pesanan.':'Pesanan dibatalkan. Lihat di Riwayat Pesanan.');await loadMarketOrders();
 }catch(error){toast(error.message,true);b.disabled=false;}
});

function visibleMarketOrders(orders,userId,selling,history,status){
 return orders.filter(order=>(selling?order.seller_id:order.buyer_id)===userId
  &&(history?['SOLD','CANCELLED'].includes(order.status):order.status==='RESERVED')
  &&(!history||status==='ALL'||order.status===status));
}

function animateMarketplaceClose(previous){
 if(!previous||previous.height<=0||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const submenu=$('#market-submenu');if(!submenu?.animate)return;
 // Rendering replaces the sidebar, so carry its visible height into the closing animation.
 const timing={duration:500,easing:'cubic-bezier(.22,1,.36,1)'};
 submenu.animate([
  {height:previous.height+'px',gridTemplateRows:'minmax(0,1fr)',opacity:previous.opacity,marginBottom:previous.margin},
  {height:'0px',gridTemplateRows:'minmax(0,1fr)',opacity:0,marginBottom:'0px'}
 ],timing);
 for(const link of submenu.querySelectorAll('.side-link'))link.animate([{transform:'translateY(0)'},{transform:'translateY(-7px)'}],timing);
 $('.side-market-arrow')?.animate([{transform:previous.arrow},{transform:'rotate(0deg)'}],timing);
}

function marketSellerWallet(wallet){
 const enabled=wallet.withdrawalSimulationEnabled&&wallet.available>0;
 return `<div class="market-wallet-summary"><div class="card"><span class="small muted">Dana penjualan ditahan</span><h2>${money(wallet.held)}</h2><p class="small muted">Menunggu konfirmasi pembeli</p></div><div class="card"><span class="small muted">Saldo penjualan tersedia</span><h2>${money(wallet.available)}</h2><p class="small muted">Sudah dikurangi komisi platform</p><button class="button tiny market-withdraw-button" data-market-withdraw ${enabled?'':'disabled'}>Tarik Saldo</button></div></div><p class="form-hint">${esc(paymentEnvironment(wallet.mode))} Penarikan hanya simulasi; tidak ada transfer ke bank atau e-wallet.</p>${wallet.withdrawals?.length?`<details class="card withdrawal-history"><summary>Riwayat penarikan <span class="small muted">Total ${money(wallet.withdrawn)}</span></summary>${wallet.withdrawals.map(w=>`<div class="list-row"><div><strong>${money(w.amount)}</strong><p>${esc(withdrawalProviderName(wallet,w.channel,w.provider))} ${esc(w.masked_number)} - ${esc(w.account_name)}</p><p class="small muted">${esc(new Date(w.created_at.replace(' ','T')+'Z').toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}))} WIB</p></div><span class="tag success">Selesai (simulasi)</span></div>`).join('')}</details>`:''}`;
}
function marketPaymentLabel(payment){return {PENDING:'Belum dibayar',HELD:'Lunas - dana ditahan',RELEASED:'Lunas - saldo masuk',EXPIRED:'Pembayaran kedaluwarsa',CANCELLED:'Pembayaran dibatalkan',REFUNDED:'Dana dikembalikan (simulasi)'}[payment?.status]||'Belum dibayar';}
function marketOrderCard(order,selling){
 const p=order.payment,held=p?.status==='HELD',released=p?.status==='RELEASED';
 const title=order.status==='SOLD'?'Transaksi Selesai':order.status==='CANCELLED'?'Dibatalkan':!order.payment_required?'COD lama':held?(order.handover_at?'Menunggu konfirmasi pembeli':'Siap serah terima'):'Menunggu pembayaran';
 const phase=released?4:held?(order.handover_at?3:2):1;
 const steps=order.payment_required&&order.status!=='CANCELLED'?`<ol class="market-checkout-steps" aria-label="Tahapan pesanan">${['Checkout','Pembayaran','Serah terima','Selesai'].map((label,i)=>`<li class="${i<phase?'done':''} ${i===phase?'current':''}"><span aria-hidden="true">${i<phase?'&#10003;':i+1}</span>${label}</li>`).join('')}</ol>`:'';
 let actions=order.conversation_id?`<button class="button secondary tiny" data-market-order-chat="${esc(order.conversation_id)}">${ico('chat','sm')} Chat ${selling?'Pembeli':'Penjual'}</button>`:'';
 if(order.payment_required||!selling&&order.status==='RESERVED')actions+=`<button class="button tiny payment-detail payment-${held||released?'paid':'unpaid'}" data-market-pay="${esc(order.id)}">${!selling&&order.status==='RESERVED'&&!held?(p?.status==='EXPIRED'?'Bayar ulang':'Bayar sekarang'):'Detail pembayaran'}</button>`;
 if(selling&&released){
  const balance=state.marketSellerWallet,enabled=balance?.owner_id===state.user?.id&&balance.withdrawalSimulationEnabled&&balance.available>0;
  actions+=`<button class="button tiny market-order-withdraw" data-market-withdraw data-withdraw-amount="${p.amount-p.platform_fee}" ${enabled?'':'disabled'}>Tarik Saldo</button>`;
 }
 if(order.status==='RESERVED'){
  if(order.payment_required){
   if(selling&&held&&!order.handover_at)actions+=`<button class="button tiny" data-market-handover="${esc(order.id)}">Barang diserahkan</button>`;
   if(!selling&&held&&order.handover_at)actions+=`<button class="button tiny" data-market-confirm="${esc(order.id)}">Barang sudah diterima</button>`;
  }else if(selling)actions+=`<button class="button tiny" data-market-order-complete="${esc(order.id)}">Selesaikan COD lama</button>`;
  if(!order.handover_at)actions+=`<button class="button outline tiny" data-market-order-cancel="${esc(order.id)}">Batalkan</button>`;
 }
 return `<article class="card market-order-card"><img class="market-order-photo" src="${imageUrl(order.image_path)}" alt="${esc(order.title)}" loading="lazy"/><div class="market-order-copy"><span class="tag ${order.status==='SOLD'?'success':order.status==='CANCELLED'?'danger':'warning'}">${esc(title)}</span><h3>${esc(order.title)}</h3><p class="small muted">${esc(order.category)}</p>${identityChip(selling?order.buyer_profile:order.seller_profile)}<strong class="market-order-price">${money(order.amount)}</strong>${order.payment_required?`<p class="market-fund-status ${held||released?'profit-positive':'profit-negative'}">${esc(marketPaymentLabel(p))}</p>`:'<p class="small muted">Pesanan lama: pembayaran COD, atau pilih bayar lewat website.</p>'}${selling&&p?`<p class="small muted">Komisi ${money(p.platform_fee)} | Bagian penjual ${money(p.amount-p.platform_fee)}</p>`:''}${order.status==='SOLD'?'<p class="small muted">Terima kasih sudah bertransaksi di ANJEMIN!</p>':''}</div>${actions?`<div class="market-order-actions" role="group" aria-label="Aksi pesanan ${esc(order.title)}">${actions}</div>`:''}${steps}</article>`;
}
async function renderMarketPaymentModal(id){
 const root=$('#modal-root');root.innerHTML=modalWrap('Pembayaran Marketplace','<p>Memuat pembayaran...</p>');
 try{
  const {payment:p}=await get('/api/market/orders/'+id+'/payment');if(state.modal?.which!=='market-payment'||state.modal.id!==id)return;
  if(!p)throw Error('Pembayaran belum tersedia. Klik Bayar sekarang pada pesanan.');
  const order=marketOrderItems.find(o=>o.id===id),buyer=order?.buyer_id===state.user?.id,paid=['HELD','RELEASED'].includes(p.status);
  let content=`<div class="note warning">${esc(paymentEnvironment(p.mode))}</div><div class="market-invoice"><span class="small muted">Total pembayaran</span><h2>${money(p.amount)}</h2><span class="payment-status payment-${paid?'paid':'unpaid'}">${esc(marketPaymentLabel(p))}</span></div><p class="small">Dana ditahan sampai barang diserahkan dan pembeli mengonfirmasi selesai.</p>`;
  if(!buyer)content+=`<div class="note">Komisi platform ${money(p.platform_fee)}. Bagian penjual ${money(p.amount-p.platform_fee)}.</div>`;
  if(p.status==='PENDING'){content+=`<p class="small muted">Batas bayar: ${esc(new Date(p.expires_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}))} WIB</p>`;if(buyer)content+=`<button class="button full" data-market-simulate="${esc(id)}">Simulasikan pembayaran berhasil</button>`;}
  if(p.status==='HELD')content+='<div class="note">Pembayaran diterima. Lakukan serah terima barang; penjual belum dapat mencairkan dana.</div>';
  if(p.status==='RELEASED')content+='<div class="note">Pembeli sudah menyelesaikan transaksi. Pendapatan masuk ke saldo internal penjual.</div>';
  if(p.status==='REFUNDED')content+='<div class="note">Pesanan dibatalkan. Pengembalian dana simulasi sudah dicatat, tanpa uang sungguhan.</div>';
  if(p.status==='EXPIRED'&&buyer)content+=`<button class="button full" data-market-renew="${esc(id)}">Buat pembayaran ulang</button>`;
  content+=`<div class="form-actions"><button class="button secondary tiny" data-market-payment-refresh="${esc(id)}">Refresh pembayaran</button></div>`;
  root.innerHTML=modalWrap('Pembayaran Marketplace',content);
 }catch(error){if(state.modal?.which==='market-payment'&&state.modal.id===id)root.innerHTML=modalWrap('Pembayaran Marketplace',`<p role="alert">${esc(error.message)}</p>`);}
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-market-pay],[data-market-simulate],[data-market-handover],[data-market-confirm],[data-market-payment-refresh],[data-market-renew]');if(!b||b.disabled)return;
 try{
  const d=b.dataset;
  if(d.marketPay){
   const order=marketOrderItems.find(o=>o.id===d.marketPay);if(!order)return;
   b.disabled=true;
   if(order.buyer_id===state.user?.id&&order.status==='RESERVED'){await post('/api/market/orders/'+order.id+'/payment');await loadMarketOrders({quiet:true});}
   openModal('market-payment',{id:order.id});return;
  }
  if(d.marketPaymentRefresh){await renderMarketPaymentModal(d.marketPaymentRefresh);await loadMarketOrders({quiet:true});return;}
  if(d.marketRenew){b.disabled=true;await post('/api/market/orders/'+d.marketRenew+'/payment');await renderMarketPaymentModal(d.marketRenew);await loadMarketOrders({quiet:true});return;}
  if(d.marketSimulate){b.disabled=true;const r=await post('/api/market/orders/'+d.marketSimulate+'/payment/simulate');toast(r.message);await loadMarketOrders({quiet:true});if(state.modal?.id===d.marketSimulate)await renderMarketPaymentModal(d.marketSimulate);return;}
  const id=d.marketHandover||d.marketConfirm;
  if(!await confirmAction({title:d.marketHandover?'Konfirmasi serah terima?':'Barang sudah diterima?',message:d.marketHandover?'Pastikan barang sudah benar-benar diserahkan kepada pembeli.':'Pastikan barang diterima dan sesuai. Dana simulasi akan dilepas ke saldo penjual.',confirmLabel:'Ya, konfirmasi',cancelLabel:'Kembali'}))return;
  b.disabled=true;const r=await post('/api/market/orders/'+id+(d.marketHandover?'/handover':'/confirm'));toast(r.message);await loadMarketOrders({quiet:true});
 }catch(error){toast(error.message,true);b.disabled=false;}
});

function withdrawalProviderName(wallet,channel,provider){return wallet.withdrawalProviders?.[channel]?.find(([code])=>code===provider)?.[1]||provider;}
function withdrawalNumber(number,channel){
 let value=String(number||'').replace(/[\s-]/g,'');
 if(channel==='EWALLET'){value=value.replace(/^\+/,'');if(value.startsWith('0'))value='62'+value.slice(1);}
 return value;
}
async function renderMarketWithdrawal(m){
 const root=$('#modal-root');
 if(!m.wallet){
  root.innerHTML=modalWrap('Tarik Saldo','<p>Memuat saldo dan pilihan tujuan...</p>');
  try{
   const wallet=await get(m.driver?'/api/driver/wallet':'/api/market/wallet');if(state.modal!==m)return;
   m.wallet=wallet;m.requestKey=window.crypto.randomUUID?window.crypto.randomUUID():Array.from(window.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
   m.draft={amount:Math.min(m.amountHint||wallet.available,wallet.available),channel:'BANK',provider:'',account_name:state.user.full_name,account_number:'',confirm_number:''};
  }catch(error){if(state.modal===m)root.innerHTML=modalWrap('Tarik Saldo',`<p role="alert">${esc(error.message)}</p>`);return;}
 }
 if(state.modal!==m)return;
 const wallet=m.wallet,d=m.draft;
 if(m.stage==='success'){
  const w=m.result.withdrawal;
  root.innerHTML=modalWrap('Penarikan simulasi tercatat',`<div class="withdraw-success"><span aria-hidden="true">&#10003;</span><h2>${money(w.amount)}</h2><p>${esc(withdrawalProviderName(wallet,w.channel,w.provider))} ${esc(w.masked_number)}<br/>${esc(w.account_name)}</p><p class="small muted">Saldo tersedia: ${money(m.result.available)}</p></div><div class="note warning">Tidak ada uang sungguhan yang ditransfer. Penarikan ini hanya pencatatan simulasi.</div><button class="button full" data-withdraw-close>Selesai</button>`);return;
 }
 const error=m.error?`<p class="note warning" role="alert">${esc(m.error)}</p>`:'';
 if(m.stage==='confirm'){
  root.innerHTML=modalWrap('Konfirmasi penarikan',`${error}<p class="small muted">Periksa kembali nominal dan tujuan penarikanmu.</p><dl class="withdraw-review"><div><dt>Nominal penarikan</dt><dd>${money(d.amount)}</dd></div><div><dt>Bank / e-wallet</dt><dd>${esc(withdrawalProviderName(wallet,d.channel,d.provider))}</dd></div><div><dt>Nama pemilik</dt><dd>${esc(d.account_name)}</dd></div><div><dt>${d.channel==='BANK'?'Nomor rekening':'Nomor HP e-wallet'}</dt><dd class="withdraw-number">${esc(d.account_number)}</dd></div><div><dt>Sisa saldo</dt><dd>${money(wallet.available-Number(d.amount))}</dd></div></dl><div class="note warning">Simulasi tanpa transfer uang sungguhan. Nama pemilik belum diverifikasi oleh bank atau e-wallet.</div><form id="market-withdraw-confirm-form"><label class="withdraw-confirm-check"><input type="checkbox" name="confirmed" required/> Nomor tujuan, nama pemilik, dan nominal sudah benar.</label><div class="form-actions"><button class="button secondary" type="button" data-withdraw-back>Perbaiki data</button><button class="button" type="submit">Cairkan (Simulasi)</button></div></form>`);return;
 }
 root.innerHTML=modalWrap('Tarik Saldo',`<div class="note warning">Penarikan simulasi, tanpa transfer uang sungguhan.</div><p>Saldo tersedia <strong>${money(wallet.available)}</strong></p>${error}<form id="market-withdraw-form"><div class="field"><label for="withdraw-amount">Nominal (Rp)</label><input id="withdraw-amount" name="amount" type="number" inputmode="numeric" min="1" max="${wallet.available}" step="1" value="${esc(d.amount)}" required/></div><div class="form-row"><div class="field"><label for="withdraw-channel">Jenis tujuan</label><select id="withdraw-channel" name="channel"><option value="BANK" ${d.channel==='BANK'?'selected':''}>Rekening bank</option><option value="EWALLET" ${d.channel==='EWALLET'?'selected':''}>E-wallet</option></select></div><div class="field"><label for="withdraw-provider">Bank / e-wallet</label><select id="withdraw-provider" name="provider" required><option value="">Pilih tujuan</option>${(wallet.withdrawalProviders[d.channel]||[]).map(([code,label])=>`<option value="${esc(code)}" ${d.provider===code?'selected':''}>${esc(label)}</option>`).join('')}</select></div></div><div class="field"><label for="withdraw-name">Nama pemilik rekening / e-wallet</label><input id="withdraw-name" name="account_name" minlength="2" maxlength="100" value="${esc(d.account_name)}" autocomplete="name" required/></div><div class="field"><label id="withdraw-number-label" for="withdraw-number">${d.channel==='BANK'?'Nomor rekening':'Nomor HP e-wallet'}</label><input id="withdraw-number" name="account_number" type="text" inputmode="numeric" maxlength="30" value="${esc(d.account_number)}" autocomplete="off" required/><p id="withdraw-number-help" class="form-hint">${d.channel==='BANK'?'Gunakan nomor rekening, bukan nomor kartu ATM.':'Gunakan nomor HP yang terdaftar pada e-wallet tujuan.'}</p></div><div class="field"><label id="withdraw-repeat-label" for="withdraw-repeat">Ulangi ${d.channel==='BANK'?'nomor rekening':'nomor HP e-wallet'}</label><input id="withdraw-repeat" name="confirm_number" type="text" inputmode="numeric" maxlength="30" value="${esc(d.confirm_number)}" autocomplete="off" required/></div><button class="button full" type="submit" ${wallet.withdrawalSimulationEnabled&&wallet.available>0?'':'disabled'}>Lanjut konfirmasi</button></form>`);
}
document.addEventListener('change',e=>{
 if(e.target.id!=='withdraw-channel'||state.modal?.which!=='market-withdrawal')return;
 const channel=e.target.value,wallet=state.modal.wallet;
 $('#withdraw-provider').innerHTML='<option value="">Pilih tujuan</option>'+wallet.withdrawalProviders[channel].map(([code,label])=>`<option value="${esc(code)}">${esc(label)}</option>`).join('');
 $('#withdraw-number-label').textContent=channel==='BANK'?'Nomor rekening':'Nomor HP e-wallet';
 $('#withdraw-repeat-label').textContent=channel==='BANK'?'Ulangi nomor rekening':'Ulangi nomor HP e-wallet';
 $('#withdraw-number-help').textContent=channel==='BANK'?'Gunakan nomor rekening, bukan nomor kartu ATM.':'Gunakan nomor HP yang terdaftar pada e-wallet tujuan.';
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-market-withdraw],[data-withdraw-back],[data-withdraw-close]');if(!b||b.disabled)return;
 if(b.hasAttribute('data-market-withdraw')){openModal('market-withdrawal',{stage:'form',amountHint:Number(b.dataset.withdrawAmount)||0});return;}
 if(b.hasAttribute('data-withdraw-close')){closeModal();return;}
 const m=state.modal;if(m?.which==='market-withdrawal'&&!m.submitting){m.stage='form';m.error='';renderMarketWithdrawal(m);}
});
document.addEventListener('submit',async e=>{
 if(!['market-withdraw-form','market-withdraw-confirm-form'].includes(e.target.id))return;e.preventDefault();
 const m=state.modal;if(m?.which!=='market-withdrawal'||m.submitting)return;
 if(e.target.id==='market-withdraw-form'){
  const d=Object.fromEntries(new FormData(e.target));m.draft=d;
  const number=withdrawalNumber(d.account_number,d.channel),repeat=withdrawalNumber(d.confirm_number,d.channel);
  const valid=d.channel==='BANK'?/^\d{6,20}$/.test(number):/^62\d{9,13}$/.test(number);
  m.error=!Number.isInteger(Number(d.amount))||Number(d.amount)<1||Number(d.amount)>m.wallet.available?'Nominal harus sesuai saldo tersedia.':!valid?'Nomor tujuan belum valid. Periksa kembali.':number!==repeat?'Konfirmasi nomor tujuan tidak sama.':!m.wallet.withdrawalProviders[d.channel]?.some(([code])=>code===d.provider)?'Pilih bank atau e-wallet tujuan.':'';
  if(!m.error)m.stage='confirm';renderMarketWithdrawal(m);return;
 }
 if(!new FormData(e.target).has('confirmed'))return;
 m.submitting=true;const button=e.target.querySelector('[type="submit"]');button.disabled=true;button.textContent='Memproses simulasi...';
 try{
  const result=await post(m.driver?'/api/driver/withdrawals':'/api/market/withdrawals',{...m.draft,amount:Number(m.draft.amount),confirmed:true,request_key:m.requestKey});
  m.result=result;m.stage='success';m.draft=null;m.submitting=false;
  if(state.modal===m)renderMarketWithdrawal(m);else toast(result.message);
  if(m.driver){refreshHeaderWallet(true);if(state.page==='wallet')await loadWallet();}
  else if(['market-orders','market-history'].includes(state.page))await loadMarketOrders({quiet:true});
 }catch(error){m.submitting=false;if(state.modal===m){m.error=error.message;renderMarketWithdrawal(m);}else toast(error.message,true);}
});

function accountRole(role){return role==='DRIVER'?'Penganjem':role==='CUSTOMER'?'Customer Anjem':'Pengelola';}
function profileNeeded(){return ['CUSTOMER','DRIVER'].includes(state.user?.role)&&state.user.profile_complete===false;}
function profileAvatar(user,extra=''){
 const initial=Array.from(String(user?.full_name||user?.username||'A').trim())[0]||'A';
 return `<span class="account-avatar ${extra}" aria-hidden="true"><span>${esc(initial)}</span>${user?.profile_photo_path?`<img src="${imageUrl(user.profile_photo_path)}" alt="" loading="lazy"/>`:''}</span>`;
}
function identityChip(profile){
 if(!profile)return '';
 return `<button type="button" class="identity-chip" data-user-profile="${esc(profile.id)}" aria-label="Lihat profil ${esc(profile.full_name)}">${profileAvatar(profile)}<span><strong>${esc(profile.full_name)}</strong><small>@${esc(profile.username)}</small></span></button>`;
}
function releaseProfileDraft(){
 if(state.profileDraft?.preview)URL.revokeObjectURL(state.profileDraft.preview);
 state.profileDraft=null;state.profileVerifiedPhone=null;
}
function profileDraft(){
 if(state.profileDraft?.owner===state.user.id)return state.profileDraft;
 releaseProfileDraft();const u=state.user;
 return state.profileDraft={owner:u.id,full_name:u.full_name,username:u.username,email:u.email,phone:u.phone,photo:null,preview:null};
}
function normalizedProfilePhone(value){
 const clean=String(value||'').replace(/[\s.()-]/g,'');return clean.startsWith('0')?'62'+clean.slice(1):clean.startsWith('+')?clean.slice(1):clean;
}
function accountProfilePage(){
 const u=state.user,d=profileDraft(),required=profileNeeded(),avatar=d.preview?`<span class="account-avatar profile-avatar-large"><img src="${esc(d.preview)}" alt="Pratinjau foto profil"/></span>`:profileAvatar(u,'profile-avatar-large');
 return `<div class="dash-top"><div><span class="kicker">AKUN SAYA</span><h1>${required?'Lengkapi Profil':'Profil Saya'}</h1><p>${required?'Satu langkah lagi sebelum mulai menggunakan ANJEMIN.':'Atur identitas dan kontak akunmu di sini.'}</p></div><span class="tag ${required?'warning':'success'}">${required?'Perlu dilengkapi':'Profil siap'}</span></div>${required?'<div class="note profile-welcome">Lengkapi nama, username, kontak, dan foto profil agar kamu mudah dikenali saat bertransaksi.</div>':''}<div class="profile-layout"><aside class="card profile-preview-card"><div id="profile-photo-preview">${avatar}</div><h2 id="profile-preview-name">${esc(d.full_name)}</h2><p id="profile-preview-username">@${esc(d.username)}</p><span class="tag">${accountRole(u.role)}</span>${u.role==='DRIVER'?`<p class="form-hint">${u.driver_status==='APPROVED'?'Penganjem terverifikasi':'Verifikasi dokumen oleh Pengelola: '+esc(u.driver_status)}</p>`:''}<div class="profile-visibility">Nama, username, dan foto tampil sebagai identitasmu saat bertransaksi.</div></aside><section class="card profile-form-card"><h2>Data profil</h2><p class="small muted">Gunakan data yang benar dan kontak yang aktif.</p><form id="account-profile-form"><div class="field profile-photo-field"><label for="profile-photo">Foto profil${required&&!u.profile_photo_path?' *':''}</label><input id="profile-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="profile-photo-hint"/><p id="profile-photo-hint" class="form-hint">${d.photo?'Foto dipilih: '+esc(d.photo.name)+'. ':''}JPG, PNG, atau WebP. Maksimal 4 MB.</p></div><div class="form-row"><div class="field"><label for="profile-full-name">Nama lengkap *</label><input id="profile-full-name" name="full_name" value="${esc(d.full_name)}" minlength="3" maxlength="80" autocomplete="name" required/></div><div class="field"><label for="profile-username">Username *</label><input id="profile-username" name="username" value="${esc(d.username)}" pattern="[a-z0-9_]{3,24}" minlength="3" maxlength="24" autocomplete="username" required/><p class="form-hint">Huruf kecil, angka, dan underscore. Dipakai untuk masuk akun.</p></div></div><div class="form-row"><div class="field"><label for="profile-phone">Nomor telepon aktif *</label><input id="profile-phone" name="phone" type="tel" value="${esc(d.phone)}" autocomplete="tel" required/><p class="form-hint">Jika mengganti nomor, verifikasi nomor baru dengan OTP.</p></div><div class="field"><label for="profile-email">Email aktif *</label><input id="profile-email" name="email" type="email" value="${esc(d.email)}" maxlength="120" autocomplete="email" required/></div></div><div id="profile-phone-verification" class="profile-phone-verification" hidden><p class="small"><strong>Verifikasi nomor baru</strong></p><div class="form-actions"><button class="button secondary tiny" type="button" data-profile-otp="request">Kirim OTP</button><input id="profile-phone-otp" type="text" inputmode="numeric" maxlength="6" aria-label="Kode OTP nomor baru" placeholder="6 digit OTP"/><button class="button secondary tiny" type="button" data-profile-otp="verify">Verifikasi</button></div><p id="profile-phone-status" class="form-hint" role="status"></p></div><p class="form-hint profile-contact-note">Nomor telepon dan email hanya ditampilkan kepada pemilik akun dan Pengelola.</p><div class="profile-save-actions"><button class="button" type="submit">${required?'Simpan dan mulai':'Simpan perubahan'}</button><button class="button secondary" type="button" data-profile-reset>Batalkan perubahan</button></div></form></section></div>`;
}
function refreshProfilePhoneStatus(){
 const panel=$('#profile-phone-verification');if(!panel||!state.user)return;
 const phone=normalizedProfilePhone($('#profile-phone').value),changed=phone!==state.user.phone;
 panel.hidden=!changed;
 if(state.profileVerifiedPhone&&state.profileVerifiedPhone!==phone)state.profileVerifiedPhone=null;
 $('#profile-phone-status').textContent=state.profileVerifiedPhone===phone?'Nomor baru telah terverifikasi.':'';
}
async function renderPublicProfile(m){
 const root=$('#modal-root');root.innerHTML=modalWrap('Profil pengguna','<p class="muted">Memuat profil...</p>');
 try{
  const d=await get('/api/users/'+encodeURIComponent(m.id)+'/profile');if(state.modal!==m)return;
  const p=d.profile;root.innerHTML=modalWrap('Profil pengguna',`<div class="public-profile">${profileAvatar(p,'profile-avatar-large')}<h2>${esc(p.full_name)}</h2><p>@${esc(p.username)}</p><span class="tag">${accountRole(p.role)}</span>${p.role==='DRIVER'&&p.driver_status==='APPROVED'?'<p class="profile-verified">Penganjem terverifikasi</p>':''}</div>`);
 }catch(e){if(state.modal===m)root.innerHTML=modalWrap('Profil pengguna',`<p class="muted">${esc(e.message)}</p>`);}
}
document.addEventListener('error',e=>{if(e.target.matches?.('.account-avatar img'))e.target.remove();},true);
document.addEventListener('input',e=>{
 if(!e.target.closest('#account-profile-form')||e.target.type==='file')return;
 const d=profileDraft();if(['full_name','username','email','phone'].includes(e.target.name))d[e.target.name]=e.target.value;
 if(e.target.name==='full_name')$('#profile-preview-name').textContent=e.target.value;
 if(e.target.name==='username')$('#profile-preview-username').textContent='@'+e.target.value;
 if(e.target.name==='phone')refreshProfilePhoneStatus();
});
document.addEventListener('change',e=>{
 if(e.target.id!=='profile-photo')return;
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>4*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Pilih foto JPG, PNG, atau WebP maksimal 4 MB.');
  const d=profileDraft();if(d.preview)URL.revokeObjectURL(d.preview);d.photo=file;d.preview=URL.createObjectURL(file);
  $('#profile-photo-preview').innerHTML=`<span class="account-avatar profile-avatar-large"><img src="${esc(d.preview)}" alt="Pratinjau foto profil"/></span>`;
  $('#profile-photo-hint').textContent='Foto dipilih: '+file.name+'. Foto akan tersimpan setelah menekan Simpan.';
 }catch(err){e.target.value='';toast(err.message,true);}
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-profile-reset],[data-profile-otp],[data-user-profile]');if(!b)return;
 if(b.dataset.userProfile){openModal('user-profile',{id:b.dataset.userProfile});return;}
 if(b.hasAttribute('data-profile-reset')){if(!await confirmAction({title:'Batalkan perubahan profil?',message:'Perubahan yang belum disimpan akan dikembalikan ke data profil terakhir.',confirmLabel:'Buang perubahan',cancelLabel:'Lanjut mengedit',danger:true}))return;releaseProfileDraft();render();return;}
 if(b.dataset.profileOtp){
  b.disabled=true;
  try{
   const phone=$('#profile-phone').value;
   if(b.dataset.profileOtp==='request'){
    const d=await post('/api/auth/otp/request',{phone});$('#profile-phone-status').textContent=d.development?'Kode OTP tersedia di terminal server.':'Kode OTP sedang dikirim melalui SMS.';
   }else{
    const code=$('#profile-phone-otp').value;if(!code)throw Error('Masukkan kode OTP terlebih dahulu.');
    await post('/api/auth/otp/verify',{phone,code});
    if(normalizedProfilePhone($('#profile-phone').value)!==normalizedProfilePhone(phone))throw Error('Nomor berubah. Verifikasi kembali nomor yang digunakan.');
    state.profileVerifiedPhone=normalizedProfilePhone(phone);refreshProfilePhoneStatus();
   }
  }catch(err){toast(err.message,true);}finally{b.disabled=false;}
 }
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='account-profile-form')return;e.preventDefault();
 if(state.profileSaving)return;
 const form=e.target,owner=state.user.id,wasRequired=profileNeeded(),d=profileDraft(),button=form.querySelector('[type="submit"]');
 state.profileSaving=true;button.disabled=true;button.textContent='Menyimpan...';
 try{
  const body=pickFormValues(form);delete body.photo;
  if(profileNeeded()&&!state.user.profile_photo_path&&!d.photo)throw Error('Pilih foto profil terlebih dahulu.');
  if(d.photo)body.photo=await file64(d.photo);
  if(state.user?.id!==owner||state.page!=='profile')return;
  const result=await post('/api/account/profile',body);if(state.user?.id!==owner)return;
  state.user=result.user;releaseProfileDraft();toast(result.message);
  if(wasRequired)go(dashboardRoute());else render();
 }catch(err){toast(err.message,true);button.disabled=false;button.textContent=wasRequired?'Simpan dan mulai':'Simpan perubahan';}
 finally{state.profileSaving=false;}
});

function orderReceiptState(message){return message.read_at?'read':message.delivered_at?'delivered':'sent';}
function orderReceiptHtml(message){
 const status=orderReceiptState(message),label=status==='read'?'Sudah dibaca':status==='delivered'?'Diterima':'Terkirim';
 const paths=status==='sent'?'<path d="m5 10 4 4L21 3"/>':'<path d="m1 10 5 5L18 3"/><path d="m11 14 2 2L25 3"/>';
 return `<span class="order-chat-receipt is-${status}" data-receipt="${status}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 28 20" aria-hidden="true">${paths}</svg></span>`;
}
function applyOrderChatReceipts(receipts){
 for(const receipt of receipts||[]){
  const element=document.querySelector(`#order-chat-messages .is-mine[data-order-message="${receipt.id}"] .order-chat-receipt`);
  if(element&&element.dataset.receipt!==orderReceiptState(receipt))element.outerHTML=orderReceiptHtml(receipt);
 }
}
function cleanupOrderChatReceipts(m=state.modal){
 if(!m)return;clearTimeout(m.readReceiptTimer);m.receiptObserver?.disconnect();
}
function visibleOrderReadIds(m){
 if(state.modal!==m||m?.which!=='order-chat'||document.hidden||!document.hasFocus()||state.user?.id!==m.receiptOwner)return [];
 const root=$('#order-chat-messages');if(!root)return [];
 const viewport=root.getBoundingClientRect(),dialog=root.closest('.modal').getBoundingClientRect();
 return [...m.visibleIncomingIds].filter(id=>{
  if(m.readKnown.has(id)||m.readPending.has(id))return false;
  const bubble=root.querySelector(`[data-order-message="${id}"]`);if(!bubble)return false;
  const r=bubble.getBoundingClientRect(),top=Math.max(r.top,viewport.top,dialog.top,0),bottom=Math.min(r.bottom,viewport.bottom,dialog.bottom,innerHeight);
  return bottom-top>=Math.min(32,r.height*.5)&&Math.min(r.right,viewport.right,innerWidth)>Math.max(r.left,viewport.left,0);
 }).slice(0,200);
}
function queueOrderReadReceipts(m=state.modal){
 if(m?.which!=='order-chat'||!m.visibleIncomingIds)return;
 clearTimeout(m.readReceiptTimer);if(!visibleOrderReadIds(m).length)return;
 m.readReceiptTimer=setTimeout(async()=>{
  const ids=visibleOrderReadIds(m);if(!ids.length)return;
  ids.forEach(id=>m.readPending.add(id));
  try{
   await post(`/api/orders/${m.id}/messages/read`,{message_ids:ids});
   ids.forEach(id=>m.readKnown.add(id));
  }catch{}finally{ids.forEach(id=>m.readPending.delete(id));}
 },350);
}
function observeOrderChatMessages(messages,m){
 for(const message of messages){
  if(message.sender_id===state.user.id)continue;
  if(message.read_at){m.readKnown.add(message.id);continue;}
  const element=document.querySelector(`#order-chat-messages [data-order-message="${message.id}"]`);
  if(element)m.receiptObserver.observe(element);
 }
}
function setupOrderChatReceipts(m){
 m.receiptOwner=state.user.id;m.visibleIncomingIds=new Set();m.readKnown=new Set();m.readPending=new Set();
 m.receiptObserver=new IntersectionObserver(entries=>{
  for(const entry of entries){
   const id=Number(entry.target.dataset.orderMessage);
   if(entry.isIntersecting&&entry.intersectionRect.height>=Math.min(32,entry.boundingClientRect.height*.5))m.visibleIncomingIds.add(id);
   else m.visibleIncomingIds.delete(id);
  }
  queueOrderReadReceipts(m);
 },{root:$('#order-chat-messages'),threshold:[0,.05,.1,.25,.5,1]});
}
async function confirmOrderChatDelivery(messages,owner=state.user?.id){
 if(state.user?.id!==owner)return;
 const ids=messages.filter(message=>message.sender_id!==owner&&!message.delivered_at).map(message=>message.id);
 if(ids.length)await post('/api/account/order-chat/delivered',{message_ids:ids});
}
let orderInboxBusy=false;
async function pollOrderChatInbox(){
 if(orderInboxBusy||!['CUSTOMER','DRIVER'].includes(state.user?.role))return;
 const owner=state.user.id;orderInboxBusy=true;
 try{
  const inbox=await get('/api/account/order-chat/inbox');if(state.user?.id!==owner)return;
  await confirmOrderChatDelivery(inbox.messages,owner);
  if(inbox.has_more&&state.user?.id===owner)setTimeout(pollOrderChatInbox,0);
 }catch{}finally{orderInboxBusy=false;}
}
setInterval(pollOrderChatInbox,3000);
document.addEventListener('visibilitychange',()=>queueOrderReadReceipts());
window.addEventListener('focus',()=>queueOrderReadReceipts());
window.addEventListener('blur',()=>{if(state.modal)clearTimeout(state.modal.readReceiptTimer);});
document.addEventListener('scroll',()=>queueOrderReadReceipts(),true);


function achievementsPage(){
 return `<div class="dash-top"><div><span class="kicker">APRESIASI PENGANJEM</span><h1>Pencapaian</h1><p>Setiap anjeman, selangkah lebih dekat ke hadiah.</p></div><button type="button" class="button secondary tiny" data-achievements-refresh>Refresh progres</button></div><div id="achievement-results" aria-live="polite" aria-busy="true"><div class="card">Memuat pencapaianmu...</div></div>`;
}
function achievementCard(m,index){
 const claimed=m.status==='CLAIMED',ready=m.status==='READY';
 const status=claimed?'Sudah diklaim':ready?'Target tercapai':'Dalam perjalanan';
 const button=claimed?`<span class="achievement-claimed">${ico('check','sm')} Hadiah masuk saldo</span>`:m.canClaim?`<button type="button" class="button full" data-claim-achievement="${esc(m.id)}">Klaim ${money(m.amount)}</button>`:`<span class="achievement-locked">${ico(ready?'trophy':'lock','sm')} ${ready?'Klaim belum aktif':m.remaining+' anjeman lagi'}</span>`;
 return `<article class="achievement-card ${claimed?'is-claimed':ready?'is-ready':''}"><div class="achievement-card-top"><span class="achievement-medal" aria-hidden="true">${ico(claimed?'check':'trophy')}</span><span class="achievement-status">${status}</span></div><span class="achievement-level">PENCAPAIAN ${String(index+1).padStart(2,'0')}</span><h3>${esc(m.title)}</h3><p class="achievement-target">${m.target} anjeman selesai</p><strong class="achievement-amount">${money(m.amount)}</strong><div class="achievement-progress-label"><span>${m.progress} / ${m.target} anjeman</span><span>${Math.floor(m.progress/m.target*100)}%</span></div><progress max="${m.target}" value="${m.progress}" aria-label="Progres ${esc(m.title)}"></progress><div class="achievement-card-action">${button}</div></article>`;
}
function achievementsContent(d){
 const next=d.nextMilestone,complete=!next;
 const title=next?`Menuju ${esc(next.title)}`:'Semua target tercapai!';
 const intro=next?`Selesaikan <strong>${next.remaining} anjeman lagi</strong> untuk membuka bonus ${money(next.amount)}.`:'Perjalananmu luar biasa. Klaim hadiah yang tersedia dan terima kasih sudah jadi andalan ANJEMIN!';
 const ready=d.milestones.filter(m=>m.canClaim).length;
 return `<section class="achievement-hero"><div><span class="achievement-hero-label">${ico('spark','sm')} ANJEMIN REWARDS</span><h2>${title}</h2><p>${intro}</p><div class="achievement-hero-progress"><progress max="${next?.target||1}" value="${next?.progress??1}" aria-label="Progres target berikutnya"></progress><span>${next?d.completed+' / '+next.target+' anjeman':'6 dari 6 target terbuka'}</span></div></div><div class="achievement-hero-award" aria-hidden="true"><span class="achievement-orbit"></span>${ico('trophy')}<span>${complete?'HEBAT!':'TERUS MELAJU'}</span></div></section><div class="achievement-summary"><div><span>Anjeman selesai</span><strong>${d.completed.toLocaleString('id-ID')}</strong><small>Antar-jemput yang sudah lunas</small></div><div><span>Reward terkumpul</span><strong>${money(d.claimedTotal)}</strong><small>Sudah masuk saldo Penganjem</small></div><div><span>Siap diklaim</span><strong>${money(d.claimableTotal)}</strong><small>${ready?ready+' hadiah menunggumu':'Lanjutkan perjalananmu'}</small></div></div><div class="note achievement-mode">${ico('spark','sm')} ${d.simulationEnabled?'Reward ini masih simulasi, belum berupa uang sungguhan.':'Klaim reward hanya aktif dalam mode simulasi.'}</div>${!d.eligible?'<div class="note warning">Klaim hadiah tersedia setelah akun Penganjem disetujui Pengelola.</div>':''}<div class="achievement-section-heading"><div><h2>Jejak pencapaianmu</h2><p>Bonus setiap target bisa diklaim satu kali, tanpa reset bulanan.</p></div><button class="button secondary tiny" type="button" data-nav="wallet">Lihat saldo ${ico('chevron','sm')}</button></div><div class="achievement-grid">${d.milestones.map(achievementCard).join('')}</div><div class="card achievement-rules"><h3>Cara mendapatkan reward</h3><p>Yang dihitung adalah pesanan antar-jemput (ANJEMIN) yang sudah dikonfirmasi selesai oleh customer, pembayarannya lunas, dan dana masuk ke saldo Penganjem pada mode pembayaran yang sama.</p><p>Pesanan batal, belum lunas, kirim barang, jasa titip, dan marketplace tidak menambah progres. Target bersifat kumulatif: pada 25 anjeman kamu bisa mendapat bonus target 10 dan 25, masing-masing sekali.</p></div>`;
}
let achievementLoadSequence=0;
async function loadAchievements(){
 if(state.user?.role!=='DRIVER'||state.page!=='achievements')return;
 const sequence=++achievementLoadSequence,userId=state.user.id;
 const el=$('#achievement-results');if(!el)return;el.setAttribute('aria-busy','true');
 try{
  const data=await get('/api/driver/achievements');
  if(state.user?.id!==userId||state.page!=='achievements'||sequence!==achievementLoadSequence)return;
  el.innerHTML=achievementsContent(data);
 }catch(e){
  if(state.user?.id===userId&&state.page==='achievements'&&sequence===achievementLoadSequence)el.innerHTML='<div class="card" role="alert">Pencapaian belum dapat dimuat. Klik Refresh progres untuk mencoba lagi.</div>';
  toast(e.message,true);
 }finally{if(el.isConnected&&sequence===achievementLoadSequence)el.setAttribute('aria-busy','false');}
}
document.addEventListener('click',async e=>{
 const refresh=e.target.closest('[data-achievements-refresh]');
 if(refresh){await loadAchievements();return;}
 const button=e.target.closest('[data-claim-achievement]');
 if(!button||button.disabled||state.user?.role!=='DRIVER')return;
 const userId=state.user.id;button.disabled=true;button.textContent='Memproses...';
 try{
  const result=await post('/api/driver/achievements/'+encodeURIComponent(button.dataset.claimAchievement)+'/claim');
  if(state.user?.id!==userId)return;
  toast(result.message);
  refreshHeaderWallet(true);
  if(state.page==='achievements')await loadAchievements();
  if(state.page==='wallet')await loadWallet();
 }catch(error){toast(error.message,true);if(state.page==='achievements'&&state.user?.id===userId)await loadAchievements();}
 finally{if(button.isConnected){button.disabled=false;button.textContent='Coba klaim lagi';}}
});


function jastipCustomerForm(){
 state.selectedPlace=null;state.jastipPickupCoords=null;state.destinationCoords=null;
 const places=state.config?.placesEnabled;
 return `<div class="jastip-page"><div class="dash-top jastip-page-top"><div><span class="kicker">PESAN LAYANAN</span><h1>Jasa Titip</h1><p>Titip belanja, lanjutkan aktivitasmu.</p></div><button type="button" class="button secondary tiny" data-nav="home">Lihat layanan ${ico('chevron','sm')}</button></div><section class="jastip-hero"><div><span class="jastip-eyebrow">${ico('spark','sm')} TITIP PRAKTIS, SAMPAI BERES</span><h2>Kamu titip.<br/>Kami jemput & antar.</h2><p>Dari jajan favorit sampai kebutuhan kos. Tulis titipanmu, Penganjem siap membantu.</p><div class="jastip-hero-tags"><span>${ico('store','sm')} Pilih tempat belanja</span><span>${ico('shopping','sm')} Tulis titipan</span><span>${ico('bike','sm')} Antar ke kamu</span></div></div><div class="jastip-hero-art" aria-hidden="true"><span class="jastip-art-orbit"></span><span class="jastip-art-bag">${ico('shopping')}</span><span class="jastip-art-chip chip-store">${ico('store','sm')} Toko pilihanmu</span><span class="jastip-art-chip chip-delivery">${ico('check','sm')} Sampai tujuan</span><span class="jastip-art-star">${ico('spark')}</span></div></section><form id="order-form" data-type="JASTIP" data-jastip-form data-step="1" novalidate><div class="jastip-layout"><section class="jastip-form-card"><ol class="jastip-steps" aria-label="Tahap pemesanan">${[['Lokasi belanja','store'],['Titipan & antar','shopping'],['Cek pesanan','check']].map(([label,icon],i)=>`<li><button type="button" data-jastip-step="${i+1}" ${i===0?'aria-current="step"':''}><span>${ico(icon,'sm')}</span><strong>${label}</strong><small>0${i+1}</small></button></li>`).join('')}</ol><div class="jastip-panels"><section data-jastip-panel="1" aria-labelledby="jastip-step-one"><div class="jastip-section-title"><span>01</span><div><h2 id="jastip-step-one" tabindex="-1">Belanja di mana?</h2><p>Tentukan toko atau tempat pengambilan titipanmu.</p></div></div>${places?`<div class="field jastip-search"><label for="place-query">Cari toko atau tempat makan</label><div><input id="place-query" type="search" placeholder="Contoh: ayam geprek, kopi, fotokopi" autocomplete="off"/><button type="button" class="button" data-action="search-place">Cari ${ico('chevron','sm')}</button></div></div><div id="place-results" class="places-list jastip-place-results" aria-live="polite"><p class="form-hint">Cari tempat di atas, atau isi alamat toko langsung di bawah.</p></div><div class="jastip-divider"><span>atau isi sendiri</span></div>`:'<div class="jastip-inline-note">'+ico('store','sm')+' Sudah tahu tokonya? Langsung isi nama dan alamatnya.</div>'}<input type="hidden" name="place_id" id="selected-place-id"/><div id="jastip-selected-store" class="jastip-selected-store" hidden><span>${ico('check','sm')} Tempat dipilih dari pencarian</span><button type="button" data-jastip-clear-store>Ganti</button></div><div class="field"><label for="selected-place-name">Nama toko <span class="jastip-optional">opsional</span></label><input id="selected-place-name" name="place_name" maxlength="120" placeholder="Contoh: Warung Bu Sari"/></div><div class="field"><label for="jastip-pickup">Alamat toko / lokasi belanja <span aria-hidden="true">*</span></label><textarea id="jastip-pickup" name="pickup" required minlength="5" maxlength="240" rows="2" placeholder="Nama jalan, nomor, atau patokan tempat belanja"></textarea><p class="form-hint">Isi alamat tempat Penganjem membeli atau mengambil barang.</p></div><div class="location-field-actions"><button type="button" class="button secondary tiny" data-location-target="pickup">${ico('map','sm')} Pilih titik belanja di peta</button></div></section><section data-jastip-panel="2" aria-labelledby="jastip-step-two" hidden><div class="jastip-section-title"><span>02</span><div><h2 id="jastip-step-two" tabindex="-1">Mau titip apa?</h2><p>Detail yang jelas membantu Penganjem belanja sesuai keinginanmu.</p></div></div><div class="field"><label for="jastip-items">Daftar titipan <span aria-hidden="true">*</span></label><textarea id="jastip-items" name="item_name" required minlength="3" maxlength="400" rows="3" placeholder="Contoh: 2 nasi ayam tidak pedas, 1 es teh tanpa es."></textarea><p class="form-hint">Sertakan jumlah, varian, dan pilihan pengganti jika barang habis.</p></div><div class="jastip-delivery-heading"><h3>${ico('map','sm')} Antar ke mana?</h3><button type="button" class="button secondary tiny" data-jastip-gps>${ico('map','sm')} Gunakan lokasi saya</button></div><div class="field"><label for="destination">Alamat antar <span aria-hidden="true">*</span></label><textarea id="destination" name="destination" required minlength="5" maxlength="240" rows="2" placeholder="Contoh: Kos Melati, Jl. Banjarsari No. 12, pagar putih"></textarea><p id="jastip-gps-status" class="form-hint" role="status">GPS membantu memilih titik antar. Tulis alamat dan patokannya sendiri.</p></div><div class="location-field-actions"><button type="button" class="button secondary tiny" data-location-target="destination">${ico('map','sm')} Pilih titik antar di peta</button></div><div class="field"><label for="jastip-notes">Catatan untuk Penganjem <span class="jastip-optional">opsional</span></label><textarea id="jastip-notes" name="notes" maxlength="1000" rows="2" placeholder="Patokan alamat, pesan ke penjual, atau instruksi khusus."></textarea></div></section><section data-jastip-panel="3" aria-labelledby="jastip-step-three" hidden><div class="jastip-section-title"><span>03</span><div><h2 id="jastip-step-three" tabindex="-1">Cek dulu, baru titip.</h2><p>Pastikan lokasi dan detail pesananmu sudah sesuai.</p></div></div><div id="jastip-review" class="jastip-review"></div><div class="jastip-divider"><span>tarif & voucher</span></div><div class="form-row"><div class="field"><label for="jastip-fare">Tarif jasa simulasi <span aria-hidden="true">*</span></label><div class="jastip-money-input"><span>Rp</span><input id="jastip-fare" name="fare" type="text" inputmode="numeric" data-money="true" data-min="1000" data-max="5000000" value="6,000" required aria-describedby="jastip-fare-hint"/></div><p id="jastip-fare-hint" class="form-hint">Tarif contoh untuk mencoba alur pemesanan.</p></div><div class="field"><label for="voucher-select">Voucher <span class="jastip-optional">opsional</span></label><select name="voucher_id" id="voucher-select"><option value="" data-amount="0">Tanpa voucher</option></select><p id="jastip-voucher-hint" class="form-hint">Potongan hanya berlaku untuk tarif jasa.</p></div></div><div class="jastip-inline-note">${ico('chat','sm')} Harga belanja disepakati dengan Penganjem lewat chat dan belum termasuk tarif jasa.</div></section></div></section><aside class="jastip-summary"><div class="jastip-summary-heading"><span class="jastip-summary-icon">${ico('shopping')}</span><div><h2>Ringkasan titipan</h2><span class="jastip-summary-mode">${state.config?.paymentMode==='SIMULATION'?'Mode simulasi':'Pemesanan jasa'}</span></div></div><div class="jastip-route"><div><span class="jastip-route-dot"></span><div><span>Lokasi belanja</span><strong id="jastip-summary-store">Belum dipilih</strong><p id="jastip-summary-pickup">Tentukan toko atau tempat belanja.</p></div></div><div><span class="jastip-route-dot destination"></span><div><span>Alamat antar</span><strong id="jastip-summary-destination">Belum diisi</strong></div></div></div><div class="jastip-summary-items"><span>Titipanmu</span><p id="jastip-summary-items">Tulis barang dan jumlah yang dibutuhkan.</p></div><dl class="jastip-costs"><div><dt>Tarif jasa</dt><dd id="jastip-summary-fare">${money(6000)}</dd></div><div id="jastip-discount-row" hidden><dt>Potongan voucher</dt><dd id="jastip-summary-discount"></dd></div><div class="jastip-total"><dt>Total jasa</dt><dd id="jastip-summary-total">${money(6000)}</dd></div></dl><p class="jastip-goods-note">Belum termasuk harga barang belanjaan.</p><div class="jastip-payment-note">${ico('lock','sm')} <p>${state.config?.paymentMode==='SIMULATION'?'Simulasi tanpa uang sungguhan. ':''}Pembayaran tersedia setelah Penganjem menerima pesanan. Dana jasa dilepas setelah kamu konfirmasi selesai.</p></div></aside></div><div class="jastip-navigation"><button type="button" class="button secondary" data-jastip-back hidden>Kembali</button><span id="jastip-step-caption">Langkah 1 dari 3</span><button type="button" class="button" data-jastip-next>Lanjut ke detail ${ico('chevron','sm')}</button><button type="submit" class="button" hidden>${ico('bike')} Cari Penganjem</button></div></form></div>`;
}
function validateJastipFields(form,steps){
 for(const step of steps){
  const panel=form.querySelector('[data-jastip-panel="'+step+'"]');
  for(const input of panel.querySelectorAll('input,textarea,select')){
   if(input.required&&!input.value.trim())input.setCustomValidity('Lengkapi bagian ini dulu, ya.');
   else if(input.value.trim()&&input.minLength>0&&input.value.trim().length<input.minLength)input.setCustomValidity('Isi minimal '+input.minLength+' karakter, ya.');
   else if(!input.matches('[data-money]'))input.setCustomValidity('');
   if(!input.checkValidity()){
    setJastipStep(form,step,{validate:false,focus:false});input.reportValidity();input.focus();return false;
   }
  }
 }
 return true;
}
function setJastipStep(form,step,{validate=true,focus=true}={}){
 if(!form?.isConnected||step<1||step>3)return;
 const current=Number(form.dataset.step);
 if(validate&&step>current&&!validateJastipFields(form,Array.from({length:step-1},(_,i)=>i+1)))return;
 form.dataset.step=String(step);
 for(const panel of form.querySelectorAll('[data-jastip-panel]'))panel.hidden=Number(panel.dataset.jastipPanel)!==step;
 for(const button of form.querySelectorAll('.jastip-steps [data-jastip-step]')){
  const n=Number(button.dataset.jastipStep);button.parentElement.classList.toggle('is-complete',n<step);
  if(n===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
 }
 form.querySelector('[data-jastip-back]').hidden=step===1;
 form.querySelector('[data-jastip-next]').hidden=step===3;
 form.querySelector('[type="submit"]').hidden=step!==3;
 form.querySelector('[data-jastip-next]').innerHTML=(step===1?'Lanjut ke detail':'Cek pesanan')+' '+ico('chevron','sm');
 form.querySelector('#jastip-step-caption').textContent='Langkah '+step+' dari 3';
 updateJastipSummary(form);
 const panel=form.querySelector('[data-jastip-panel="'+step+'"]');
 panel.classList.remove('jastip-panel-enter');void panel.offsetWidth;panel.classList.add('jastip-panel-enter');
 if(focus){panel.querySelector('h2').focus({preventScroll:true});if(form.getBoundingClientRect().top<76)form.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
}
function updateJastipSummary(form){
 if(!form?.matches('[data-jastip-form]')||!form.isConnected)return;
 const values=pickFormValues(form),fare=Number(values.fare)||0,option=form.elements.voucher_id.selectedOptions[0];
 const discount=Math.min(fare,Number(option?.dataset.amount)||0);
 const text=(id,value)=>{const el=form.querySelector('#'+id);if(el)el.textContent=value;};
 text('jastip-summary-store',values.place_name.trim()||'Lokasi belanja');
 text('jastip-summary-pickup',values.pickup.trim()||'Tentukan toko atau tempat belanja.');
 text('jastip-summary-destination',values.destination.trim()||'Belum diisi');
 text('jastip-summary-items',values.item_name.trim()||'Tulis barang dan jumlah yang dibutuhkan.');
 text('jastip-summary-fare',money(fare));text('jastip-summary-discount','- '+money(discount));text('jastip-summary-total',money(Math.max(0,fare-discount)));
 form.querySelector('#jastip-discount-row').hidden=discount===0;
 form.querySelector('#jastip-selected-store').hidden=!state.selectedPlace;
 const review=form.querySelector('#jastip-review');
 review.innerHTML=[['Belanja di',values.place_name.trim()||'Lokasi belanja',values.pickup,1],['Titipan',values.item_name,'',2],['Antar ke',values.destination,'',2],...(values.notes.trim()?[['Catatan',values.notes,'',2]]:[])].map(([label,value,detail,step])=>`<div><div><span>${label}</span><strong>${esc(value)}</strong>${detail?'<p>'+esc(detail)+'</p>':''}</div><button type="button" data-jastip-step="${step}">Ubah</button></div>`).join('');
}
async function jastipUseLocation(form,button){return pickOrderLocation('destination',{form,locate:true});}

document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-jastip-step],[data-jastip-next],[data-jastip-back],[data-jastip-gps],[data-jastip-clear-store]');
 if(!button||button.disabled)return;const form=button.closest('[data-jastip-form]');if(!form)return;
 if('jastipGps' in button.dataset){await jastipUseLocation(form,button);return;}
 if('jastipClearStore' in button.dataset){
  state.selectedPlace=null;state.jastipPickupCoords=null;form.elements.place_id.value='';form.elements.place_name.value='';form.elements.pickup.value='';
  form.querySelectorAll('[data-place]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
  updateJastipSummary(form);form.elements.place_name.focus();return;
 }
 const step=button.dataset.jastipStep?Number(button.dataset.jastipStep):Number(form.dataset.step)+('jastipNext' in button.dataset?1:-1);
 setJastipStep(form,step);
});
document.addEventListener('input',e=>{
 const input=e.target,form=input.closest('[data-jastip-form]');if(!form)return;
 if(!input.matches('[data-money]'))input.setCustomValidity('');
 if(['pickup','place_name'].includes(input.name)){
  state.selectedPlace=null;state.jastipPickupCoords=null;form.elements.place_id.value='';
  form.querySelectorAll('[data-place]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
 }
 if(input.name==='destination'){state.destinationCoords=null;form.querySelector('#jastip-gps-status').textContent='Alamat antar menggunakan alamat yang kamu tulis.';}
 updateJastipSummary(form);
});
document.addEventListener('change',e=>{const form=e.target.closest('[data-jastip-form]');if(form)updateJastipSummary(form);});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='place-query'&&e.target.closest('[data-jastip-form]')){e.preventDefault();searchPlaces().catch(error=>toast(error.message,true));}});


setInterval(()=>{if(state.user?.role==='DRIVER'&&!document.hidden)refreshHeaderWallet();},30000);

function renderChangePassword(){
 $('#modal-root').innerHTML=modalWrap('Ganti Password',`<form id="change-password-form"><div class="field"><label for="current-password">Password lama</label><input id="current-password" name="current_password" type="password" autocomplete="current-password" required maxlength="128"/></div><div class="field"><label for="new-password">Password baru</label><input id="new-password" name="new_password" type="password" autocomplete="new-password" required minlength="10" maxlength="128"/><p class="form-hint">Gunakan 10 sampai 128 karakter.</p></div><div class="field"><label for="confirm-password">Konfirmasi password baru</label><input id="confirm-password" name="confirm_password" type="password" autocomplete="new-password" required minlength="10" maxlength="128"/></div><button type="submit" class="button full">Simpan Password</button></form>`);
 $('#current-password')?.focus();
}
document.addEventListener('click',e=>{
 const menu=document.querySelector('.header-account-menu[open]');
 if(menu&&(!menu.contains(e.target)||e.target.closest('.account-submenu button')))menu.open=false;
});
document.addEventListener('keydown',e=>{
 const menu=document.querySelector('.header-account-menu[open]');
 if(e.key==='Escape'&&menu){menu.open=false;menu.querySelector('summary')?.focus();}
});
document.addEventListener('submit',async e=>{
 const form=e.target;if(form.id!=='change-password-form')return;
 e.preventDefault();const b=Object.fromEntries(new FormData(form));
 if(b.new_password!==b.confirm_password){toast('Konfirmasi password baru tidak sama.',true);return;}
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 try{const result=await post('/api/account/password',b);form.reset();closeModal();toast(result.message);}
 catch(error){toast(error.message,true);}
 finally{if(button.isConnected)button.disabled=false;}
});

document.addEventListener('click',e=>{
 const button=e.target.closest('[data-driver-withdraw]');
 if(button&&!button.disabled&&state.user?.role==='DRIVER')openModal('market-withdrawal',{driver:true,stage:'form'});
});

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-location-target]');
 if(!button||button.disabled)return;
 void pickOrderLocation(button.dataset.locationTarget,{form:button.closest('#order-form')||$('#order-form')}).catch(error=>toast(error.message,true));
});
document.addEventListener('input',event=>{
 const input=event.target,form=input.closest('#order-form');
 if(!form||form.matches('[data-jastip-form]'))return;
 if(input.name==='pickup')state.coords=null;
 if(input.name==='destination'){
  state.destinationCoords=null;
  const summary=$('[data-location-summary="destination"]');if(summary)summary.textContent=input.value.trim()||'Titik tujuan belum dipilih. Kamu juga bisa menulis alamat.';
 }
});
