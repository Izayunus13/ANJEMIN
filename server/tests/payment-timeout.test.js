import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('five-minute payment deadline cancels unpaid orders, returns vouchers and preserves verified or uncertain gateway payments',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-payment-timeout-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.ANJEMIN_UPLOAD_DIR=path.join(folder,'uploads');
 process.env.NODE_ENV='development';process.env.PAYMENT_MODE='SIMULATION';process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';
 const {db}=await import('../src/db.js'),{handleRequest}=await import('../src/index.js');
 const {expireUnpaidOrder,expireDuePayments}=await import('../src/payment-timeout.js');
 const server=http.createServer(handleRequest);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;process.env.APP_URL=base;
 const realFetch=globalThis.fetch,invoices=new Map();let failStatus=false,racePaid=false,chargeCount=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.sandbox.midtrans.com')){
   if(String(url).endsWith('/charge')){
    chargeCount++;const b=JSON.parse(options.body),id=b.transaction_details.order_id;
    assert.equal(b.custom_expiry.unit,'second');assert.ok(b.custom_expiry.expiry_duration>0&&b.custom_expiry.expiry_duration<=300);
    invoices.set(id,{order_id:id,gross_amount:String(b.transaction_details.gross_amount),payment_type:'qris',currency:'IDR',transaction_status:'pending',status_code:'201'});
    return Response.json(invoices.get(id));
   }
   const id=String(url).split('/').at(-2);
   if(String(url).endsWith('/cancel')){
    invoices.get(id).transaction_status=racePaid?'settlement':'cancel';return Response.json({order_id:id,status_code:'200',transaction_status:invoices.get(id).transaction_status});
   }
   if(failStatus)throw Error('Gateway unavailable');
   return Response.json(invoices.get(id));
  }
  return realFetch(url,options);
 };
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
 async function call(who,url,data){
  const response=await realFetch(base+url,{method:data===undefined?'GET':'POST',headers:{Cookie:'anjemin_session='+who,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,data:await response.json()};
 }
 const row=id=>db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
 const invoice=id=>db.prepare('SELECT * FROM payments WHERE order_id=?').get(id);
 const overdue=id=>db.prepare("UPDATE service_orders SET payment_deadline='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
 async function create(type='RIDE',voucher=false){
  const r=await call('customer','/api/orders',{type,pickup:'Gerbang kampus',destination:'Kos Melati',fare:10000,item_name:'Buku kuliah',item_category:'Buku',item_weight:1,image,...(voucher?{voucher_id:'voucher'}:{})});
  assert.equal(r.status,200,JSON.stringify(r.data));const id=r.data.order.id;
  const before=Date.now();assert.equal((await call('driver','/api/orders/'+id+'/claim',{})).status,200);
  assert.ok(Date.parse(row(id).payment_deadline)>=before+300000&&Date.parse(row(id).payment_deadline)<=Date.now()+300000);
  return id;
 }
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,'unused',?,'APPROVED',1,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  db.prepare("INSERT INTO vouchers(id,user_id,amount,reason,expires_at) VALUES('voucher','customer',500,'Test','2030-01-01T00:00:00Z')").run();
  for(const type of ['RIDE','JASTIP','DELIVERY']){
   const id=await create(type,true);
   const current=(await call('driver','/api/orders/mine')).data.orders.find(o=>o.id===id);
   assert.ok(current.payment_wait.remaining_seconds>=298);assert.equal(current.status,'CLAIMED');
   overdue(id);
   const orders=(await call('customer','/api/orders/mine')).data.orders,order=orders.find(o=>o.id===id);
   assert.equal(order.status,'CANCELLED');assert.equal(order.cancel_reason,'PAYMENT_TIMEOUT');assert.equal(order.payment_wait,null);
   assert.equal(db.prepare("SELECT redeemed_order_id FROM vouchers WHERE id='voucher'").get().redeemed_order_id,null);
   assert.equal((await call('customer','/api/orders/'+id+'/payment',{})).status,409);
   assert.equal(await expireUnpaidOrder(id),null);assert.equal(row(id).status,'CANCELLED');
  }
  const unpaid=await create();
  db.prepare('UPDATE service_orders SET payment_deadline=? WHERE id=?').run(new Date(Date.now()+60000).toISOString(),unpaid);
  const createdInvoice=await call('customer','/api/orders/'+unpaid+'/payment',{});
  assert.equal(createdInvoice.status,200);assert.equal(createdInvoice.data.payment.expires_at,row(unpaid).payment_deadline,'Invoice creation must not reset the claim deadline');
  overdue(unpaid);await expireDuePayments();
  assert.equal(row(unpaid).status,'CANCELLED');assert.equal(invoice(unpaid).status,'EXPIRED');
  assert.equal((await call('customer','/api/orders/'+unpaid+'/payment/simulate',{})).status,409);
  const paid=await create();
  await call('customer','/api/orders/'+paid+'/payment',{});await call('customer','/api/orders/'+paid+'/payment/simulate',{});
  overdue(paid);await expireDuePayments();assert.equal(row(paid).status,'CLAIMED');assert.equal(invoice(paid).status,'HELD');
  assert.equal((await call('driver','/api/orders/mine')).data.orders.find(o=>o.id===paid).payment_wait,null);

  process.env.PAYMENT_MODE='MIDTRANS_SANDBOX';process.env.MIDTRANS_SERVER_KEY='unit-test-key';
  const gatewayUnpaid=await create();await call('customer','/api/orders/'+gatewayUnpaid+'/payment',{});
  overdue(gatewayUnpaid);assert.equal((await expireUnpaidOrder(gatewayUnpaid)).status,'CANCELLED');assert.equal(row(gatewayUnpaid).status,'CANCELLED');
  assert.equal(invoices.get(invoice(gatewayUnpaid).id).transaction_status,'cancel');

  const gatewayPaid=await create();await call('customer','/api/orders/'+gatewayPaid+'/payment',{});
  invoices.get(invoice(gatewayPaid).id).transaction_status='settlement';
  overdue(gatewayPaid);assert.equal((await expireUnpaidOrder(gatewayPaid)).status,'PAID');assert.equal(row(gatewayPaid).status,'CLAIMED');assert.equal(invoice(gatewayPaid).status,'HELD');

  const race=await create();await call('customer','/api/orders/'+race+'/payment',{});overdue(race);racePaid=true;
  assert.equal((await expireUnpaidOrder(race)).status,'PAID');assert.equal(row(race).status,'CLAIMED');racePaid=false;

  const uncertain=await create();await call('customer','/api/orders/'+uncertain+'/payment',{});overdue(uncertain);failStatus=true;
  await assert.rejects(()=>expireUnpaidOrder(uncertain),/Gateway/);assert.equal(row(uncertain).status,'CLAIMED');assert.equal(invoice(uncertain).status,'PENDING');
  const waiting=(await call('driver','/api/orders/mine')).data.orders.find(o=>o.id===uncertain);
  assert.equal(waiting.status,'CLAIMED');assert.equal(waiting.payment_wait.remaining_seconds,0);
  failStatus=false;await expireUnpaidOrder(uncertain);assert.equal(row(uncertain).status,'CANCELLED');
  assert.equal(chargeCount,4);assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_credits').get().n,0);
 }finally{
  globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
  rmSync(folder,{recursive:true,force:true});
  for(const key of ['ANJEMIN_DATA_DIR','ANJEMIN_UPLOAD_DIR','NODE_ENV','PAYMENT_MODE','MIDTRANS_SERVER_KEY'])delete process.env[key];
 }
});
