import {db} from './db.js';
import {paymentFor,gateway,storeGatewayStatus} from './payments.js';

export const PAYMENT_WAIT_MS=5*60*1000;
const paid=p=>['HELD','RELEASED'].includes(p?.status);
const inFlight=new Map();
export function paymentWait(order,payment,now=Date.now()){
 if(order.status!=='CLAIMED'||!order.payment_required||!order.payment_deadline||paid(payment))return null;
 return {expires_at:order.payment_deadline,remaining_seconds:Math.max(0,Math.ceil((Date.parse(order.payment_deadline)-now)/1000))};
}
function cancelUnpaidOrder(id,now){
 db.exec('BEGIN IMMEDIATE');
 try{
  const o=db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
  const result=db.prepare(`UPDATE service_orders SET status='CANCELLED',cancel_reason='PAYMENT_TIMEOUT'
   WHERE id=? AND status='CLAIMED' AND payment_required=1 AND payment_deadline<=?
   AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND status IN ('HELD','RELEASED'))`)
   .run(id,new Date(now).toISOString(),id);
  if(result.changes){
   db.prepare("UPDATE payments SET status='EXPIRED' WHERE order_id=? AND status IN ('CREATING','PENDING')").run(id);
   if(o.voucher_id)db.prepare('UPDATE vouchers SET redeemed_order_id=NULL WHERE id=? AND redeemed_order_id=?').run(o.voucher_id,id);
  }
  db.exec('COMMIT');return result.changes>0;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
async function reconcile(id,now){
 const order=db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
 if(!order||!paymentWait(order,paymentFor(id),now)||Date.parse(order.payment_deadline)>now)return null;
 const p=paymentFor(id);
 if(p?.mode.startsWith('MIDTRANS')){
  // Never infer nonpayment from an overdue browser timer or a missing webhook.
  let data=await gateway(p.mode,'/v2/'+encodeURIComponent(p.id)+'/status');
  storeGatewayStatus(p,data);
  if(paid(paymentFor(id)))return {id,status:'PAID'};
  if(data.transaction_status==='pending'){
   // Confirm the void with an authenticated status lookup, including uncertain cancel responses.
   await gateway(p.mode,'/v2/'+encodeURIComponent(p.id)+'/cancel',{});
   data=await gateway(p.mode,'/v2/'+encodeURIComponent(p.id)+'/status');
   storeGatewayStatus(p,data);
   if(paid(paymentFor(id)))return {id,status:'PAID'};
  }
  if(!['expire','cancel','deny','failure'].includes(data.transaction_status))return null;
 }else if(p&&p.mode!=='SIMULATION')return null;
 return cancelUnpaidOrder(id,now)?{id,status:'CANCELLED'}:null;
}
export function expireUnpaidOrder(id,now=Date.now()){
 if(inFlight.has(id))return inFlight.get(id);
 const work=reconcile(id,now).finally(()=>inFlight.delete(id));inFlight.set(id,work);return work;
}
export async function expireDuePayments(){
 const rows=db.prepare(`SELECT o.id FROM service_orders o WHERE o.status='CLAIMED' AND o.payment_required=1 AND o.payment_deadline<=?
  AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status IN ('HELD','RELEASED'))
  ORDER BY o.payment_deadline LIMIT 20`).all(new Date().toISOString());
 const results=await Promise.allSettled(rows.map(o=>expireUnpaidOrder(o.id)));
 return results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
}
