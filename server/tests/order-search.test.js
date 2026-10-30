import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('service searches expire after three minutes; retries reuse one order and voucher and cannot revive accepted orders',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-order-search-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.ANJEMIN_UPLOAD_DIR=path.join(folder,'uploads');
 process.env.NODE_ENV='development';process.env.PAYMENT_MODE='SIMULATION';process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';
 const {db}=await import('../src/db.js'),{handleRequest}=await import('../src/index.js'),{searchWindow}=await import('../src/order-search.js');
 const server=http.createServer(handleRequest);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;process.env.APP_URL=base;
 async function call(user,url,data){
  const response=await fetch(base+url,{method:data===undefined?'GET':'POST',headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,data:await response.json()};
 }
 const mine=async()=> (await call('customer','/api/orders/mine')).data;
 const expire=id=>db.prepare("UPDATE service_orders SET search_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
 const row=id=>db.prepare('SELECT * FROM service_orders WHERE id=?').get(id);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['other','CUSTOMER'],['driver','DRIVER'],['driver2','DRIVER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,'unused',?,'APPROVED',1,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  db.prepare("INSERT INTO vouchers(id,user_id,amount,reason,expires_at) VALUES('voucher','customer',500,'Test','2030-01-01T00:00:00Z')").run();
  for(const type of ['RIDE','JASTIP','DELIVERY']){
   const before=Date.now(),created=await call('customer','/api/orders',{type,pickup:'Gerbang kampus',destination:'Kos Melati',fare:10000,pickup_lat:-7.058,pickup_lng:110.441,
    item_name:'Buku kuliah',item_category:'Buku',item_weight:1,image,notes:'Tunggu depan pos',...(type==='RIDE'?{voucher_id:'voucher'}:{})});
   assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.order.id;
   const original=row(id),deadline=Date.parse(original.search_expires_at);
   assert.ok(deadline>=before+180000&&deadline<=Date.now()+180000);assert.equal(original.search_attempt,1);
   let response=await mine(),search=response.orders.find(o=>o.id===id).search;
   assert.equal(search.attempt,1);assert.ok(search.remaining_seconds>=178&&search.remaining_seconds<=180);assert.equal(search.timed_out,false);
   assert.ok(Number.isFinite(Date.parse(response.server_time)));
   const retry='/api/orders/'+id+'/retry';
   assert.equal((await call('',retry,{search_attempt:1})).status,401);
   assert.equal((await call('other',retry,{search_attempt:1})).status,404);
   assert.equal((await call('driver',retry,{search_attempt:1})).status,404);
   assert.equal((await call('admin',retry,{search_attempt:1})).status,403);
   assert.equal((await call('customer',retry,{search_attempt:1})).status,409);
   assert.equal(searchWindow(original,deadline).remaining_seconds,0,'Boundary must expire exactly at 3 minutes');
   expire(id);
   response=await mine();search=response.orders.find(o=>o.id===id).search;
   assert.equal(search.remaining_seconds,0);assert.equal(search.timed_out,true);
   assert.ok(!(await call('driver','/api/driver/jobs')).data.orders.some(o=>o.id===id));
   assert.equal((await call('driver','/api/orders/'+id+'/claim',{})).status,409);
   assert.equal((await call('customer',retry,{})).status,400);
   assert.equal((await call('customer',retry,{search_attempt:2})).status,409);
   const renewed=await call('customer',retry,{search_attempt:1,expires_at:'2099-01-01T00:00:00Z',fare:1});
   assert.equal(renewed.status,200,JSON.stringify(renewed.data));assert.equal(renewed.data.renewed,true);
   assert.equal(renewed.data.order.id,id);assert.equal(renewed.data.order.search.attempt,2);
   assert.ok(renewed.data.order.search.remaining_seconds>=179);assert.ok(Date.parse(row(id).search_expires_at)<Date.now()+181000);
   const after=row(id);
   for(const key of ['fare','platform_fee','promo_discount','pickup','pickup_lat','pickup_lng','destination','notes','image_path','voucher_id'])assert.equal(after[key],original[key]);
   const repeated=await call('customer',retry,{search_attempt:1});
   assert.equal(repeated.status,200);assert.equal(repeated.data.renewed,false);assert.equal(row(id).search_expires_at,after.search_expires_at);
   assert.ok((await call('driver','/api/driver/jobs')).data.orders.some(o=>o.id===id));
   expire(id);
   const retries=await Promise.all([call('customer',retry,{search_attempt:2}),call('customer',retry,{search_attempt:2})]);
   assert.ok(retries.every(r=>r.status===200));assert.equal(retries.filter(r=>r.data.renewed).length,1);assert.equal(row(id).search_attempt,3);
   assert.equal((await call('driver','/api/orders/'+id+'/claim',{})).status,200);
   assert.equal((await call('driver2','/api/orders/'+id+'/claim',{})).status,409);
   assert.equal((await call('customer',retry,{search_attempt:3})).status,409);
   assert.equal((await mine()).orders.find(o=>o.id===id).search,null);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=?').get(id).n,0);
   if(type==='RIDE')assert.equal(db.prepare("SELECT redeemed_order_id FROM vouchers WHERE id='voucher'").get().redeemed_order_id,id);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM service_orders').get().n,3,'Retries must not duplicate orders');
  const cancelled=await call('customer','/api/orders',{type:'RIDE',pickup:'Gerbang kampus',destination:'Kos Melati',fare:10000});
  const id=cancelled.data.order.id;expire(id);
  assert.equal((await call('customer','/api/orders/'+id+'/cancel',{})).status,200);
  assert.equal((await call('customer','/api/orders/'+id+'/retry',{search_attempt:1})).status,409);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});
  for(const key of ['ANJEMIN_DATA_DIR','ANJEMIN_UPLOAD_DIR','NODE_ENV','PAYMENT_MODE'])delete process.env[key];
 }
});
