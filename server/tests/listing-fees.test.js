import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('Rp3,000 upload fee gates publication, protects invoices, reconciles QRIS and leaves goods payments offline',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-listing-fee-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.ANJEMIN_UPLOAD_DIR=path.join(folder,'uploads');
 process.env.PAYMENT_MODE='SIMULATION';process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';process.env.NODE_ENV='development';
 const {db}=await import('../src/db.js');
 const {handleRequest}=await import('../src/index.js');
 const {listingFeeFor,storeListingGatewayStatus}=await import('../src/listing-fees.js');
 const {profitStatistics}=await import('../src/analytics.js');
 const server=http.createServer(handleRequest);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;process.env.APP_URL=base;
 const realFetch=globalThis.fetch,gatewayInvoices=new Map();let charges=0,failCharge=false,wrongAmount=false;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.sandbox.midtrans.com')){
   if(String(url).endsWith('/charge')){
    charges++;const body=JSON.parse(options.body);
    assert.equal(body.payment_type,'qris');assert.equal(body.transaction_details.gross_amount,3000);
    const id=body.transaction_details.order_id;
    gatewayInvoices.set(id,{order_id:id,gross_amount:'3000.00',currency:'IDR',payment_type:'qris',transaction_status:'pending',status_code:'201',
     actions:[{name:'generate-qr-code',url:'https://api.sandbox.midtrans.com/v2/qris/'+id+'/qr-code'}]});
    if(failCharge)throw Error('Network response lost after charge');
    return Response.json(gatewayInvoices.get(id));
   }
   const id=String(url).split('/').at(-2),data={...gatewayInvoices.get(id)};
   if(wrongAmount)data.gross_amount='1.00';
   return Response.json(data);
  }
  return realFetch(url,options);
 };
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
 const body={title:'Buku kuliah',category:'Buku',price:20000,description:'Buku masih bagus dan lengkap.',images:[image],fee:1,status:'PAID',publication_required:0};
 async function call(user,url,data){
  const response=await realFetch(base+url,{method:data===undefined?'GET':'POST',headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,data:await response.json()};
 }
 const endpoint=id=>'/api/listings/'+id+'/publication-payment';
 const visible=async id=>(await call('','/api/listings')).data.listings.some(item=>item.id===id);
 const webhook=async(id,extra={})=>{
  const notification={...gatewayInvoices.get(id),...extra};
  notification.signature_key=crypto.createHash('sha512').update(id+notification.status_code+notification.gross_amount+process.env.MIDTRANS_SERVER_KEY).digest('hex');
  return call('','/api/payments/midtrans/notification',notification);
 };
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  assert.equal((await call('','/api/listings',body)).status,401);
  assert.equal((await call('admin','/api/listings',body)).status,403);
  for(const seller of ['customer','driver']){
   const created=await call(seller,'/api/listings',body);assert.equal(created.status,200,JSON.stringify(created.data));
   const id=created.data.id;assert.equal(created.data.fee,3000);assert.equal(created.data.payment.amount,3000);assert.equal(created.data.published,false);
   assert.equal(await visible(id),false);
   assert.equal((await call('other','/api/listings/'+id+'/buy',{})).status,404);
   assert.equal((await call('other','/api/chat/start',{listing_id:id})).status,404);
   assert.equal((await call('other',endpoint(id))).status,404);
   assert.equal((await call('other',endpoint(id)+'/simulate',{})).status,404);
   assert.equal((await call(seller,endpoint(id),{})).data.payment.id,created.data.payment.id);
   const own=(await call(seller,'/api/listings/mine')).data.listings.find(item=>item.id===id);assert.equal(own.publication_payment.status,'PENDING');
   assert.equal((await call(seller,endpoint(id)+'/simulate',{amount:1})).status,200);
   assert.equal((await call(seller,endpoint(id)+'/simulate',{})).status,200);
   assert.equal(await visible(id),true);
   const entries=db.prepare('SELECT * FROM ledger WHERE source_id=?').all(id);assert.equal(entries.length,1);assert.equal(entries[0].gross_fee,3000);assert.equal(entries[0].source_type,'MARKET_UPLOAD');
   const buyer=seller==='customer'?'driver':'customer';
   const reservation=await call(buyer,'/api/listings/'+id+'/buy',{});assert.equal(reservation.status,200);
   const orderId=reservation.data.item.order_id;
   assert.equal(db.prepare('SELECT payment_required FROM market_orders WHERE id=?').get(orderId).payment_required,0);
   assert.equal((await call(buyer,'/api/market/orders/'+orderId+'/payment',{})).status,409);
   assert.equal((await call(seller,'/api/listings/'+id+'/complete',{order_id:orderId})).data.fee,0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger WHERE source_id=?').get(id).n,1);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_payments').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_wallet_credits').get().n,0);
  assert.equal(profitStatistics({mode:'SIMULATION',period:'ALL'}).totals.commission,6000);
  assert.equal(profitStatistics({mode:'SIMULATION',period:'ALL'}).totals.volume,6000);
  const expired=(await call('customer','/api/listings',body)).data.id;
  db.prepare("UPDATE listing_fee_payments SET expires_at='2000-01-01T00:00:00Z' WHERE listing_id=?").run(expired);
  assert.equal((await call('customer',endpoint(expired)+'/simulate',{})).status,409);assert.equal(await visible(expired),false);

  process.env.PAYMENT_MODE='DISABLED';
  assert.equal((await call('customer','/api/listings',body)).status,503);
  process.env.PAYMENT_MODE='MIDTRANS_SANDBOX';process.env.MIDTRANS_SERVER_KEY='unit-test-server-key';
  const created=await call('customer','/api/listings',body),id=created.data.id,p=created.data.payment;
  assert.equal(p.amount,3000);assert.equal(charges,1);assert.equal(p.status,'PENDING');assert.match(p.qr_url,/api.sandbox.midtrans.com/);
  await call('customer',endpoint(id),{});assert.equal(charges,1,'Retry must not create another charge');
  assert.equal((await call('customer',endpoint(id)+'/simulate',{})).status,403);
  assert.equal((await call('','/api/payments/midtrans/notification',{...gatewayInvoices.get(p.id),signature_key:'bad'})).status,403);
  // Even a valid signature cannot authenticate an altered transaction_status: check gateway status.
  assert.equal((await webhook(p.id,{transaction_status:'settlement'})).status,200);assert.equal(await visible(id),false);
  wrongAmount=true;const invalid=await call('customer',endpoint(id));assert.match(invalid.data.paymentError,/tidak sesuai/);assert.equal(await visible(id),false);wrongAmount=false;
  assert.throws(()=>storeListingGatewayStatus(listingFeeFor(id),{...gatewayInvoices.get(p.id),actions:[{name:'generate-qr-code',url:'https://evil.example/qr'}]}),/QRIS/);
  gatewayInvoices.get(p.id).transaction_status='settlement';
  assert.equal((await webhook(p.id)).status,200);assert.equal(await visible(id),true);
  assert.equal((await webhook(p.id)).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger WHERE source_id=?').get(id).n,1);
  gatewayInvoices.get(p.id).transaction_status='pending';await webhook(p.id);assert.equal(listingFeeFor(id).status,'PAID');
  assert.equal(profitStatistics({mode:'MIDTRANS_SANDBOX',period:'ALL'}).totals.commission,3000);
  assert.equal(profitStatistics({mode:'SIMULATION',period:'ALL'}).totals.commission,6000);

  failCharge=true;const uncertain=await call('driver','/api/listings',body),uncertainId=uncertain.data.id;assert.equal(uncertain.status,200);
  assert.equal(uncertain.data.payment.status,'CREATING');assert.ok(uncertain.data.paymentError);assert.equal(await visible(uncertainId),false);
  const priorCharges=charges;await call('driver',endpoint(uncertainId),{});assert.equal(charges,priorCharges);
  failCharge=false;assert.equal((await call('driver',endpoint(uncertainId))).data.payment.status,'PENDING');
  gatewayInvoices.get(uncertain.data.payment.id).transaction_status='settlement';
  assert.equal((await call('driver',endpoint(uncertainId))).data.published,true,'Status polling also publishes after settlement');

  process.env.PAYMENT_MODE='SIMULATION';process.env.NODE_ENV='production';
  assert.equal((await call('customer',endpoint(expired)+'/simulate',{})).status,403);
  assert.equal((await call('customer','/api/listings',body)).status,503);
 }finally{
  globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));db.close();
  rmSync(folder,{recursive:true,force:true});
  for(const key of ['ANJEMIN_DATA_DIR','ANJEMIN_UPLOAD_DIR','PAYMENT_MODE','MIDTRANS_SERVER_KEY','NODE_ENV'])delete process.env[key];
 }
});
