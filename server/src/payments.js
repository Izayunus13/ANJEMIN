import crypto from 'node:crypto';
import {db} from './db.js';
import {apiError} from './security.js';
export function paymentMode(){
 const mode=process.env.PAYMENT_MODE || (process.env.NODE_ENV==='production'?'DISABLED':'SIMULATION');
 if(!['SIMULATION','MIDTRANS_SANDBOX','MIDTRANS_LIVE','DISABLED'].includes(mode))throw apiError('PAYMENT_MODE tidak valid.',503);
 return process.env.NODE_ENV==='production'&&mode==='SIMULATION'?'DISABLED':mode;
}
export function paymentFor(id){return db.prepare('SELECT * FROM payments WHERE order_id=?').get(id)||null;}
export function settlePayment(id){
 const p=db.prepare('SELECT * FROM payments WHERE id=?').get(id);
 if(!p)throw apiError('Pembayaran tidak ditemukan.',404);
 if(['HELD','RELEASED'].includes(p.status))return false;
 const o=db.prepare('SELECT * FROM service_orders WHERE id=?').get(p.order_id);
 if(o?.status!=='CLAIMED'||!o.driver_id)throw apiError('Pesanan tidak dapat menerima pembayaran.',409);
 db.prepare("UPDATE payments SET status='HELD',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
 return true;
}
export function releasePayment(o){
 const p=paymentFor(o.id);
 if(!p||p.status!=='HELD')throw apiError('Pembayaran belum terverifikasi.',409);
 db.prepare('INSERT INTO wallet_credits(id,driver_id,order_id,payment_id,amount,mode) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),o.driver_id,o.id,p.id,o.fare-o.platform_fee,p.mode);
 db.prepare("UPDATE payments SET status='RELEASED',released_at=CURRENT_TIMESTAMP WHERE id=?").run(p.id);
 return p;
}
export function paymentGatewayBase(mode){return mode==='MIDTRANS_LIVE'?'https://api.midtrans.com':'https://api.sandbox.midtrans.com';}
export async function gateway(mode,endpoint,body){
 if(!process.env.MIDTRANS_SERVER_KEY)throw apiError('Server key Midtrans belum dikonfigurasi.',503);
 let response;
 try{response=await fetch(paymentGatewayBase(mode)+endpoint,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(process.env.MIDTRANS_SERVER_KEY+':').toString('base64'),'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}
 catch{throw apiError('Gateway belum merespons. Gunakan Cek status; jangan bayar dua kali.',502);}
 const data=await response.json();
 if(!response.ok||!['200','201','202'].includes(String(data.status_code)))throw apiError('Transaksi belum tersedia di Midtrans. Hubungi pengelola untuk memeriksa konfigurasi.',502);
 return data;
}
export async function createPayment(o){
 const mode=paymentMode();
 if(mode==='DISABLED')throw apiError('Pembayaran QRIS belum diaktifkan.',503);
 if(mode.startsWith('MIDTRANS')&&!process.env.MIDTRANS_SERVER_KEY)throw apiError('Server key Midtrans belum dikonfigurasi.',503);
 const existing=paymentFor(o.id);if(existing)return existing;
 const id=crypto.randomUUID();
 db.prepare("INSERT INTO payments(id,order_id,mode,amount,status,expires_at) VALUES(?,?,?,?,?,?)").run(id,o.id,mode,o.fare-o.promo_discount,mode==='SIMULATION'?'PENDING':'CREATING',new Date(Date.now()+15*60000).toISOString());
 const p=paymentFor(o.id);
 if(p.amount===0){settlePayment(id);return paymentFor(o.id);}
 if(mode==='SIMULATION')return p;
 // Reserve once before network IO. Reconcile uncertain results; never retry a charge.
 storeGatewayStatus(p,await gateway(mode,'/v2/charge',{payment_type:'qris',transaction_details:{order_id:id,gross_amount:p.amount},custom_expiry:{expiry_duration:15,unit:'minute'}}));
 return paymentFor(o.id);
}
export function storeGatewayStatus(p,data){
 if(data.order_id!==p.id||Number(data.gross_amount)!==p.amount||data.payment_type!=='qris'||data.currency!=='IDR')throw apiError('Rincian pembayaran tidak sesuai.',409);
 if(['HELD','RELEASED'].includes(paymentFor(p.order_id).status))return false;
 let qr=data.actions?.find(a=>a.name==='generate-qr-code')?.url;
 if(!qr&&data.transaction_id)qr=paymentGatewayBase(p.mode)+'/v2/qris/'+encodeURIComponent(data.transaction_id)+'/qr-code';
 if(qr&&new URL(qr).origin!==paymentGatewayBase(p.mode))throw apiError('Alamat QR tidak valid.',502);
 const status=data.transaction_status;
 if(status==='settlement'&&(!data.fraud_status||data.fraud_status==='accept'))return settlePayment(p.id);
 const next=status==='expire'?'EXPIRED':['deny','cancel','failure'].includes(status)?'FAILED':'PENDING';
 db.prepare('UPDATE payments SET status=?,qr_url=COALESCE(?,qr_url) WHERE id=?').run(next,qr||null,p.id);
 return false;
}
export async function refreshPayment(p){
 if(p.mode==='SIMULATION'){
  if(p.status==='PENDING'&&Date.parse(p.expires_at)<=Date.now())db.prepare("UPDATE payments SET status='EXPIRED' WHERE id=? AND status='PENDING'").run(p.id);
  return false;
 }
 if(['HELD','RELEASED','EXPIRED','FAILED'].includes(p.status))return false;
 return storeGatewayStatus(p,await gateway(p.mode,'/v2/'+encodeURIComponent(p.id)+'/status'));
}
export function verifyNotification(body){
 const p=db.prepare('SELECT * FROM payments WHERE id=?').get(String(body.order_id||''));
 if(!p||!p.mode.startsWith('MIDTRANS')||!process.env.MIDTRANS_SERVER_KEY)throw apiError('Notifikasi tidak valid.',403);
 verifyGatewaySignature(body);
 return p;
}
export function verifyGatewaySignature(body){
 if(!process.env.MIDTRANS_SERVER_KEY)throw apiError('Notifikasi tidak valid.',403);
 const expected=crypto.createHash('sha512').update(String(body.order_id)+String(body.status_code)+String(body.gross_amount)+process.env.MIDTRANS_SERVER_KEY).digest('hex'),supplied=String(body.signature_key||'');
 if(!/^[a-f0-9]{128}$/i.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied.toLowerCase()),Buffer.from(expected)))throw apiError('Tanda tangan pembayaran tidak valid.',403);
}
