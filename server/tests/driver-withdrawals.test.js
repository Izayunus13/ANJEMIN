
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import crypto from 'node:crypto';
test('driver withdrawals validate destinations, isolate wallets, prevent duplicate and concurrent overdrafts',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-driver-withdraw-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.PAYMENT_MODE='SIMULATION';
 const {db}=await import('../src/db.js');
 const {withdrawDriverSimulation}=await import('../src/driver-withdrawals.js');
 const port=55000+crypto.randomInt(2000),base='http://localhost:'+port;let child;
 async function call(user,url,body){
  const r=await fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json()};
 }
 const wallet=async()=> (await call('driver','/api/driver/wallet')).data;
 const withdraw=(body,user='driver')=>call(user,'/api/driver/withdrawals',body);
 try{
  for(const [id,role] of [['driver','DRIVER'],['customer','CUSTOMER']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  db.prepare("INSERT INTO driver_achievement_rewards(id,driver_id,milestone,target,title,amount,mode) VALUES('reward','driver','test',10,'Test reward',50000,'SIMULATION')").run();
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  const form={amount:10000,channel:'BANK',provider:'BCA',account_name:'Nama Penganjem',account_number:'1234567890',confirm_number:'1234567890',confirmed:true,request_key:crypto.randomUUID()};
  assert.equal((await wallet()).available,50000);
  assert.equal((await withdraw(form,'')).status,401);
  assert.equal((await withdraw(form,'customer')).status,403);
  for(const invalid of [{confirmed:false},{channel:'__proto__'},{provider:'DANA'},{confirm_number:'9999999'},{amount:50001},{amount:1.5}]){
   assert.ok([400,409].includes((await withdraw({...form,...invalid})).status));
  }
  const first=await withdraw(form);assert.equal(first.status,200);assert.equal(first.data.available,40000);
  assert.ok(!JSON.stringify(first.data).includes(form.account_number));
  const retry=await withdraw(form);assert.equal(retry.data.withdrawal.id,first.data.withdrawal.id);assert.equal(retry.data.available,40000);
  assert.equal((await withdraw({...form,amount:10001})).status,409);
  const phone={...form,amount:10000,channel:'EWALLET',provider:'DANA',account_number:'081234567890',confirm_number:'+6281234567890',request_key:crypto.randomUUID()};
  assert.equal((await withdraw(phone)).status,200);
  const concurrent=await Promise.all([withdraw({...form,amount:30000,request_key:crypto.randomUUID()}),withdraw({...form,amount:30000,request_key:crypto.randomUUID()})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const balance=await wallet();assert.equal(balance.available,0);assert.equal(balance.withdrawn,50000);assert.equal(balance.withdrawals.length,3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_withdrawals').get().n,0);
  process.env.NODE_ENV='production';assert.throws(()=>withdrawDriverSimulation('driver',form),/simulasi/);delete process.env.NODE_ENV;
 }finally{
  if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
  db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;delete process.env.PAYMENT_MODE;
 }
});
