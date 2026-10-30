import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('marketplace orders stay private and retain purchases, sales, and cancellations across reservations and restarts',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-market-'));process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');const port=55000+crypto.randomInt(5000);let child;
 async function call(user,url,method='GET',body={}){
  const r=await fetch('http://localhost:'+port+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
 }
 async function start(){
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:'http://localhost:'+port,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();
  for(let i=0;i<100;i++){try{await call('','/api/config');return;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.fail('Server did not start: '+logs);
 }
 const listing=(id,seller='driver',buyer=null,status='AVAILABLE')=>db.prepare("INSERT INTO listings(id,seller_id,buyer_id,title,category,price,agreed_price,description,image_path,status) VALUES(?,?,?,?,'Buku',20000,?,'Description','test.png',?)").run(id,seller,buyer,id,buyer?20000:null,status);
 const orders=(user,view='BUYER')=>call(user,'/api/market/orders/mine?view='+view);
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  listing('legacy-sold','driver','other','SOLD');listing('legacy-reserved','driver','customer','RESERVED');
  await start();
  assert.equal((await orders('')).status,401);assert.equal((await orders('admin')).status,403);
  assert.equal((await orders('customer','INVALID')).status,400);
  const legacy=(await orders('customer')).data.orders;
  assert.equal(legacy.length,1);assert.equal(legacy[0].created_at,null);assert.ok(legacy[0].conversation_id);
  assert.equal((await orders('driver')).data.orders.length,0);
  assert.equal((await orders('driver','SELLER')).data.orders.length,2);
  listing('book');
  const first=await call('customer','/api/listings/book/buy','POST');assert.equal(first.status,200);
  const firstId=first.data.item.order_id;assert.ok(firstId);
  assert.equal((await call('other','/api/listings/book/buy','POST')).status,409);
  const my=(await orders('customer')).data.orders;assert.equal(my.length,2);assert.ok(my.every(o=>o.buyer_id==='customer'));
  const booked=my.find(o=>o.id===firstId);assert.equal(booked.amount,20000);assert.equal(booked.status,'RESERVED');assert.ok(booked.conversation_id);
  assert.ok(!(await orders('other')).data.orders.some(o=>o.id===firstId));
  assert.equal((await call('other','/api/listings/book/cancel','POST',{order_id:firstId})).status,403);
  assert.equal((await call('customer','/api/listings/book/complete','POST',{order_id:firstId})).status,403);
  assert.equal((await call('customer','/api/listings/book/cancel','POST',{order_id:firstId})).status,200);
  assert.equal((await orders('customer')).data.orders.find(o=>o.id===firstId).status,'CANCELLED');
  assert.equal(db.prepare("SELECT buyer_id FROM listings WHERE id='book'").get().buyer_id,null);
  db.prepare("UPDATE listings SET price=30000 WHERE id='book'").run();
  const second=await call('other','/api/listings/book/buy','POST');assert.equal(second.status,200);
  const secondId=second.data.item.order_id;assert.notEqual(firstId,secondId);
  // A stale page must not cancel or complete somebody else's new reservation.
  assert.equal((await call('driver','/api/listings/book/cancel','POST',{order_id:firstId})).status,409);
  assert.equal((await call('driver','/api/listings/book/complete','POST',{order_id:firstId})).status,409);
  assert.equal((await call('other','/api/market/orders/'+secondId+'/payment','POST')).status,409);
  assert.equal((await call('other','/api/market/orders/'+secondId+'/payment/simulate','POST')).status,409);
  assert.equal((await call('driver','/api/listings/book/complete','POST',{order_id:secondId})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_payments').get().n,0);
  const old=(await orders('customer')).data.orders.find(o=>o.id===firstId);assert.equal(old.status,'CANCELLED');assert.equal(old.amount,20000);
  const sold=(await orders('other')).data.orders.find(o=>o.id===secondId);assert.equal(sold.status,'SOLD');assert.equal(sold.amount,30000);assert.ok(sold.completed_at);
  assert.equal((await call('other','/api/listings/book/cancel','POST',{order_id:secondId})).status,400);
  assert.equal((await call('driver','/api/listings/book/complete','POST',{order_id:secondId})).status,400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE source_id='book'").get().n,0);
  listing('driver-purchase','customer');
  assert.equal((await call('driver','/api/listings/driver-purchase/buy','POST')).status,200);
  assert.equal((await orders('driver')).data.orders.length,1);
  assert.ok((await orders('driver','SELLER')).data.orders.every(o=>o.seller_id==='driver'));
  assert.equal((await orders('customer','SELLER')).data.orders.length,1);
  const count=db.prepare('SELECT COUNT(*) n FROM market_orders').get().n;
  child.kill();await new Promise(r=>child.once('exit',r));await start();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_orders').get().n,count,'Backfill must not duplicate existing history');
  assert.equal((await orders('customer')).data.orders.find(o=>o.id===firstId).status,'CANCELLED');
  assert.equal((await orders('other')).data.orders.find(o=>o.id===secondId).status,'SOLD');
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
