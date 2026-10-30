import {db} from './db.js';
import {apiError} from './security.js';

export const ORDER_SEARCH_MS=3*60*1000;
export function searchWindow(order,now=Date.now()){
 if(order.status!=='OPEN'||!order.search_expires_at)return null;
 const expires=Date.parse(order.search_expires_at);if(!Number.isFinite(expires))return null;
 return {expires_at:order.search_expires_at,attempt:order.search_attempt,remaining_seconds:Math.max(0,Math.ceil((expires-now)/1000)),timed_out:expires<=now};
}
// Caller owns the transaction, keeping retries atomic with driver claims and cancellation.
export function retryOrderSearch(userId,id,attempt,now=Date.now()){
 const order=db.prepare('SELECT * FROM service_orders WHERE id=? AND customer_id=?').get(id,userId);
 if(!order)throw apiError('Pesanan tidak ditemukan.',404);
 if(!Number.isSafeInteger(attempt)||attempt<1)throw apiError('Putaran pencarian tidak valid.',400);
 if(order.status!=='OPEN'||order.driver_id)throw apiError('Pesanan sudah diterima atau tidak aktif. Perbarui pesananmu.',409);
 if(attempt<order.search_attempt)return {order,renewed:false};
 if(attempt!==order.search_attempt||!order.search_expires_at||Date.parse(order.search_expires_at)>now)throw apiError('Tunggu countdown pencarian berakhir sebelum Order Ulang.',409);
 const expires=new Date(now+ORDER_SEARCH_MS).toISOString();
 const changed=db.prepare("UPDATE service_orders SET search_expires_at=?,search_attempt=search_attempt+1 WHERE id=? AND customer_id=? AND status='OPEN' AND driver_id IS NULL AND search_attempt=? AND search_expires_at<=?")
  .run(expires,id,userId,attempt,new Date(now).toISOString());
 if(changed.changes!==1)throw apiError('Status pesanan berubah. Perbarui pesananmu.',409);
 return {order:db.prepare('SELECT * FROM service_orders WHERE id=?').get(id),renewed:true};
}
