import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('marketplace held funds release only after seller handover and buyer confirmation; retries, refunds, fees and wallets stay consistent',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-market-payment-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.PAYMENT_MODE='SIMULATION';
 const {db}=await import('../src/db.js');const {requireMarketSimulation}=await import('../src/market-payments.js');
 const port=60000+crypto.randomInt(2000);let child;
 const listing=(id,price=100000)=>db.prepare("INSERT INTO listings(id,seller_id,title,category,price,description,image_path) VALUES(?,'seller',?,'Buku',?,'Description','test.png')").run(id,id,price);
 async function call(user,url,method='GET',body={}){
  const r=await fetch('http://localhost:'+port+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
 }
 const checkout=async(id,user='buyer')=>{listing(id);const r=await call(user,'/api/listings/'+id+'/buy','POST');assert.equal(r.status,200);return r.data.item.order_id;};
 const payment=id=>db.prepare('SELECT * FROM market_payments WHERE order_id=?').get(id);
 const wallet=async()=> (await call('seller','/api/market/wallet')).data;
 try{
  for(const [id,role] of [['buyer','CUSTOMER'],['seller','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:'http://localhost:'+port,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  const id=await checkout('item'),base='/api/market/orders/'+id;
  assert.equal(payment(id).status,'PENDING');assert.equal(payment(id).platform_fee,3000);
  assert.equal((await call('buyer','/api/market/orders/mine')).data.orders[0].payment.status,'PENDING');
  assert.equal((await call('',base+'/payment')).status,401);assert.equal((await call('other',base+'/payment')).status,404);
  assert.equal((await call('seller',base+'/payment','POST')).status,404);
  assert.equal((await call('other',base+'/payment/simulate','POST')).status,404);
  assert.equal((await call('seller',base+'/payment/simulate','POST')).status,404);
  assert.equal((await call('buyer',base+'/handover','POST')).status,404);
  assert.equal((await call('seller',base+'/handover','POST')).status,409);
  assert.equal((await call('buyer',base+'/confirm','POST')).status,409);
  assert.equal((await call('seller','/api/listings/item/complete','POST',{order_id:id})).status,409);
  assert.equal((await call('buyer',base+'/payment','POST')).data.payment.id,payment(id).id);
  // Client-supplied amounts and status cannot alter the invoice or fake a release.
  assert.equal((await call('buyer',base+'/payment/simulate','POST',{amount:1,status:'RELEASED'})).status,200);
  assert.equal((await call('buyer',base+'/payment/simulate','POST')).status,200);
  assert.equal(payment(id).amount,100000);assert.equal(payment(id).status,'HELD');
  assert.equal((await wallet()).held,97000);assert.equal((await wallet()).available,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n,0);
  assert.equal((await call('buyer',base+'/confirm','POST')).status,409);
  assert.equal((await call('seller',base+'/handover','POST')).status,200);
  assert.equal((await call('seller',base+'/handover','POST')).status,200);
  assert.equal((await call('seller',base+'/confirm','POST')).status,404);
  assert.equal((await call('other',base+'/confirm','POST')).status,404);
  assert.equal((await call('buyer','/api/listings/item/cancel','POST',{order_id:id})).status,409);
  assert.equal((await call('seller','/api/listings/item/cancel','POST',{order_id:id})).status,409);
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='seller'").run();
  assert.equal((await call('buyer',base+'/confirm','POST')).status,409);assert.equal(payment(id).status,'HELD');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_wallet_credits').get().n,0);
  db.prepare("UPDATE users SET account_status='ACTIVE' WHERE id='seller'").run();
  const released=await call('buyer',base+'/confirm','POST');assert.equal(released.status,200);assert.equal(released.data.payment.status,'RELEASED');
  assert.equal((await call('buyer',base+'/confirm','POST')).status,200,'Repeated confirmation must be idempotent');
  assert.equal((await wallet()).held,0);assert.equal((await wallet()).available,97000);
  assert.equal((await call('buyer','/api/market/wallet')).data.available,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_wallet_credits').get().n,1);
  const fee=db.prepare("SELECT * FROM ledger WHERE source_id='item'").get();assert.equal(fee.gross_fee,3000);assert.equal(fee.collected,3000);assert.equal(fee.mode,'SIMULATION');
  const statistics=(await call('admin','/api/admin/profits?mode=SIMULATION&period=ALL')).data;
  assert.equal(statistics.totals.commission,3000);assert.equal(statistics.totals.collected,3000);
  const unpaid=await checkout('unpaid');
  assert.equal((await call('buyer','/api/listings/unpaid/cancel','POST',{order_id:unpaid})).status,200);assert.equal(payment(unpaid).status,'CANCELLED');
  const refund=await checkout('refund');
  await call('buyer','/api/market/orders/'+refund+'/payment/simulate','POST');
  assert.equal((await call('buyer','/api/listings/refund/cancel','POST',{order_id:refund})).status,200);
  assert.equal(payment(refund).status,'REFUNDED');assert.ok(payment(refund).refunded_at);assert.equal((await wallet()).held,0);assert.equal((await wallet()).available,97000);
  assert.equal((await call('buyer','/api/market/orders/'+refund+'/confirm','POST')).status,409);
  const expiry=await checkout('expiry');db.prepare("UPDATE market_payments SET expires_at='2000-01-01T00:00:00Z' WHERE order_id=?").run(expiry);
  assert.equal((await call('buyer','/api/market/orders/'+expiry+'/payment/simulate','POST')).status,409);
  assert.equal((await call('buyer','/api/market/orders/'+expiry+'/payment')).data.payment.status,'EXPIRED');
  assert.equal((await call('buyer','/api/market/orders/'+expiry+'/payment','POST')).data.payment.status,'PENDING');
  assert.equal((await call('buyer','/api/market/orders/'+expiry+'/payment/simulate','POST')).status,200);
  await call('buyer','/api/listings/expiry/cancel','POST',{order_id:expiry});
  // The maximum fee remains Rp20,000 and never reduces the buyer's invoice.
  listing('cap',1000000);const cap=(await call('buyer','/api/listings/cap/buy','POST')).data.item.order_id;
  assert.equal(payment(cap).platform_fee,20000);assert.equal(payment(cap).amount,1000000);
  await call('buyer','/api/market/orders/'+cap+'/payment/simulate','POST');await call('seller','/api/market/orders/'+cap+'/handover','POST');
  assert.equal((await call('buyer','/api/market/orders/'+cap+'/confirm','POST')).status,200);assert.equal((await wallet()).available,1077000);
  // An active historical COD order can opt into the website payment flow.
  listing('legacy');db.prepare("UPDATE listings SET status='RESERVED',buyer_id='buyer',agreed_price=100000 WHERE id='legacy'").run();
  db.prepare("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,category,image_path,amount,status) VALUES('legacy-order','legacy','buyer','seller','Legacy','Buku','test.png',100000,'RESERVED')").run();
  assert.equal((await call('buyer','/api/market/orders/legacy-order/payment','POST')).status,200);
  assert.equal(db.prepare("SELECT payment_required FROM market_orders WHERE id='legacy-order'").get().payment_required,1);
  assert.equal((await call('seller','/api/listings/legacy/complete','POST',{order_id:'legacy-order'})).status,409);
  assert.equal((await call('admin','/api/market/wallet')).status,403);
  process.env.NODE_ENV='production';assert.throws(()=>requireMarketSimulation(),/simulasi/);delete process.env.NODE_ENV;
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;delete process.env.PAYMENT_MODE;delete process.env.NODE_ENV;
 }
});
