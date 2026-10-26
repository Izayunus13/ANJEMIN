import {driverBalance,driverWithdrawals,withdrawDriverSimulation} from './driver-withdrawals.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {db,seedAdmin} from './db.js';
import {uuid,hashPassword,verifyPassword,sha256,currentUser,createSession,requireUser,requireRole,validatePhone,limited,amount,dateAfter,apiError,rateLimit,cookieHeader,needsProfile} from './security.js';
import {saveImage,loadImage,removeImage} from './upload.js';
import {paymentMode,paymentFor,createPayment,refreshPayment,settlePayment,releasePayment,verifyNotification,storeGatewayStatus} from './payments.js';
import {commissionEntries,profitStatistics} from './analytics.js';
import {driverAchievements,claimDriverAchievement} from './driver-achievements.js';
import {requireMarketSimulation,marketPaymentFor,createMarketPayment,payMarketSimulation,cancelMarketPayment,releaseMarketPayment} from './market-payments.js';
import {withdrawalProviders,sellerBalance,sellerWithdrawals,withdrawMarketSimulation} from './market-withdrawals.js';
import {identityFor,updateAccountProfile} from './account-profiles.js';
import {orderMediaUsage,sendOrderChatMessage,orderChatMessages,loadOrderChatMedia,orderChatReceipts,pendingOrderChatInbox,acknowledgeOrderChat} from './order-chat.js';

