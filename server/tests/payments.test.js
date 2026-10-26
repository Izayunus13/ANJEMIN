import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('payment lifecycle: authorization, held funds, customer release, retries and signatures',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-payment-'));
 process.env.ANJEMIN_DATA_DIR=folder;
 process.env.PAYMENT_MODE='SIMULATION';
 const {db}=await import('../src/db.js');
 const {storeGatewayStatus,verifyNotification,paymentMode}=await import('../src/payments.js');
 const port=35000+crypto.randomInt(10000);
 let child;
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,?,?,'APPROVED',1,?)")
    .run(id,id,id,id+'@example.test',id,'unused',role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:'http://localhost:'+port,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();
  async function call(user,url,method='GET',body={}){
   const r=await fetch('http://localhost:'+port+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
   return {status:r.status,data:await r.json()};
  }
  let ready=false;
  for(let i=0;i<100;i++){
   try{await call('customer','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}
  }
  assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await call('customer','/api/admin/users')).status,403);
  assert.equal((await call('driver','/api/admin/users')).status,403);
  assert.equal((await call('','/api/admin/users')).status,401);
  const recap=await call('admin','/api/admin/users');
  assert.equal(recap.status,200);
  assert.equal(recap.data.users.length,3);
  assert.ok(recap.data.users.every(u=>/^USR-\d{6,}$/.test(u.user_code)));
  assert.equal(new Set(recap.data.users.map(u=>u.user_code)).size,3);
  const repeated=await call('admin','/api/admin/users');
  assert.deepEqual(repeated.data.users.map(u=>u.user_code),recap.data.users.map(u=>u.user_code));
  assert.ok(recap.data.users.every(u=>['CUSTOMER','DRIVER'].includes(u.role)&&!('password_hash' in u)&&!('ktm_path' in u)));
  assert.equal(recap.data.users.find(u=>u.id==='driver').jobs_completed,0);
  const created=await call('customer','/api/orders','POST',{type:'RIDE',pickup:'Lokasi jemput',destination:'Lokasi tujuan',fare:10000});
  assert.equal(created.status,200);const id=created.data.order.id;
  const reportUrl='/api/orders/'+id+'/reports';
  const report={category:'LOST_ITEM',details:'Tas tertinggal di kendaraan setelah perjalanan.'};
  assert.equal((await call('other',reportUrl,'POST',report)).status,404);
  assert.equal((await call('customer',reportUrl,'POST',{...report,category:'INVALID'})).status,400);
  assert.equal((await call('customer',reportUrl,'POST',report)).status,200);
  assert.equal((await call('customer','/api/admin/reports')).status,403);
  const reports=await call('admin','/api/admin/reports');
  assert.equal(reports.data.reports.length,1);
  assert.equal(reports.data.reports[0].details,report.details);
  const resolveUrl='/api/admin/reports/'+reports.data.reports[0].id+'/resolve';
  assert.equal((await call('driver',resolveUrl,'POST')).status,403);
  assert.equal((await call('admin',resolveUrl,'POST')).status,200);
  assert.equal((await call('admin','/api/admin/reports')).data.reports[0].status,'RESOLVED');

  const url='/api/orders/'+id;
  assert.equal((await call('customer',url+'/payment','POST')).status,409);
  assert.equal((await call('driver',url+'/claim','POST')).status,200);
  assert.equal((await call('other',url+'/payment','POST')).status,404);
  assert.equal((await call('driver',url+'/payment','POST')).status,404);
  assert.equal((await call('customer',url+'/complete','POST')).status,409);
  const payment=(await call('customer',url+'/payment','POST')).data.payment;
  assert.equal(payment.status,'PENDING');assert.equal(payment.amount,10000);
  assert.equal((await call('customer',url+'/payment','POST')).data.payment.id,payment.id);
  assert.equal((await call('driver',url+'/payment/simulate','POST')).status,404);
  assert.equal((await call('customer',url+'/payment/simulate','POST')).status,200);
  assert.equal((await call('customer',url+'/payment/simulate','POST')).status,200);
  let wallet=(await call('driver','/api/driver/wallet')).data;
  assert.equal(wallet.held,9400);assert.equal(wallet.available,0);
  assert.equal((await call('driver',url+'/complete','POST')).status,409);
  assert.equal((await call('customer',url+'/complete','POST')).status,409);
  assert.equal((await call('driver',url+'/delivered','POST')).status,200);
  assert.equal((await call('other',url+'/complete','POST')).status,409);
  assert.equal((await call('customer',url+'/complete','POST')).status,200);
  assert.equal((await call('customer',url+'/complete','POST')).status,409);
  await call('customer',url+'/payment/simulate','POST');
  wallet=(await call('driver','/api/driver/wallet')).data;
  assert.equal(wallet.available,9400);assert.equal(wallet.held,0);assert.equal(wallet.credits.length,1);
  const bad=await call('customer','/api/payments/midtrans/notification','POST',{order_id:payment.id,signature_key:'fake'});
  assert.equal(bad.status,403);
  // Test expiry and voucher subsidy without touching any real user data.
  const second=await call('customer','/api/orders','POST',{type:'RIDE',pickup:'Lokasi jemput',destination:'Lokasi tujuan',fare:10000});
  const secondUrl='/api/orders/'+second.data.order.id;
  await call('driver',secondUrl+'/claim','POST');
  await call('customer',secondUrl+'/payment','POST');
  db.prepare("UPDATE payments SET expires_at='2000-01-01T00:00:00Z' WHERE order_id=?").run(second.data.order.id);
  assert.equal((await call('customer',secondUrl+'/payment/simulate','POST')).status,409);
  assert.equal((await call('driver','/api/driver/wallet')).data.available,9400);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n,0,'Simulated income must not enter the real commission ledger');
  db.prepare("INSERT INTO vouchers(id,user_id,amount,reason,expires_at) VALUES('free','customer',1000,'test',?)").run(new Date(Date.now()+3600000).toISOString());
  const free=await call('customer','/api/orders','POST',{type:'RIDE',pickup:'Lokasi jemput',destination:'Lokasi tujuan',fare:1000,voucher_id:'free'});
  const freeUrl='/api/orders/'+free.data.order.id;
  await call('driver',freeUrl+'/claim','POST');
  const freePayment=(await call('customer',freeUrl+'/payment','POST')).data.payment;
  assert.equal(freePayment.amount,0);assert.equal(freePayment.status,'HELD');
  await call('driver',freeUrl+'/delivered','POST');
  assert.equal((await call('customer',freeUrl+'/complete','POST')).status,200);
  assert.equal((await call('driver','/api/driver/wallet')).data.available,10340);
  for(const user of ['','customer','driver'])assert.equal((await call(user,'/api/admin/profits')).status,user?403:401);
  const profit=await call('admin','/api/admin/profits?mode=SIMULATION&period=7');
  assert.equal(profit.status,200);assert.equal(profit.data.mode,'SIMULATION');assert.equal(profit.data.timezone,'Asia/Jakarta');
  assert.equal(profit.data.totals.transactions,2);assert.equal(profit.data.totals.commission,660);assert.equal(profit.data.totals.promo,1000);assert.equal(profit.data.totals.profit,-340);
  assert.equal((await call('admin','/api/admin/overview')).data.stats.bookedCommission,profit.data.totals.commission);
  assert.equal((await call('admin','/api/admin/profits?mode=MIDTRANS_LIVE')).data.totals.commission,0);
  assert.equal((await call('admin','/api/admin/profits?period=invalid')).status,400);
  assert.equal((await call('admin','/api/admin/profits?mode=invalid')).status,400);
  db.prepare("INSERT INTO listings(id,seller_id,title,category,price,agreed_price,description,image_path,status) VALUES('stats-market','driver','Buku','Buku',10000,10000,'Buku kuliah','test.png','RESERVED')").run();
  assert.equal((await call('driver','/api/listings/stats-market/complete','POST')).status,200);
  assert.equal(db.prepare("SELECT mode FROM ledger WHERE source_id='stats-market'").get().mode,'SIMULATION');
  const marketStats=(await call('admin','/api/admin/profits?mode=SIMULATION&period=7')).data;
  assert.equal(marketStats.services.find(r=>r.service==='MARKET').commission,300);
  assert.equal((await call('admin','/api/admin/profits?mode=MIDTRANS_LIVE')).data.totals.commission,0);


  // A signed callback must match amount, currency and channel; stale callbacks cannot undo settlement.
  const p=db.prepare('SELECT * FROM payments WHERE order_id=?').get(second.data.order.id);
  db.prepare("UPDATE payments SET mode='MIDTRANS_SANDBOX' WHERE id=?").run(p.id);
  process.env.MIDTRANS_SERVER_KEY='test-only-key';
  const payload={order_id:p.id,status_code:'200',gross_amount:'10000.00',payment_type:'qris',currency:'IDR',transaction_status:'settlement'};
  payload.signature_key=crypto.createHash('sha512').update(p.id+'200'+'10000.00'+'test-only-key').digest('hex');
  const verified=verifyNotification(payload);
  assert.throws(()=>storeGatewayStatus(verified,{...payload,gross_amount:'1.00'}));
  assert.equal(storeGatewayStatus(verified,payload),true);
  assert.equal(storeGatewayStatus(verified,{...payload,transaction_status:'pending'}),false);
  assert.equal(db.prepare('SELECT status FROM payments WHERE id=?').get(p.id).status,'HELD');
  assert.throws(()=>verifyNotification({...payload,signature_key:'bad'}));
  process.env.NODE_ENV='production';assert.equal(paymentMode(),'DISABLED');
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();rmSync(folder,{recursive:true,force:true});
  delete process.env.ANJEMIN_DATA_DIR;delete process.env.PAYMENT_MODE;delete process.env.MIDTRANS_SERVER_KEY;delete process.env.NODE_ENV;
 }
});
