import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('seller withdrawals require confirmation, validate destinations, debit available balance once, and protect account data',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-withdrawal-'));process.env.ANJEMIN_DATA_DIR=folder;process.env.PAYMENT_MODE='SIMULATION';
 const {db}=await import('../src/db.js');const {withdrawMarketSimulation}=await import('../src/market-withdrawals.js');
 const port=62000+crypto.randomInt(1500);let child;
 async function call(user,url,method='GET',body={}){
  const r=await fetch('http://localhost:'+port+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
 }
 const withdraw=(user,body)=>call(user,'/api/market/withdrawals','POST',body);
 const wallet=async user=>(await call(user,'/api/market/wallet')).data;
 try{
  for(const [id,role] of [['seller','DRIVER'],['other','CUSTOMER'],['buyer','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  function credit(id,seller,total,mode='SIMULATION',status='RELEASED'){
   db.prepare("INSERT INTO listings(id,seller_id,title,category,price,description,image_path,status,buyer_id) VALUES(?,?,'Item','Buku',?,'Description','test.png',?,'buyer')").run(id,seller,total,status==='RELEASED'?'SOLD':'RESERVED');
   db.prepare("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,category,image_path,amount,status,payment_required) VALUES(?,?,'buyer',?,'Item','Buku','test.png',?,?,1)").run(id,id,seller,total,status==='RELEASED'?'SOLD':'RESERVED');
   db.prepare("INSERT INTO market_payments(id,order_id,mode,amount,platform_fee,status,expires_at) VALUES(?,?,?,?,0,?,'2030-01-01T00:00:00Z')").run(id,id,mode,total,status);
   if(status==='RELEASED')db.prepare('INSERT INTO market_wallet_credits(id,seller_id,order_id,payment_id,amount,mode) VALUES(?,?,?,?,?,?)').run(id,seller,id,id,total,mode);
  }
  credit('released','seller',97000);credit('sandbox','seller',1000000,'MIDTRANS_SANDBOX');credit('held','seller',87300,'SIMULATION','HELD');credit('other-credit','other',50000);
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:'http://localhost:'+port,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  const form={amount:10000,channel:'BANK',provider:'BCA',account_name:'Nama Pengguna',account_number:'1234567890',confirm_number:'1234567890',confirmed:true,request_key:crypto.randomUUID()};
  assert.equal((await withdraw('',form)).status,401);assert.equal((await withdraw('admin',form)).status,403);
  assert.equal((await wallet('seller')).available,97000);assert.equal((await wallet('seller')).held,87300);assert.equal((await wallet('seller')).withdrawalSimulationEnabled,true);
  assert.equal((await withdraw('seller',{...form,amount:97001})).status,409);
  for(const invalid of [{confirmed:false},{confirm_number:'1234567891'},{account_number:'abc',confirm_number:'abc'},{account_number:'123',confirm_number:'123'},{provider:'DANA'},{channel:'__proto__'},{amount:-1},{amount:1.5},{request_key:''}])assert.equal((await withdraw('seller',{...form,...invalid})).status,400);
  assert.equal((await withdraw('seller',null)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_withdrawals').get().n,0);
  const first=await withdraw('seller',form);assert.equal(first.status,200);assert.equal(first.data.available,87000);assert.equal(first.data.withdrawal.status,'SIMULATED');assert.equal(first.data.withdrawal.masked_number,'****7890');
  assert.ok(!JSON.stringify(first.data).includes(form.account_number));assert.ok(!('request_hash' in first.data.withdrawal));
  const retry=await withdraw('seller',form);assert.equal(retry.status,200);assert.equal(retry.data.withdrawal.id,first.data.withdrawal.id);assert.equal(retry.data.available,87000);
  assert.equal((await withdraw('seller',{...form,amount:10001})).status,409);
  const other=await withdraw('other',form);assert.equal(other.status,200);assert.equal(other.data.available,40000);assert.notEqual(other.data.withdrawal.id,first.data.withdrawal.id);
  const phone={...form,amount:20000,channel:'EWALLET',provider:'DANA',account_number:'081234567890',confirm_number:'+6281234567890',request_key:crypto.randomUUID()};
  assert.equal((await withdraw('seller',phone)).status,200);assert.equal((await wallet('seller')).available,67000);
  const concurrent=await Promise.all([withdraw('seller',{...form,amount:67000,request_key:crypto.randomUUID()}),withdraw('seller',{...form,amount:67000,request_key:crypto.randomUUID()})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal((await wallet('seller')).available,0);assert.equal((await wallet('seller')).withdrawn,97000);assert.equal((await wallet('seller')).held,87300);
  assert.equal((await withdraw('seller',form)).status,200,'A retry must still return the original request when balance is now zero');
  assert.equal((await withdraw('seller',{...form,amount:1,request_key:crypto.randomUUID()})).status,409,'Held and sandbox funds cannot fund a simulation withdrawal');
  const history=(await wallet('seller')).withdrawals;assert.equal(history.length,3);assert.ok(history.every(w=>w.account_name==='Nama Pengguna'&&w.masked_number.startsWith('****')));
  assert.ok(!JSON.stringify(history).includes(form.account_number));assert.equal((await wallet('buyer')).withdrawals.length,0);assert.equal((await wallet('other')).withdrawals.length,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n,0,'Withdrawal must not change platform commission');
  assert.ok(!db.prepare('PRAGMA table_info(market_withdrawals)').all().some(c=>c.name==='account_number'),'Full account number must not be stored');
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='seller'").run();assert.equal((await withdraw('seller',form)).status,401);
  process.env.NODE_ENV='production';assert.throws(()=>withdrawMarketSimulation('seller',form),/simulasi/);delete process.env.NODE_ENV;
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;delete process.env.PAYMENT_MODE;delete process.env.NODE_ENV;
 }
});