const root=path.resolve('client');
const envFile=path.resolve('.env');
if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
 const match=line.match(/^([A-Z_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
}
const prod=process.env.NODE_ENV==='production';
const PORT=Number(process.env.PORT||3000);
if(prod && !process.env.TWILIO_VERIFY_SERVICE_SID)console.warn('PRODUKSI: OTP SMS belum disiapkan; pendaftaran akan dinonaktifkan.');
seedAdmin({email:process.env.ADMIN_EMAIL,username:process.env.ADMIN_USERNAME,phone:process.env.ADMIN_PHONE,password:process.env.ADMIN_PASSWORD,hashPassword});
const subscribers=new Set();
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const send=(res,data)=>json(res,200,data);
const routeMatchers=[];
function route(method,re,fn){routeMatchers.push({method,re,fn});}
function parseJson(req,maxBytes=7*1024*1024){return new Promise((resolve,reject)=>{
 let buf='',bytes=0;req.on('data',part=>{bytes+=part.length;buf+=part;if(bytes>maxBytes){reject(apiError('Ukuran permintaan terlalu besar.',413));req.destroy();}});
 req.on('end',()=>{try{resolve(buf?JSON.parse(buf):{});}catch{reject(apiError('JSON tidak valid.'));}});req.on('error',reject);
});}
function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function clientIp(req){return req.headers['x-real-ip']||req.socket.remoteAddress||'local';}
async function twilio(endpoint,params){
 const sid=process.env.TWILIO_ACCOUNT_SID,auth=process.env.TWILIO_AUTH_TOKEN,service=process.env.TWILIO_VERIFY_SERVICE_SID;
 if(!sid||!auth||!service)throw apiError('Penyedia OTP SMS belum dikonfigurasi.',503);
 const url=`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${endpoint}`;
 const resp=await fetch(url,{method:'POST',headers:{'Authorization':'Basic '+Buffer.from(`${sid}:${auth}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
 const data=await resp.json();if(!resp.ok)throw apiError('Gagal mengirim / memverifikasi OTP. Coba lagi.',502);return data;
}
function referralCode(){return 'AJ'+crypto.randomBytes(4).toString('hex').toUpperCase();}
function publicUser(u){return u&&{id:u.id,full_name:u.full_name,username:u.username,email:u.email,phone:u.phone,role:u.role,driver_status:u.driver_status,ready:!!u.ready,referral_code:u.referral_code,profile_photo_path:u.profile_photo_path||null,profile_complete:!needsProfile(u)};}
const MAX_OTP_ATTEMPTS=5;
const OTP_CODE_TTL_MS=5*60*1000;
const OTP_VERIFICATION_GRANT_MS=15*60*1000;
route('GET',/^\/api\/config$/,async(req,res)=>send(res,{brand:'ANJEMIN',paymentMode:paymentMode(),mapsBrowserKey:process.env.GOOGLE_MAPS_BROWSER_KEY||'',mapsEnabled:!!process.env.GOOGLE_MAPS_BROWSER_KEY,placesEnabled:!!process.env.GOOGLE_PLACES_SERVER_KEY,mode:prod?'production':'development',supportEmail:process.env.SUPPORT_EMAIL||'',supportWhatsapp:process.env.SUPPORT_WHATSAPP||''}));
route('POST',/^\/api\/auth\/otp\/request$/,async(req,res)=>{
 rateLimit('otp-ip-'+clientIp(req),8,60);
 const b=await parseJson(req),phone=validatePhone(b.phone);
 rateLimit('otp-phone-'+phone,3,30);
 if(db.prepare('SELECT id FROM users WHERE phone=?').get(phone))throw apiError('Nomor ini sudah terdaftar. Silakan login.',409);
 const old=db.prepare('SELECT last_sent_at FROM signup_otp WHERE phone=?').get(phone);
 if(old&&Date.now()-Date.parse(old.last_sent_at)<60000)throw apiError('Tunggu 60 detik sebelum meminta kode lagi.',429);
 const sentAt=new Date().toISOString(),expiresAt=new Date(Date.now()+OTP_CODE_TTL_MS).toISOString();
 if(process.env.TWILIO_VERIFY_SERVICE_SID){await twilio('Verifications',{To:'+'+phone,Channel:'sms'});
   db.prepare(`INSERT INTO signup_otp(phone,code_hash,expires_at,attempts,verified,last_sent_at) VALUES(?,?,?,0,0,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,verified=0,last_sent_at=excluded.last_sent_at`).run(phone,'TWILIO',expiresAt,sentAt);
 }else{
   if(prod)throw apiError('OTP SMS belum tersedia. Hubungi pengelola.',503);
   const code=String(crypto.randomInt(100000,999999));
   db.prepare(`INSERT INTO signup_otp(phone,code_hash,expires_at,attempts,verified,last_sent_at) VALUES(?,?,?,0,0,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,verified=0,last_sent_at=excluded.last_sent_at`).run(phone,sha256(code),expiresAt,sentAt);
   console.log(`[OTP DEVELOPMENT - HANYA LOCAL] +${phone}: ${code}`);
 }
 send(res,{message:'Kode verifikasi telah diproses. Periksa SMS atau terminal server dalam mode development.',development:!process.env.TWILIO_VERIFY_SERVICE_SID,normalizedPhone:phone,expiresAt,expiresInSeconds:OTP_CODE_TTL_MS/1000,retryAfterSeconds:60,serverNow:sentAt});
});
route('POST',/^\/api\/auth\/otp\/verify$/,async(req,res)=>{
 const b=await parseJson(req),phone=validatePhone(b.phone),code=String(b.code||'').trim();
 if(!/^\d{6}$/.test(code))throw apiError('Masukkan 6 digit kode verifikasi.',400);
 rateLimit('otp-verify-'+phone,12,30);
 const row=db.prepare('SELECT * FROM signup_otp WHERE phone=?').get(phone);
 if(!row||Date.parse(row.expires_at)<Date.now()||row.attempts>=MAX_OTP_ATTEMPTS)throw apiError('OTP kedaluwarsa / terlalu banyak percobaan. Minta ulang.',400);
 if(row.verified){const remaining=Math.max(1,Math.ceil((Date.parse(row.expires_at)-Date.now())/1000));send(res,{verified:true,verifiedUntil:row.expires_at,verifiedForSeconds:remaining,alreadyVerified:true});return;}
 let valid=false;
 if(row.code_hash==='TWILIO'){const a=await twilio('VerificationCheck',{To:'+'+phone,Code:code});valid=a.status==='approved';}
 else valid=sha256(code)===row.code_hash;
 if(!valid){db.prepare('UPDATE signup_otp SET attempts=attempts+1 WHERE phone=?').run(phone);throw apiError('Kode verifikasi salah.',400);}
 const verifiedUntil=new Date(Date.now()+OTP_VERIFICATION_GRANT_MS).toISOString();
 db.prepare('UPDATE signup_otp SET verified=1,expires_at=? WHERE phone=?').run(verifiedUntil,phone);
 send(res,{verified:true,verifiedUntil,verifiedForSeconds:OTP_VERIFICATION_GRANT_MS/1000});
});
route('POST',/^\/api\/auth\/signup$/,async(req,res)=>{
 rateLimit('signup-'+clientIp(req),12,60);
 const b=await parseJson(req,12*1024*1024),name=limited(b.full_name,3,80,'Nama'),username=limited(b.username,3,24,'Username').toLowerCase(),email=limited(b.email,5,120,'Email').toLowerCase(),phone=validatePhone(b.phone),password=String(b.password||'');
 const role=b.role==='DRIVER'?'DRIVER':'CUSTOMER';
 if(!/^[a-z0-9_]+$/.test(username))throw apiError('Username hanya huruf kecil, angka, dan underscore.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw apiError('Email tidak valid.');
 if(password.length<10||password.length>128)throw apiError('Password harus 10–128 karakter.');
 let ktm=null,sim=null,simType=null,campus=null,vehicle=null;
 if(role==='DRIVER'){
   if(b.driver_rules_accepted!==true||b.driver_rules_version!=='2026-10-26')throw apiError('Baca dan setujui peraturan Penganjem terbaru sebelum mendaftar.');
   campus=limited(b.campus_email,5,120,'Email kampus');vehicle=limited(b.vehicle,4,120,'Keterangan kendaraan');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campus))throw apiError('Email kampus tidak valid.');
   if(b.sim_declared!==true)throw apiError('Calon Penganjem wajib menyatakan kepemilikan SIM dan kelayakan berkendara.');
   if(!['A','C'].includes(b.sim_type))throw apiError('Pilih jenis SIM A atau SIM C.');
   simType=b.sim_type;
   if(!b.sim_photo)throw apiError('Foto SIM wajib dilampirkan.');
   if(!b.ktm_photo)throw apiError('Foto KTM wajib dilampirkan.');
 }
 const otp=db.prepare('SELECT verified,expires_at FROM signup_otp WHERE phone=?').get(phone);
 if(!otp||!otp.verified||Date.parse(otp.expires_at)<Date.now())throw apiError('Verifikasi nomor HP dahulu.');
 const inviter=b.referral?db.prepare('SELECT id FROM users WHERE referral_code=?').get(String(b.referral).toUpperCase()):null;
 if(b.referral&&!inviter)throw apiError('Kode referral tidak ditemukan.');
 const id=uuid();
 try{
  if(role==='DRIVER'){ktm=saveImage(b.ktm_photo,'private');sim=saveImage(b.sim_photo,'private');}
  tx(()=>{
   db.prepare(`INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ktm_path,campus_email,vehicle,sim_declared,sim_type,sim_path,referral_code,referred_by,profile_required)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(id,name,username,email,phone,hashPassword(password),role,role==='DRIVER'?'PENDING':'NONE',ktm,campus,vehicle,role==='DRIVER'?1:0,simType,sim,referralCode(),inviter?.id||null);
   if(role==='DRIVER')db.prepare('INSERT INTO driver_rules_consents(user_id,rules_version) VALUES(?,?)').run(id,'2026-10-26');
   db.prepare('DELETE FROM signup_otp WHERE phone=?').run(phone);
   if(inviter)db.prepare('INSERT INTO vouchers(id,user_id,amount,reason,expires_at) VALUES(?,?,?,?,?)').run(uuid(),id,500,'Referral pengguna baru',dateAfter(7));
 });}catch(e){
  for(const file of [ktm,sim])if(file)removeImage(file);
  if(String(e.message).includes('UNIQUE'))throw apiError('Username, email, atau nomor HP sudah digunakan.',409);throw e;
 }
 createSession(id,res,prod);
 send(res,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),message:role==='DRIVER'?'Akun driver menunggu persetujuan pengelola.':'Selamat datang di ANJEMIN!'});
});
route('POST',/^\/api\/auth\/login$/,async(req,res)=>{
 rateLimit('login-'+clientIp(req),25,30);
 const b=await parseJson(req),id=String(b.identifier||'').trim();
 const u=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE OR username=? COLLATE NOCASE').get(id,id);
 if(!u||!verifyPassword(String(b.password||''),u.password_hash))throw apiError('Email/username atau password salah.',401);
 if(u.account_status==='FROZEN')throw apiError('Akun dibekukan oleh Pengelola. Hubungi dukungan ANJEMIN untuk peninjauan.',403);
 createSession(u.id,res,prod,b.remember===true);send(res,{user:publicUser(u)});
});
route('POST',/^\/api\/auth\/logout$/,async(req,res)=>{
 const token=cookieHeader(req).anjemin_session;
 if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
 res.setHeader('Set-Cookie',`anjemin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${prod?'; Secure':''}`);send(res,{ok:true});
});
route('GET',/^\/api\/auth\/me$/,async(req,res)=>send(res,{user:publicUser(currentUser(req))}));
route('POST',/^\/api\/account\/password$/,async(req,res)=>{
 const u=requireUser(req);rateLimit('change-password-'+u.id,8,15);
 const b=await parseJson(req,4096),current=String(b.current_password||''),next=String(b.new_password||'');
 if(current.length>128)throw apiError('Password lama tidak valid.');
 if(next.length<10||next.length>128)throw apiError('Password baru harus 10 sampai 128 karakter.');
 if(next!==b.confirm_password)throw apiError('Konfirmasi password baru tidak sama.');
 const row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
 if(!verifyPassword(current,row.password_hash))throw apiError('Password lama salah.',400);
 if(current===next)throw apiError('Password baru harus berbeda dari password lama.');
 const hash=hashPassword(next),token=cookieHeader(req).anjemin_session;
 tx(()=>{
  const updated=db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(hash,u.id,row.password_hash);
  if(!updated.changes)throw apiError('Password telah berubah. Silakan coba lagi.',409);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(u.id,sha256(token));
 });
 send(res,{ok:true,message:'Password berhasil diganti.'});
});
route('GET',/^\/api\/account\/profile$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);send(res,{user:publicUser(u)});
});
route('POST',/^\/api\/account\/profile$/,async(req,res)=>{
 let u=requireRole(req,['CUSTOMER','DRIVER']);rateLimit('profile-'+u.id,30,60);
 const b=await parseJson(req);u=requireRole(req,['CUSTOMER','DRIVER']);
 const updated=updateAccountProfile(u.id,b);send(res,{user:publicUser(updated),message:'Profil berhasil disimpan.'});
});
route('GET',/^\/api\/users\/([\w-]+)\/profile$/,async(req,res,m)=>{
 requireUser(req);const profile=identityFor(m[1]);if(!profile)throw apiError('Profil tidak ditemukan.',404);
 send(res,{profile});
});
route('GET',/^\/api\/account\/vouchers$/,async(req,res)=>{
 const u=requireUser(req);
 send(res,{vouchers:db.prepare("SELECT id,amount,reason,expires_at FROM vouchers WHERE user_id=? AND redeemed_order_id IS NULL AND expires_at>? ORDER BY amount DESC").all(u.id,new Date().toISOString())});
});
route('GET',/^\/api\/image\/([\w.-]+)$/,async(req,res,m)=>{
 const name=m[1];if(name.startsWith('private-')){
   requireRole(req,['ADMIN']);
   if(!db.prepare('SELECT id FROM users WHERE ktm_path=? OR sim_path=?').get(name,name))throw apiError('Berkas tidak ditemukan.',404);
 }
 if(name.startsWith('avatar-')){
  requireUser(req);if(!db.prepare('SELECT id FROM users WHERE profile_photo_path=?').get(name))throw apiError('Foto profil tidak ditemukan.',404);
 }
 const {body,type}=loadImage(name);res.writeHead(200,{'Content-Type':type,'Cache-Control':name.startsWith('private-')||name.startsWith('avatar-')?'no-store':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(body);
});
route('GET',/^\/api\/listings$/,async(req,res)=>{
 const viewer=currentUser(req);
 const items=db.prepare(`SELECT l.id,l.title,l.category,l.price,l.description,l.image_path,l.image_paths,l.status,l.created_at,u.username seller_name,u.id seller_id
  FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.status='AVAILABLE' ORDER BY l.created_at DESC LIMIT 100`).all();send(res,{listings:items.map(item=>({...item,seller_profile:viewer?identityFor(item.seller_id):null}))});
});
route('GET',/^\/api\/listings\/mine$/,async(req,res)=>{
 const u=requireUser(req);send(res,{listings:db.prepare('SELECT * FROM listings WHERE seller_id=? ORDER BY created_at DESC').all(u.id)});
});
route('GET',/^\/api\/market\/orders\/mine$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']),view=new URL(req.url,'http://localhost').searchParams.get('view')||'BUYER';
 if(!['BUYER','SELLER'].includes(view))throw apiError('Pilihan pesanan tidak valid.');
 const orders=db.prepare(`SELECT o.*,buyer.username AS buyer_name,seller.username AS seller_name,c.id AS conversation_id
 FROM market_orders o JOIN users buyer ON buyer.id=o.buyer_id JOIN users seller ON seller.id=o.seller_id
 LEFT JOIN conversations c ON c.listing_id=o.listing_id AND c.buyer_id=o.buyer_id
 WHERE (?='BUYER' AND o.buyer_id=?) OR (?='SELLER' AND o.seller_id=?)
 ORDER BY o.created_at DESC,o.id DESC`).all(view,u.id,view,u.id);
 send(res,{orders:orders.map(o=>({...o,payment:marketPaymentFor(o.id),buyer_profile:identityFor(o.buyer_id),seller_profile:identityFor(o.seller_id)}))});
});
route('POST',/^\/api\/listings$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);rateLimit('listing-'+u.id,25,60);
 const b=await parseJson(req),title=limited(b.title,4,100,'Nama barang'),category=limited(b.category,2,30,'Kategori'),price=amount(b.price,1000,100000000),description=limited(b.description,10,2000,'Keterangan');
 const images=b.images===undefined?(b.image?[b.image]:[]):b.images;
 if(!Array.isArray(images)||images.length<1||images.length>5||images.some(image=>typeof image!=='string'))throw apiError('Lampirkan 1 sampai 5 foto barang.');
 if(images.reduce((total,image)=>total+image.length,0)>5600000)throw apiError('Total ukuran foto maksimal 4MB.');
 if(category.toLowerCase().startsWith('asap'))throw apiError('Kategori Asap belum dibuka pada versi awal; memerlukan moderasi dan kepatuhan barang terbatas.',403);
 const paths=images.map(image=>saveImage(image));const id=uuid();
 db.prepare('INSERT INTO listings(id,seller_id,title,category,price,description,image_path,image_paths) VALUES(?,?,?,?,?,?,?,?)').run(id,u.id,title,category,price,description,paths[0],JSON.stringify(paths));
 send(res,{id,message:'Barang berhasil dipasang.'});
});
route('POST',/^\/api\/listings\/([\w-]+)\/buy$/,async(req,res,m)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);const b=await parseJson(req);requireMarketSimulation();
 const row=tx(()=>{
  const item=db.prepare('SELECT * FROM listings WHERE id=?').get(m[1]);
  if(!item)throw apiError('Produk tidak ada.',404);if(item.seller_id===u.id)throw apiError('Tidak dapat membeli barang sendiri.');
  const price=b.agreed_price?amount(b.agreed_price,1000,100000000):item.price;
  if(price!==item.price){const conv=db.prepare('SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?').get(item.id,u.id);
    if(!conv||!db.prepare('SELECT id FROM messages WHERE conversation_id=? AND sender_id=? AND offer_amount=?').get(conv.id,item.seller_id,price))throw apiError('Harga tawar harus disetujui penjual melalui chat.');}
  const change=db.prepare("UPDATE listings SET status='RESERVED',buyer_id=?,agreed_price=? WHERE id=? AND status='AVAILABLE'").run(u.id,price,item.id);
  if(change.changes!==1)throw apiError('Barang sudah dipesan orang lain.',409);
  const orderId=uuid();
  db.prepare("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,category,image_path,amount,status,payment_required) VALUES(?,?,?,?,?,?,?,?,'RESERVED',1)")
   .run(orderId,item.id,u.id,item.seller_id,item.title,item.category,item.image_path,price);
  db.prepare('INSERT OR IGNORE INTO conversations(id,listing_id,buyer_id,seller_id) VALUES(?,?,?,?)').run(uuid(),item.id,u.id,item.seller_id);
  createMarketPayment(db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId));
  return {id:item.id,order_id:orderId,agreed_price:price};
 });send(res,{item:row,message:'Checkout berhasil. Bayar lewat website; dana ditahan sampai kamu mengonfirmasi barang diterima.'});
});
route('POST',/^\/api\/listings\/([\w-]+)\/complete$/,async(req,res,m)=>{
 const u=requireUser(req),b=await parseJson(req);
 const out=tx(()=>{
  const item=db.prepare('SELECT * FROM listings WHERE id=?').get(m[1]);
  if(!item||item.seller_id!==u.id)throw apiError('Hanya pemilik barang yang dapat konfirmasi.',403);
  if(item.status!=='RESERVED')throw apiError('Barang tidak dalam proses reservasi.');
  const order=db.prepare("SELECT * FROM market_orders WHERE listing_id=? AND status='RESERVED'").get(item.id);
  if(b.order_id&&b.order_id!==order?.id)throw apiError('Status pesanan sudah berubah. Refresh pesanan terlebih dahulu.',409);
  if(order?.payment_required)throw apiError('Transaksi ini memakai pembayaran website. Penjual menandai serah terima, lalu pembeli yang mengonfirmasi selesai.',409);
  db.prepare("UPDATE listings SET status='SOLD' WHERE id=?").run(item.id);
  if(order)db.prepare("UPDATE market_orders SET status='SOLD',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  const fee=Math.min(Math.round(item.agreed_price*.03),20000);
  db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,mode) VALUES(?,'MARKET',?,?,0,?)").run(uuid(),item.id,fee,paymentMode()==='DISABLED'?'LEGACY':paymentMode());
  return {fee};
 });send(res,{message:'Penjualan dicatat selesai. Komisi masih tercatat sebagai kewajiban, belum otomatis diterima platform.',...out});
});
route('POST',/^\/api\/listings\/([\w-]+)\/cancel$/,async(req,res,m)=>{
 const u=requireUser(req),b=await parseJson(req);
 tx(()=>{
  const item=db.prepare('SELECT * FROM listings WHERE id=?').get(m[1]);
  if(!item||(item.seller_id!==u.id&&item.buyer_id!==u.id))throw apiError('Tidak berhak membatalkan.',403);
  if(item.status!=='RESERVED')throw apiError('Hanya reservasi aktif yang bisa dibatalkan.');
  const order=db.prepare("SELECT * FROM market_orders WHERE listing_id=? AND status='RESERVED'").get(item.id);
  if(b.order_id&&b.order_id!==order?.id)throw apiError('Status pesanan sudah berubah. Refresh pesanan terlebih dahulu.',409);
  if(order)cancelMarketPayment(order);
  db.prepare("UPDATE listings SET status='AVAILABLE',buyer_id=NULL,agreed_price=NULL WHERE id=?").run(item.id);
  if(order)db.prepare("UPDATE market_orders SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
 });send(res,{ok:true});
});
function accessibleMarketOrder(req,id,party){
 const u=requireRole(req,['CUSTOMER','DRIVER']),order=db.prepare('SELECT * FROM market_orders WHERE id=?').get(id);
 if(!order||!(party?order[party]===u.id:[order.buyer_id,order.seller_id].includes(u.id)))throw apiError('Pesanan tidak ditemukan.',404);
 return order;
}
route('GET',/^\/api\/market\/orders\/([\w-]+)\/payment$/,async(req,res,m)=>{
 const order=accessibleMarketOrder(req,m[1]);send(res,{payment:marketPaymentFor(order.id)});
});
route('POST',/^\/api\/market\/orders\/([\w-]+)\/payment$/,async(req,res,m)=>{
 const payment=tx(()=>createMarketPayment(accessibleMarketOrder(req,m[1],'buyer_id')));send(res,{payment});
});
route('POST',/^\/api\/market\/orders\/([\w-]+)\/payment\/simulate$/,async(req,res,m)=>{
 const payment=tx(()=>payMarketSimulation(accessibleMarketOrder(req,m[1],'buyer_id')));
 send(res,{payment,message:'Pembayaran simulasi berhasil. Dana ditahan hingga pembeli menyelesaikan transaksi.'});
});
route('POST',/^\/api\/market\/orders\/([\w-]+)\/handover$/,async(req,res,m)=>{
 tx(()=>{
  const order=accessibleMarketOrder(req,m[1],'seller_id'),p=marketPaymentFor(order.id);
  if(order.status!=='RESERVED'||!order.payment_required||p?.status!=='HELD')throw apiError('Pembayaran harus lunas sebelum serah terima.',409);
  db.prepare('UPDATE market_orders SET handover_at=COALESCE(handover_at,CURRENT_TIMESTAMP) WHERE id=?').run(order.id);
 });send(res,{message:'Serah terima dicatat. Menunggu pembeli mengonfirmasi barang diterima.'});
});
route('POST',/^\/api\/market\/orders\/([\w-]+)\/confirm$/,async(req,res,m)=>{
 const payment=tx(()=>releaseMarketPayment(accessibleMarketOrder(req,m[1],'buyer_id')));
 send(res,{payment,message:'Transaksi selesai. Saldo penjual bertambah dan komisi platform tercatat.'});
});
route('GET',/^\/api\/market\/wallet$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']),mode=paymentMode();
 const {available,withdrawn}=sellerBalance(u.id,mode);
 const held=db.prepare("SELECT COALESCE(SUM(p.amount-p.platform_fee),0) amount FROM market_payments p JOIN market_orders o ON o.id=p.order_id WHERE o.seller_id=? AND o.status='RESERVED' AND p.status='HELD' AND p.mode=?").get(u.id,mode).amount;
 send(res,{mode,available,held,withdrawn,payoutEnabled:false,withdrawalSimulationEnabled:mode==='SIMULATION'&&!prod,withdrawalProviders,withdrawals:sellerWithdrawals(u.id,mode)});
});
route('POST',/^\/api\/market\/withdrawals$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);rateLimit('market-withdraw-'+u.id,30,60);
 const body=await parseJson(req);
 const withdrawal=tx(()=>{
  requireRole(req,['CUSTOMER','DRIVER']);
  return withdrawMarketSimulation(u.id,body);
 });
 send(res,{withdrawal,...sellerBalance(u.id,'SIMULATION'),message:'Penarikan simulasi berhasil dicatat. Tidak ada transfer uang sungguhan.'});
});
route('POST',/^\/api\/chat\/start$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']),b=await parseJson(req),listing=db.prepare('SELECT * FROM listings WHERE id=?').get(b.listing_id);
 if(!listing)throw apiError('Barang tidak ditemukan.',404);if(listing.seller_id===u.id)throw apiError('Tidak dapat chat diri sendiri.');
 let conv=db.prepare('SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?').get(listing.id,u.id);
 if(!conv){const id=uuid();db.prepare('INSERT INTO conversations(id,listing_id,buyer_id,seller_id) VALUES(?,?,?,?)').run(id,listing.id,u.id,listing.seller_id);conv={id};}
 send(res,{conversation_id:conv.id});
});
route('GET',/^\/api\/chat$/,async(req,res)=>{
 const u=requireUser(req);
 send(res,{conversations:db.prepare(`SELECT c.id,c.listing_id,c.buyer_id,c.seller_id,l.title,l.image_path,
 (SELECT username FROM users WHERE id=CASE WHEN c.buyer_id=? THEN c.seller_id ELSE c.buyer_id END) partner,
 (SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) last_message
 FROM conversations c JOIN listings l ON l.id=c.listing_id WHERE c.buyer_id=? OR c.seller_id=? ORDER BY c.created_at DESC`).all(u.id,u.id,u.id).map(c=>({...c,partner_profile:identityFor(c.buyer_id===u.id?c.seller_id:c.buyer_id)}))});
});
route('GET',/^\/api\/chat\/([\w-]+)\/messages$/,async(req,res,m)=>{
 const u=requireUser(req),conv=db.prepare('SELECT * FROM conversations WHERE id=?').get(m[1]);
 if(!conv||(conv.buyer_id!==u.id&&conv.seller_id!==u.id))throw apiError('Chat tidak ditemukan.',404);
 send(res,{messages:db.prepare('SELECT m.*,u.username sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE conversation_id=? ORDER BY m.created_at,id LIMIT 200').all(conv.id),conversation:conv,partner_profile:identityFor(conv.buyer_id===u.id?conv.seller_id:conv.buyer_id)});
});
route('POST',/^\/api\/chat\/([\w-]+)\/messages$/,async(req,res,m)=>{
 const u=requireUser(req),conv=db.prepare('SELECT * FROM conversations WHERE id=?').get(m[1]);
 if(!conv||(conv.buyer_id!==u.id&&conv.seller_id!==u.id))throw apiError('Chat tidak ditemukan.',404);
 rateLimit('chat-'+u.id,90,10);const b=await parseJson(req),body=limited(b.body,1,1000,'Pesan');
 const offer=b.offer_amount?amount(b.offer_amount,1000,100000000):null;
 db.prepare('INSERT INTO messages(id,conversation_id,sender_id,body,offer_amount) VALUES(?,?,?,?,?)').run(uuid(),conv.id,u.id,body,offer);
 send(res,{ok:true});
});
function chatOrder(req,id){
 const u=requireUser(req);
 const order=db.prepare(`SELECT o.id,o.status,o.customer_id,o.driver_id,cu.username customer_name,du.username driver_name
 FROM service_orders o JOIN users cu ON cu.id=o.customer_id LEFT JOIN users du ON du.id=o.driver_id WHERE o.id=?`).get(id);
 if(!order||!order.driver_id||![order.customer_id,order.driver_id].includes(u.id))throw apiError('Chat pesanan tidak ditemukan.',404);
 return {u,order:{...order,customer_profile:identityFor(order.customer_id),driver_profile:identityFor(order.driver_id)}};
}
route('GET',/^\/api\/orders\/([\w-]+)\/messages$/,async(req,res,m)=>{
 const {u,order}=chatOrder(req,m[1]);
 const after=Number(new URL(req.url,'http://localhost').searchParams.get('after')||0);
 if(!Number.isSafeInteger(after)||after<0)throw apiError('Posisi pesan tidak valid.');
 const messages=orderChatMessages(order.id,after);
 send(res,{order,messages,media_usage:orderMediaUsage(order.id),has_more:messages.length===200,receipts:orderChatReceipts(order.id,u.id)});
});
route('POST',/^\/api\/orders\/([\w-]+)\/messages$/,async(req,res,m)=>{
 chatOrder(req,m[1]);const b=await parseJson(req),{u,order}=chatOrder(req,m[1]);
 rateLimit('order-chat-'+u.id,60,60);send(res,sendOrderChatMessage(order.id,u.id,b));
});
route('GET',/^\/api\/account\/order-chat\/inbox$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);const messages=pendingOrderChatInbox(u.id);
 send(res,{messages,has_more:messages.length===100});
});
route('POST',/^\/api\/account\/order-chat\/delivered$/,async(req,res)=>{
 requireRole(req,['CUSTOMER','DRIVER']);const b=await parseJson(req),u=requireRole(req,['CUSTOMER','DRIVER']);
 send(res,acknowledgeOrderChat(u.id,b?.message_ids));
});
route('POST',/^\/api\/orders\/([\w-]+)\/messages\/read$/,async(req,res,m)=>{
 chatOrder(req,m[1]);const b=await parseJson(req),{u,order}=chatOrder(req,m[1]);
 send(res,acknowledgeOrderChat(u.id,b?.message_ids,{read:true,orderId:order.id}));
});
route('GET',/^\/api\/orders\/([\w-]+)\/media\/([\w.-]+)$/,async(req,res,m)=>{
 const {order}=chatOrder(req,m[1]);const {body,type}=loadOrderChatMedia(order.id,m[2]);
 const headers={'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Accept-Ranges':'bytes','Content-Disposition':'inline'};
 if(req.headers.range){
  const match=String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
  let start=0,end=body.length-1;
  if(match&&(match[1]||match[2])){
   if(!match[1])start=Math.max(0,body.length-Number(match[2]));
   else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
  }else start=NaN;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=body.length){res.writeHead(416,{...headers,'Content-Range':'bytes */'+body.length});res.end();return;}
  res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${body.length}`});res.end(body.subarray(start,end+1));return;
 }
 res.writeHead(200,{...headers,'Content-Length':body.length});res.end(body);
});
function orderView(u){return db.prepare(`SELECT o.*,cu.username customer_name,du.username driver_name FROM service_orders o
  JOIN users cu ON cu.id=o.customer_id LEFT JOIN users du ON du.id=o.driver_id
  WHERE o.customer_id=? OR o.driver_id=? ORDER BY o.created_at DESC LIMIT 80`).all(u.id,u.id);}
route('GET',/^\/api\/orders\/mine$/,async(req,res)=>send(res,{orders:orderView(requireUser(req)).map(o=>({...o,payment:paymentFor(o.id),customer_profile:identityFor(o.customer_id),driver_profile:identityFor(o.driver_id)}))}));
route('POST',/^\/api\/orders$/,async(req,res)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);rateLimit('order-'+u.id,24,60);
 const b=await parseJson(req),type=String(b.type||'');if(!['RIDE','DELIVERY','JASTIP'].includes(type))throw apiError('Jenis layanan tidak tersedia.');
 const vehicleType=type==='RIDE'?String(b.vehicle_type||'MOTOR'):'MOTOR';
 if(!['MOTOR','MOBIL'].includes(vehicleType))throw apiError('Pilih kendaraan Motor atau Mobil.');
 const pickup=limited(b.pickup,5,240,'Lokasi jemput'),destination=limited(b.destination,5,240,'Tujuan'),fare=amount(b.fare,1000,5000000),notes=String(b.notes||'').slice(0,1000);
 if(type==='DELIVERY'&&(!b.item_name||!b.item_category||!b.item_weight||!b.image))throw apiError('Anterin barang wajib menyertakan nama, tipe, berat, dan foto.');
 if(type==='JASTIP'&&!b.item_name)throw apiError('Tuliskan barang yang ingin dititip.');
 const image=type==='DELIVERY'?saveImage(b.image):null;const id=uuid();
 const validCoordinate=(n,min,max)=>n===null||n===undefined||n===''?null:(Number.isFinite(+n)&&+n>=min&&+n<=max?+n:null);
 let result=tx(()=>{
  const voucher=b.voucher_id?db.prepare("SELECT * FROM vouchers WHERE id=? AND user_id=? AND redeemed_order_id IS NULL AND expires_at>?").get(b.voucher_id,u.id,new Date().toISOString()):null;
  if(b.voucher_id&&!voucher)throw apiError('Voucher tidak berlaku.');
  const promo=Math.min(fare,voucher?.amount||0),fee=Math.round(fare*.06);
  db.prepare(`INSERT INTO service_orders(id,customer_id,type,vehicle_type,pickup,destination,pickup_lat,pickup_lng,destination_lat,destination_lng,
  item_name,item_category,item_weight,image_path,place_id,place_name,notes,fare,platform_fee,promo_discount,voucher_id)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,u.id,type,vehicleType,pickup,destination,validCoordinate(b.pickup_lat,-90,90),validCoordinate(b.pickup_lng,-180,180),validCoordinate(b.destination_lat,-90,90),validCoordinate(b.destination_lng,-180,180),b.item_name||null,b.item_category||null,b.item_weight?Number(b.item_weight):null,image,b.place_id||null,b.place_name||null,notes,fare,fee,promo,voucher?.id||null);
  db.prepare('UPDATE service_orders SET payment_required=1 WHERE id=?').run(id);
  if(voucher)db.prepare('UPDATE vouchers SET redeemed_order_id=? WHERE id=? AND redeemed_order_id IS NULL').run(id,voucher.id);
  return {id,platform_fee:fee,promo_discount:promo,payable:fare-promo};
 });
 for(const s of subscribers){const driver=db.prepare('SELECT ready,driver_status FROM users WHERE id=?').get(s.userId);
  if(driver?.ready&&driver.driver_status==='APPROVED')s.res.write(`event: new-order\ndata: ${JSON.stringify({id,type,pickup,destination,fare})}\n\n`);
 }
 send(res,{order:result,message:'Order dibuat. Menunggu driver Ready yang mengambil pesanan.'});
});
route('POST',/^\/api\/orders\/([\w-]+)\/cancel$/,async(req,res,m)=>{
 const u=requireUser(req);
 const changed=tx(()=>{
  const o=db.prepare('SELECT * FROM service_orders WHERE id=?').get(m[1]);
  if(!o||o.customer_id!==u.id)throw apiError('Pesanan tidak ditemukan.',404);
  const c=db.prepare("UPDATE service_orders SET status='CANCELLED' WHERE id=? AND status='OPEN'").run(o.id);
  if(!c.changes)throw apiError('Pesanan yang sudah diambil tidak dapat dibatalkan otomatis. Hubungi pengelola.',409);
  if(o.voucher_id)db.prepare('UPDATE vouchers SET redeemed_order_id=NULL WHERE id=? AND redeemed_order_id=?').run(o.voucher_id,o.id);
  return c.changes;
 });send(res,{ok:!!changed});
});
route('GET',/^\/api\/driver\/jobs$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']);if(u.driver_status!=='APPROVED'||!u.ready)return send(res,{orders:[],message:'Aktifkan Ready setelah verifikasi pengelola.'});
 send(res,{orders:db.prepare("SELECT id,customer_id,type,vehicle_type,pickup,destination,pickup_lat,pickup_lng,fare,platform_fee,notes,created_at,item_name,item_category,item_weight,image_path,place_name FROM service_orders WHERE status='OPEN' AND customer_id<>? ORDER BY created_at ASC").all(u.id).map(o=>({...o,customer_profile:identityFor(o.customer_id)}))});
});
route('POST',/^\/api\/driver\/ready$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']),b=await parseJson(req);
 if(u.driver_status!=='APPROVED')throw apiError('Menunggu verifikasi KTM dan kendaraan oleh pengelola.',403);
 const ready=b.ready===true?1:0;db.prepare('UPDATE users SET ready=? WHERE id=?').run(ready,u.id);send(res,{ready:!!ready});
});
route('POST',/^\/api\/orders\/([\w-]+)\/claim$/,async(req,res,m)=>{
 const u=requireRole(req,['DRIVER']);
 const changed=tx(()=>db.prepare(`UPDATE service_orders SET status='CLAIMED',driver_id=?
   WHERE id=? AND status='OPEN' AND customer_id<>? AND EXISTS
   (SELECT 1 FROM users WHERE id=? AND ready=1 AND driver_status='APPROVED')`).run(u.id,m[1],u.id,u.id).changes);
 if(changed!==1)throw apiError('Order sudah diambil driver lain atau kamu sedang Not Ready.',409);
 send(res,{ok:true,message:'Order berhasil kamu ambil!'});
});
route('POST',/^\/api\/orders\/([\w-]+)\/complete$/,async(req,res,m)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);
 const info=tx(()=>{
  const o=db.prepare('SELECT * FROM service_orders WHERE id=? AND customer_id=?').get(m[1],u.id);
  if(!o||o.status!=='CLAIMED')throw apiError('Hanya customer pemesan yang dapat mengonfirmasi pesanan aktif.',409);
  if(o.payment_required&&!o.delivery_reported_at)throw apiError('Tunggu penganjem menandai pengantaran selesai.',409);
  if(o.payment_required)releasePayment(o);
  db.prepare("UPDATE service_orders SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
  if(!o.payment_required||paymentFor(o.id)?.mode==='MIDTRANS_LIVE')db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,mode) VALUES(?,'SERVICE',?,?,?,?)").run(uuid(),o.id,o.platform_fee,o.promo_discount,paymentFor(o.id)?.mode||'LEGACY');
  // Voucher inviter dikreditkan hanya sekali, pada perjalanan pertama valid yang selesai.
  if(o.type==='RIDE'){
   const customer=db.prepare('SELECT referred_by FROM users WHERE id=?').get(o.customer_id);
   if(customer?.referred_by && !db.prepare('SELECT referred_user_id FROM referral_awards WHERE referred_user_id=?').get(o.customer_id)){
    db.prepare('INSERT INTO referral_awards(referred_user_id,inviter_id,order_id) VALUES(?,?,?)').run(o.customer_id,customer.referred_by,o.id);
    db.prepare('INSERT INTO vouchers(id,user_id,amount,reason,expires_at) VALUES(?,?,?,?,?)').run(uuid(),customer.referred_by,300,'Bonus mengajak teman',dateAfter(7));
   }
  }
  return {fee:o.platform_fee,promo:o.promo_discount};
 });notifyPayment(m[1],'Customer mengonfirmasi selesai. Pendapatan masuk ke saldo tersedia.');send(res,{ok:true,...info,message:'Pesanan selesai. '+(db.prepare('SELECT payment_required FROM service_orders WHERE id=?').get(m[1]).payment_required?'Pendapatan masuk ke saldo tersedia penganjem.':'Komisi pesanan lama dicatat; tidak ada saldo QRIS yang dilepas.')});
});

