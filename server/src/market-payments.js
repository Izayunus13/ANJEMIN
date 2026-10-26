import crypto from 'node:crypto';
import {db} from './db.js';
import {apiError} from './security.js';
import {paymentMode} from './payments.js';

export function requireMarketSimulation(){
 if(paymentMode()!=='SIMULATION'||process.env.NODE_ENV==='production')throw apiError('Pembayaran marketplace lewat website saat ini tersedia dalam mode simulasi. Pembayaran live belum diaktifkan.',503);
}
export function marketPaymentFor(orderId){
 db.prepare("UPDATE market_payments SET status='EXPIRED' WHERE order_id=? AND status='PENDING' AND expires_at<=?").run(orderId,new Date().toISOString());
 return db.prepare('SELECT * FROM market_payments WHERE order_id=?').get(orderId)||null;
}
export function createMarketPayment(order){
 requireMarketSimulation();
 if(order.status!=='RESERVED')throw apiError('Pesanan sudah tidak aktif.',409);
 const existing=marketPaymentFor(order.id);
 if(existing&&existing.status!=='EXPIRED')return existing;
 const expires=new Date(Date.now()+15*60000).toISOString();
 if(existing){
  if(existing.mode!=='SIMULATION')throw apiError('Mode pembayaran pesanan tidak sesuai.',409);
  db.prepare("UPDATE market_payments SET status='PENDING',expires_at=? WHERE id=?").run(expires,existing.id);
 }else db.prepare("INSERT INTO market_payments(id,order_id,mode,amount,platform_fee,status,expires_at) VALUES(?,?,'SIMULATION',?,?,'PENDING',?)")
  .run(crypto.randomUUID(),order.id,order.amount,Math.min(Math.round(order.amount*.03),20000),expires);
 db.prepare('UPDATE market_orders SET payment_required=1 WHERE id=?').run(order.id);
 return marketPaymentFor(order.id);
}
export function payMarketSimulation(order){
 requireMarketSimulation();const p=marketPaymentFor(order.id);
 if(order.status!=='RESERVED'||!p||p.mode!=='SIMULATION')throw apiError('Pembayaran tidak tersedia.',409);
 if(p.status==='HELD')return p;
 if(p.status!=='PENDING')throw apiError('Pembayaran tidak aktif. Buka pembayaran untuk mencoba kembali.',409);
 db.prepare("UPDATE market_payments SET status='HELD',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(p.id);
 return marketPaymentFor(order.id);
}
export function cancelMarketPayment(order){
 const p=marketPaymentFor(order.id);if(!p)return;
 if(p.mode!=='SIMULATION')throw apiError('Pengembalian pembayaran ini perlu ditinjau Pengelola.',409);
 if(order.handover_at||p.status==='RELEASED')throw apiError('Barang sudah diserahkan. Hubungi Pengelola untuk meninjau transaksi.',409);
 if(p.status==='HELD')db.prepare("UPDATE market_payments SET status='REFUNDED',refunded_at=CURRENT_TIMESTAMP WHERE id=?").run(p.id);
 else if(['PENDING','EXPIRED'].includes(p.status))db.prepare("UPDATE market_payments SET status='CANCELLED' WHERE id=?").run(p.id);
}
export function releaseMarketPayment(order){
 requireMarketSimulation();const p=marketPaymentFor(order.id);
 if(order.status==='SOLD'&&p?.status==='RELEASED')return p;
 if(order.status!=='RESERVED'||!order.handover_at||p?.status!=='HELD'||p.mode!=='SIMULATION')throw apiError('Pembayaran harus lunas dan barang sudah diserahkan sebelum transaksi dapat diselesaikan.',409);
 const seller=db.prepare('SELECT account_status FROM users WHERE id=?').get(order.seller_id);
 if(seller?.account_status!=='ACTIVE')throw apiError('Akun penjual sedang ditinjau. Dana tetap ditahan. Hubungi Pengelola.',409);
 const listing=db.prepare('SELECT status,buyer_id FROM listings WHERE id=?').get(order.listing_id);
 if(listing?.status!=='RESERVED'||listing.buyer_id!==order.buyer_id)throw apiError('Reservasi tidak sesuai. Hubungi Pengelola.',409);
 db.prepare('INSERT INTO market_wallet_credits(id,seller_id,order_id,payment_id,amount,mode) VALUES(?,?,?,?,?,?)')
  .run(crypto.randomUUID(),order.seller_id,order.id,p.id,p.amount-p.platform_fee,p.mode);
 db.prepare("UPDATE market_payments SET status='RELEASED',released_at=CURRENT_TIMESTAMP WHERE id=?").run(p.id);
 db.prepare("UPDATE market_orders SET status='SOLD',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
 db.prepare("UPDATE listings SET status='SOLD' WHERE id=?").run(order.listing_id);
 db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,collected,mode) VALUES(?,'MARKET',?,?,0,?,?)")
  .run(crypto.randomUUID(),order.listing_id,p.platform_fee,p.platform_fee,p.mode);
 return marketPaymentFor(order.id);
}
