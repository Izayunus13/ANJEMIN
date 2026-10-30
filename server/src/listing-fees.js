import crypto from 'node:crypto';
import {db} from './db.js';
import {apiError} from './security.js';
import {paymentMode,gateway,paymentGatewayBase} from './payments.js';

export const LISTING_FEE=3000;
export const publishedListingSQL="(l.publication_required=0 OR EXISTS(SELECT 1 FROM listing_fee_payments fp WHERE fp.listing_id=l.id AND fp.status='PAID'))";
export function listingFeeFor(listingId){return db.prepare('SELECT * FROM listing_fee_payments WHERE listing_id=?').get(listingId)||null;}
export function isListingPublished(item){return !!item&&(!item.publication_required||listingFeeFor(item.id)?.status==='PAID');}
export function requireListingPayments(){
 const mode=paymentMode();
 if(mode==='DISABLED')throw apiError('Pembayaran biaya pasang lapak belum diaktifkan.',503);
 if(mode.startsWith('MIDTRANS')&&!process.env.MIDTRANS_SERVER_KEY)throw apiError('QRIS belum dikonfigurasi. Hubungi Pengelola.',503);
 return mode;
}
export async function createListingFee(item){
 const existing=listingFeeFor(item.id);if(existing)return existing;
 const mode=requireListingPayments(),id=crypto.randomUUID();
 // Reserve one invoice before contacting the gateway. An uncertain request must be reconciled, never charged twice.
 db.prepare("INSERT INTO listing_fee_payments(id,listing_id,mode,amount,status,expires_at) VALUES(?,?,?,?,?,?)")
  .run(id,item.id,mode,LISTING_FEE,mode==='SIMULATION'?'PENDING':'CREATING',new Date(Date.now()+15*60000).toISOString());
 if(mode!=='SIMULATION')storeListingGatewayStatus(listingFeeFor(item.id),await gateway(mode,'/v2/charge',{
  payment_type:'qris',transaction_details:{order_id:id,gross_amount:LISTING_FEE},
  item_details:[{id:'marketplace-upload',price:LISTING_FEE,quantity:1,name:'Biaya pasang lapak ANJEMIN'}],
  custom_expiry:{expiry_duration:15,unit:'minute'}
 }));
 return listingFeeFor(item.id);
}
export function settleListingFee(payment){
 db.exec('BEGIN IMMEDIATE');
 try{
  const p=listingFeeFor(payment.listing_id);
  if(p?.status==='PAID'){db.exec('COMMIT');return false;}
  if(!p||p.id!==payment.id||p.amount!==LISTING_FEE)throw apiError('Invoice pasang lapak tidak sesuai.',409);
  db.prepare("UPDATE listing_fee_payments SET status='PAID',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(p.id);
  db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,collected,mode) VALUES(?,'MARKET_UPLOAD',?,?,0,?,?)")
   .run(crypto.randomUUID(),p.listing_id,LISTING_FEE,LISTING_FEE,p.mode);
  db.exec('COMMIT');return true;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function storeListingGatewayStatus(p,data){
 if(!p.mode.startsWith('MIDTRANS')||data.order_id!==p.id||Number(data.gross_amount)!==LISTING_FEE||data.currency!=='IDR'||data.payment_type!=='qris')
  throw apiError('Rincian pembayaran pasang lapak tidak sesuai.',409);
 if(listingFeeFor(p.listing_id)?.status==='PAID')return false;
 if(data.transaction_status==='settlement'&&(!data.fraud_status||data.fraud_status==='accept'))return settleListingFee(p);
 let qr=data.actions?.find(a=>a.name==='generate-qr-code')?.url;
 if(!qr&&data.transaction_id)qr=paymentGatewayBase(p.mode)+'/v2/qris/'+encodeURIComponent(data.transaction_id)+'/qr-code';
 if(qr){const url=new URL(qr);if(url.origin!==paymentGatewayBase(p.mode)||url.username||url.password)throw apiError('Alamat QRIS tidak valid.',502);}
 const status=data.transaction_status;
 const next=status==='expire'?'EXPIRED':['deny','cancel','failure'].includes(status)?'FAILED':'PENDING';
 // Old pending notifications must not revive a terminal invoice.
 db.prepare("UPDATE listing_fee_payments SET status=?,qr_url=COALESCE(?,qr_url) WHERE id=? AND status IN ('CREATING','PENDING')")
  .run(next,qr||null,p.id);
 return false;
}
export async function refreshListingFee(p){
 if(!p||p.status==='PAID')return false;
 if(p.mode==='SIMULATION'){
  if(p.status==='PENDING'&&Date.parse(p.expires_at)<=Date.now())db.prepare("UPDATE listing_fee_payments SET status='EXPIRED' WHERE id=? AND status='PENDING'").run(p.id);
  return false;
 }
 return storeListingGatewayStatus(p,await gateway(p.mode,'/v2/'+encodeURIComponent(p.id)+'/status'));
}
export async function simulateListingFee(p){
 if(paymentMode()!=='SIMULATION'||process.env.NODE_ENV==='production'||p?.mode!=='SIMULATION')throw apiError('Simulasi pembayaran tidak tersedia.',403);
 await refreshListingFee(p);
 const current=listingFeeFor(p.listing_id);
 if(current.status==='PAID')return;
 if(current.status!=='PENDING')throw apiError('Invoice sudah kedaluwarsa atau tidak aktif. Hubungi Pengelola.',409);
 settleListingFee(current);
}