function notifyPayment(orderId,message){
 const o=db.prepare('SELECT driver_id FROM service_orders WHERE id=?').get(orderId);
 for(const item of subscribers)if(item.userId===o?.driver_id)item.res.write('event: payment-update\ndata: '+JSON.stringify({order_id:orderId,message})+'\n\n');
}
function accessiblePaymentOrder(req,id,customerOnly=false){
 const u=requireUser(req),o=db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
 if(!o||(customerOnly?o.customer_id!==u.id:![o.customer_id,o.driver_id].includes(u.id)))throw apiError('Pesanan tidak ditemukan.',404);
 if(!o.payment_required)throw apiError('Pesanan lama belum memakai QRIS.',409);
 return {u,o};
}
route('POST',/^\/api\/orders\/([\w-]+)\/payment$/,async(req,res,m)=>{
 const {u,o}=accessiblePaymentOrder(req,m[1],true);rateLimit('payment-'+u.id,20,60);
 if(o.status!=='CLAIMED'||!o.driver_id)throw apiError('Pembayaran tersedia setelah penganjem menerima pesanan.',409);
 send(res,{payment:await createPayment(o)});
});
route('GET',/^\/api\/orders\/([\w-]+)\/payment$/,async(req,res,m)=>{
 const {o}=accessiblePaymentOrder(req,m[1]);send(res,{payment:paymentFor(o.id)});
});
route('POST',/^\/api\/orders\/([\w-]+)\/payment\/refresh$/,async(req,res,m)=>{
 const {u,o}=accessiblePaymentOrder(req,m[1]);rateLimit('payment-refresh-'+u.id,30,60);
 const p=paymentFor(o.id);if(!p)throw apiError('Buat pembayaran dahulu.',409);
 if(await refreshPayment(p))notifyPayment(o.id,'Pembayaran diterima. Dana masih tertahan.');
 send(res,{payment:paymentFor(o.id)});
});
route('POST',/^\/api\/orders\/([\w-]+)\/payment\/simulate$/,async(req,res,m)=>{
 const {o}=accessiblePaymentOrder(req,m[1],true),p=paymentFor(o.id);
 if(process.env.NODE_ENV==='production'||paymentMode()!=='SIMULATION'||p?.mode!=='SIMULATION')throw apiError('Simulasi tidak tersedia.',403);
 await refreshPayment(p);
 tx(()=>{
  if(!['PENDING','HELD','RELEASED'].includes(paymentFor(o.id).status))throw apiError('Pembayaran kedaluwarsa atau belum tersedia.',409);
  settlePayment(p.id);
 });
 notifyPayment(o.id,'Pembayaran simulasi diterima. Dana masih tertahan.');
 send(res,{payment:paymentFor(o.id)});
});
route('POST',/^\/api\/payments\/midtrans\/notification$/,async(req,res)=>{
 const body=await parseJson(req),p=verifyNotification(body);
 if(tx(()=>storeGatewayStatus(p,body)))notifyPayment(p.order_id,'Pembayaran diterima. Dana masih tertahan.');
 send(res,{ok:true});
});
route('POST',/^\/api\/orders\/([\w-]+)\/delivered$/,async(req,res,m)=>{
 const u=requireRole(req,['DRIVER']);
 tx(()=>{
  const o=db.prepare('SELECT * FROM service_orders WHERE id=? AND driver_id=?').get(m[1],u.id);
  if(!o||o.status!=='CLAIMED'||paymentFor(o.id)?.status!=='HELD')throw apiError('Pesanan harus aktif dan sudah dibayar.',409);
  db.prepare('UPDATE service_orders SET delivery_reported_at=COALESCE(delivery_reported_at,CURRENT_TIMESTAMP) WHERE id=?').run(o.id);
 });
 send(res,{message:'Menunggu customer mengonfirmasi selesai. Dana masih tertahan.'});
});
route('GET',/^\/api\/driver\/achievements$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']);send(res,driverAchievements(u.id));
});
route('POST',/^\/api\/driver\/achievements\/([\w-]+)\/claim$/,async(req,res,m)=>{
 requireRole(req,['DRIVER']);await parseJson(req);
 const u=requireRole(req,['DRIVER']),result=claimDriverAchievement(u.id,m[1]);
 send(res,{...result,message:result.alreadyClaimed?'Hadiah ini sudah masuk saldo simulasi.':'Hadiah berhasil masuk saldo simulasi!',achievements:driverAchievements(u.id)});
});
route('GET',/^\/api\/driver\/wallet$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']),mode=paymentMode();
 const rewards=db.prepare('SELECT COALESCE(SUM(amount),0) amount FROM driver_achievement_rewards WHERE driver_id=? AND mode=?').get(u.id,mode).amount;
 const held=db.prepare("SELECT COALESCE(SUM(o.fare-o.platform_fee),0) amount FROM payments p JOIN service_orders o ON o.id=p.order_id WHERE o.driver_id=? AND p.status='HELD' AND p.mode=?").get(u.id,mode).amount;
 const credits=db.prepare(`SELECT order_id,amount,created_at,'ORDER' AS kind,NULL AS title,NULL AS target FROM wallet_credits WHERE driver_id=? AND mode=?
 UNION ALL SELECT NULL,amount,created_at,'REWARD',title,target FROM driver_achievement_rewards WHERE driver_id=? AND mode=?
 ORDER BY created_at DESC LIMIT 80`).all(u.id,mode,u.id,mode);
 send(res,{mode,...driverBalance(u.id,mode),rewards,held,credits,payoutEnabled:false,withdrawalSimulationEnabled:mode==='SIMULATION'&&!prod,withdrawalProviders,withdrawals:driverWithdrawals(u.id,mode)});
});
route('POST',/^\/api\/driver\/withdrawals$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']);rateLimit('driver-withdraw-'+u.id,30,60);
 const body=await parseJson(req,4096);
 const withdrawal=tx(()=>{requireRole(req,['DRIVER']);return withdrawDriverSimulation(u.id,body);});
 send(res,{withdrawal,...driverBalance(u.id,'SIMULATION'),message:'Penarikan simulasi berhasil dicatat. Tidak ada transfer uang sungguhan.'});
});
route('GET',/^\/api\/driver\/stream$/,async(req,res)=>{
 const u=requireRole(req,['DRIVER']);
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
 res.write('event: connected\ndata: {}\n\n');
 const item={userId:u.id,res};subscribers.add(item);
 const keepalive=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},20000);
 req.on('close',()=>{clearInterval(keepalive);subscribers.delete(item);});
});
route('GET',/^\/api\/places$/,async(req,res)=>{
 const u=requireUser(req),url=new URL(req.url,'http://localhost'),query=limited(url.searchParams.get('q'),2,100,'Kata pencarian');
 rateLimit('places-'+u.id,30,60);
 const key=process.env.GOOGLE_PLACES_SERVER_KEY;
 if(!key)return send(res,{places:[],message:'Google Places belum dihubungkan. Isi GOOGLE_PLACES_SERVER_KEY pada .env; lokasi tujuan tetap bisa diisi manual.'});
 const lat=Number(url.searchParams.get('lat'))||-7.058, lng=Number(url.searchParams.get('lng'))||110.441;
 const google=await fetch('https://places.googleapis.com/v1/places:searchText',{
  method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount'},
  body:JSON.stringify({textQuery:query+' Tembalang Semarang',maxResultCount:12,locationBias:{circle:{center:{latitude:lat,longitude:lng},radius:7000}}})
 });
 if(!google.ok)throw apiError('Google Places belum siap. Periksa API key, billing, dan kuota.',502);
 const data=await google.json();const places=(data.places||[]).map(p=>{
  const visits=db.prepare("SELECT COUNT(*) n FROM service_orders WHERE type='JASTIP' AND place_id=? AND status='COMPLETED'").get(p.id)?.n||0;
  const rating=p.rating||0, count=p.userRatingCount||0;
  // Popularitas order disetarakan dengan angka saturasi agar 1 order tidak mendominasi rating publik.
  const score=(rating/5)*0.65+Math.min(Math.log10(count+1)/4,1)*0.2+Math.min(visits/25,1)*0.15;
  return {id:p.id,name:p.displayName?.text||'Tempat',address:p.formattedAddress||'',lat:p.location?.latitude,lng:p.location?.longitude,rating,count,visits,score:+score.toFixed(4)};
 }).sort((a,b)=>b.score-a.score);
 send(res,{places,ranking:'65% rating Google, 20% volume ulasan Google, 15% order jastip ANJEMIN yang selesai. Bukan peringkat resmi Google.'});
});
route('POST',/^\/api\/orders\/([\w-]+)\/reports$/,async(req,res,m)=>{
 const u=requireRole(req,['CUSTOMER','DRIVER']);rateLimit('report-'+u.id,10,60);
 const o=db.prepare('SELECT customer_id,driver_id FROM service_orders WHERE id=?').get(m[1]);
 if(!o||![o.customer_id,o.driver_id].includes(u.id))throw apiError('Pesanan tidak ditemukan.',404);
 const b=await parseJson(req);
 if(!['DANGER','SUSPICIOUS','LOST_ITEM'].includes(b.category))throw apiError('Pilih jenis laporan yang sesuai.');
 const details=limited(b.details,10,2000,'Keterangan');
 db.prepare('INSERT INTO order_reports(id,order_id,reporter_id,category,details) VALUES(?,?,?,?,?)').run(uuid(),m[1],u.id,b.category,details);
 send(res,{message:'Laporan terkirim ke Pengelola.'});
});
route('GET',/^\/api\/admin\/reports$/,async(req,res)=>{
 requireRole(req,['ADMIN']);
 const scope=new URL(req.url,'http://localhost').searchParams.get('scope')||'ALL';
 if(!['ALL','ABOUT_DRIVER','BY_DRIVER'].includes(scope))throw apiError('Filter laporan tidak valid.');
 const reports=db.prepare(`SELECT r.*,u.full_name,u.username,u.phone,u.role,o.pickup,o.destination,
 subject.id AS subject_id,subject.full_name AS subject_name,subject.username AS subject_username,subject.account_status AS subject_status,
 CASE WHEN n.number IS NOT NULL THEN printf('USR-%06d',n.number) END AS subject_code
 FROM order_reports r JOIN users u ON u.id=r.reporter_id JOIN service_orders o ON o.id=r.order_id
 LEFT JOIN users subject ON subject.id=CASE WHEN r.reporter_id=o.customer_id THEN o.driver_id ELSE o.customer_id END
 LEFT JOIN user_numbers n ON n.user_id=subject.id
 WHERE (?='ALL' OR (?='ABOUT_DRIVER' AND subject.role='DRIVER') OR (?='BY_DRIVER' AND u.role='DRIVER'))
 ORDER BY CASE WHEN r.status='OPEN' THEN 0 ELSE 1 END,r.created_at DESC`).all(scope,scope,scope);
 send(res,{reports});
});
route('POST',/^\/api\/admin\/reports\/([\w-]+)\/resolve$/,async(req,res,m)=>{
 requireRole(req,['ADMIN']);
 const result=db.prepare("UPDATE order_reports SET status='RESOLVED' WHERE id=?").run(m[1]);
 if(!result.changes)throw apiError('Laporan tidak ditemukan.',404);
 send(res,{ok:true});
});
route('POST',/^\/api\/admin\/users\/([\w-]+)\/account-status$/,async(req,res,m)=>{
 const admin=requireRole(req,['ADMIN']),b=await parseJson(req);
 if(!['ACTIVE','FROZEN'].includes(b.status))throw apiError('Status akun tidak valid.');
 const reason=limited(b.reason,5,500,'Alasan tindakan');
 const reportId=b.report_id?String(b.report_id):null;
 tx(()=>{
  const target=db.prepare('SELECT id,role,account_status FROM users WHERE id=?').get(m[1]);
  if(!target)throw apiError('Akun tidak ditemukan.',404);
  if(!['CUSTOMER','DRIVER'].includes(target.role))throw apiError('Tindakan ini hanya untuk akun Customer dan Penganjem.',403);
  if(reportId){
   const report=db.prepare('SELECT o.customer_id,o.driver_id FROM order_reports r JOIN service_orders o ON o.id=r.order_id WHERE r.id=?').get(reportId);
   if(!report||![report.customer_id,report.driver_id].includes(target.id))throw apiError('Laporan tidak terkait dengan akun ini.',400);
  }
  if(target.account_status!==b.status){
   db.prepare("UPDATE users SET account_status=?,ready=CASE WHEN ?='FROZEN' THEN 0 ELSE ready END,frozen_at=CASE WHEN ?='FROZEN' THEN CURRENT_TIMESTAMP ELSE NULL END,freeze_reason=CASE WHEN ?='FROZEN' THEN ? ELSE NULL END WHERE id=?")
    .run(b.status,b.status,b.status,b.status,reason,target.id);
   db.prepare('INSERT INTO account_status_history(id,user_id,admin_id,previous_status,new_status,reason,report_id) VALUES(?,?,?,?,?,?,?)')
    .run(uuid(),target.id,admin.id,target.account_status,b.status,reason,reportId);
  }
  if(b.status==='FROZEN')db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
 });
 if(b.status==='FROZEN')for(const subscriber of subscribers){
  if(subscriber.userId===m[1]){
   subscriber.res.end('event: account-frozen\ndata: {}\n\n');
   subscribers.delete(subscriber);
  }
 }
 send(res,{message:b.status==='FROZEN'?'Akun dibekukan. Semua sesi telah dicabut.':'Akun diaktifkan kembali. Pengguna perlu login ulang.'});
});
route('GET',/^\/api\/admin\/users$/,async(req,res)=>{
 requireRole(req,['ADMIN']);
 const users=db.prepare(`SELECT u.id,printf('USR-%06d',n.number) AS user_code,u.full_name,u.username,u.email,u.phone,u.role,u.driver_status,u.ready,u.campus_email,u.vehicle,u.sim_declared,u.sim_type,u.referral_code,u.created_at,u.account_status,u.frozen_at,u.freeze_reason,
 (SELECT COUNT(*) FROM service_orders o WHERE o.customer_id=u.id) AS orders_placed,
 (SELECT COUNT(*) FROM service_orders o WHERE o.driver_id=u.id AND o.status='COMPLETED') AS jobs_completed
 FROM users u JOIN user_numbers n ON n.user_id=u.id WHERE u.role IN ('CUSTOMER','DRIVER') ORDER BY u.created_at DESC,u.id`).all();
 send(res,{users});
});
route('GET',/^\/api\/admin\/profits$/,async(req,res)=>{
 requireRole(req,['ADMIN']);
 const params=new URL(req.url,'http://localhost').searchParams;
 const mode=params.get('mode')||(paymentMode()==='DISABLED'?'MIDTRANS_LIVE':paymentMode());
 send(res,profitStatistics({mode,period:params.get('period')||'30'}));
});
route('GET',/^\/api\/admin\/overview$/,async(req,res)=>{
 requireRole(req,['ADMIN']);
 const stats={users:db.prepare('SELECT COUNT(*) n FROM users').get().n,driversPending:db.prepare("SELECT COUNT(*) n FROM users WHERE role='DRIVER' AND driver_status='PENDING'").get().n,
  openOrders:db.prepare("SELECT COUNT(*) n FROM service_orders WHERE status='OPEN'").get().n,
  completeOrders:db.prepare("SELECT COUNT(*) n FROM service_orders WHERE status='COMPLETED'").get().n,
  soldListings:db.prepare("SELECT COUNT(*) n FROM listings WHERE status='SOLD'").get().n,
  bookedCommission:db.prepare('SELECT COALESCE(SUM(gross_fee),0) n FROM ledger').get().n,
  promoExpense:db.prepare('SELECT COALESCE(SUM(promo_cost),0) n FROM ledger').get().n,
  collectedCommission:db.prepare('SELECT COALESCE(SUM(collected),0) n FROM ledger').get().n};
 const drivers=db.prepare("SELECT id,full_name,username,email,phone,driver_status,ready,ktm_path,campus_email,vehicle,sim_declared,sim_type,sim_path,created_at FROM users WHERE role='DRIVER' ORDER BY created_at DESC LIMIT 100").all();
 const mode=paymentMode(),entries=commissionEntries(mode==='DISABLED'?'LEGACY':mode);
 stats.bookedCommission=entries.reduce((n,f)=>n+f.gross_fee,0);
 stats.promoExpense=entries.reduce((n,f)=>n+f.promo_cost,0);
 stats.collectedCommission=entries.reduce((n,f)=>n+f.collected,0);
 const fees=entries.slice(0,100);
 send(res,{stats,drivers,fees,mode});
});
route('POST',/^\/api\/admin\/drivers\/([\w-]+)\/status$/,async(req,res,m)=>{
 requireRole(req,['ADMIN']);const b=await parseJson(req);
 if(!['APPROVED','REJECTED'].includes(b.status))throw apiError('Status driver tidak valid.');
 const c=db.prepare("UPDATE users SET driver_status=?,ready=0 WHERE id=? AND role='DRIVER'").run(b.status,m[1]);
 if(!c.changes)throw apiError('Driver tidak ditemukan.',404);send(res,{ok:true});
});
route('POST',/^\/api\/admin\/ledger\/([\w-]+)\/collected$/,async(req,res,m)=>{
 requireRole(req,['ADMIN']);const b=await parseJson(req),val=amount(b.amount,1,100000000);
 const row=db.prepare('SELECT gross_fee,collected FROM ledger WHERE id=?').get(m[1]);if(!row)throw apiError('Catatan tidak ditemukan.',404);
 if(row.collected+val>row.gross_fee)throw apiError('Jumlah penerimaan melebihi tagihan bruto.',400);
 db.prepare('UPDATE ledger SET collected=collected+? WHERE id=?').run(val,m[1]);send(res,{ok:true});
});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json'};
async function serve(req,res){
 const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
 if(pathname.startsWith('/api/')){
  const match=routeMatchers.find(r=>r.method===req.method&&r.re.test(pathname));
  if(!match)return json(res,404,{error:'Endpoint tidak tersedia.'});
  if(!['GET','HEAD'].includes(req.method)&&pathname!=='/api/payments/midtrans/notification'){
   const origin=req.headers.origin,expected=new URL(process.env.APP_URL||`http://localhost:${PORT}`).origin;
   if(prod && (!origin||origin!==expected))throw apiError('Origin tidak diizinkan.',403);
   if(!prod && origin && ![`http://localhost:${PORT}`,`http://127.0.0.1:${PORT}`].includes(origin))throw apiError('Origin tidak diizinkan.',403);
  }
  if(!['GET','HEAD'].includes(req.method)&&!pathname.startsWith('/api/auth/')&&pathname!=='/api/account/profile'){
   const account=currentUser(req);if(needsProfile(account))throw Object.assign(apiError('Lengkapi profil terlebih dahulu melalui menu Profil.',409),{code:'PROFILE_INCOMPLETE'});
  }
  await match.fn(req,res,pathname.match(match.re));return;
 }
 if(req.method!=='GET')throw apiError('Method tidak didukung.',405);
 const safe=path.posix.normalize(pathname).replace(/^\/+/,''),file=path.resolve(root,safe||'index.html');
 if(!file.startsWith(root+path.sep))throw apiError('Path tidak diizinkan.',403);
 let target=file;
 if(!fs.existsSync(target)||fs.statSync(target).isDirectory()){
   const asset=path.resolve(root,'public',safe);
   if(asset.startsWith(path.join(root,'public')+path.sep)&&fs.existsSync(asset)&&fs.statSync(asset).isFile())target=asset;
   else target=path.join(root,'index.html');
 }
 const type=mime[path.extname(target)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type,'Cache-Control':!prod||target.endsWith('index.html')?'no-store':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
 fs.createReadStream(target).pipe(res);
}
const server=http.createServer((req,res)=>serve(req,res).catch(err=>{
 console.error('[SERVER ERROR]',err.message);
 if(!res.headersSent)json(res,err.status||500,{error:err.status?err.message:'Kesalahan server. Periksa terminal.',...(err.code==='PROFILE_INCOMPLETE'?{code:err.code}:{})});
 else if(!res.writableEnded)res.end();
}));
server.listen(PORT,()=>console.log(`\n🚀 ANJEMIN running at http://localhost:${PORT}\nRole ADMIN berasal dari .env, bukan dari form signup.\n`));
