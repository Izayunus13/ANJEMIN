import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('driver achievements count paid completed rides, credit each milestone once, and account for rewards',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-achievements-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.PAYMENT_MODE='SIMULATION';process.env.NODE_ENV='development';
 const {db}=await import('../src/db.js');
 const {driverAchievements,claimDriverAchievement}=await import('../src/driver-achievements.js');
 const {profitStatistics}=await import('../src/analytics.js');
 const port=62000+crypto.randomInt(1500);let child;
 const call=async(user,url,method='GET',body={})=>{
  const r=await fetch('http://localhost:'+port+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json()};
 };
 const achievements=async(user='driver')=>(await call(user,'/api/driver/achievements')).data;
 const wallet=async(user='driver')=>(await call(user,'/api/driver/wallet')).data;
 const claim=(user='driver',id='RIDE_10',body={})=>call(user,'/api/driver/achievements/'+id+'/claim','POST',body);
 try{
  for(const [id,role] of [['driver','DRIVER'],['other','DRIVER'],['pending','DRIVER'],['customer','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,referral_code) VALUES(?,?,?,?,?,'unused',?,?,?)")
    .run(id,id,id,id+'@example.test',id,role,role==='DRIVER'?(id==='pending'?'PENDING':'APPROVED'):'NONE',id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  let n=0;
  function ride({driver='driver',customer='customer',type='RIDE',status='COMPLETED',payment='RELEASED',mode='SIMULATION',credit=payment==='RELEASED',future=false}={}){
   const id='order-'+(++n),date=status==='COMPLETED'?new Date(Date.now()+(future?86400000:-60000)).toISOString():null;
   db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,status,completed_at,payment_required,delivery_reported_at) VALUES(?,?,?,?,'Pickup','Destination',10000,600,?,?,1,CURRENT_TIMESTAMP)")
    .run(id,customer,driver,type,status,date);
   if(payment)db.prepare("INSERT INTO payments(id,order_id,mode,amount,status,expires_at) VALUES(?,?,?,10000,?,'2030-01-01T00:00:00Z')").run(id,id,mode,payment);
   if(credit)db.prepare('INSERT INTO wallet_credits(id,driver_id,order_id,payment_id,amount,mode) VALUES(?,?,?,?,9400,?)').run(id,driver,id,id,mode);
   return id;
  }
  for(let i=0;i<9;i++)ride();
  ride({type:'DELIVERY'});ride({type:'JASTIP'});ride({status:'CANCELLED'});ride({payment:'HELD'});ride({payment:null});
  ride({credit:false});ride({customer:'driver'});ride({future:true});
  for(let i=0;i<10;i++){ride({mode:'MIDTRANS_SANDBOX'});ride({mode:'MIDTRANS_LIVE'});ride({driver:'pending'});}
  for(let i=0;i<12;i++)ride({driver:'other'});
  const active=ride({status:'CLAIMED',payment:'HELD'});
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:'http://localhost:'+port,ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await call('','/api/driver/achievements')).status,401);
  for(const user of ['customer','admin']){
   assert.equal((await call(user,'/api/driver/achievements')).status,403);
   assert.equal((await claim(user)).status,403);
  }
  assert.equal((await achievements()).completed,9);
  assert.equal((await achievements('other')).completed,12);
  assert.equal((await claim('driver','RIDE_10',{completed:500,amount:999999,driver_id:'other'})).status,409,'Client input must not satisfy milestones');
  assert.equal((await claim('driver','RIDE_999')).status,404);
  assert.equal((await achievements('pending')).milestones[0].canClaim,false);
  assert.equal((await claim('pending')).status,403);
  const beforeCompletion=await wallet();
  assert.equal((await call('driver','/api/orders/'+active+'/complete','POST')).status,409);
  assert.equal((await call('customer','/api/orders/'+active+'/complete','POST')).status,200);
  const eligible=await achievements();assert.equal(eligible.completed,10);assert.equal(eligible.claimableTotal,5000);
  assert.equal(eligible.milestones[0].canClaim,true);assert.equal(eligible.milestones[1].status,'LOCKED');
  const before=profitStatistics({mode:'SIMULATION',period:'30'});
  const responses=await Promise.all(Array.from({length:12},()=>claim('driver','RIDE_10',{amount:999999})));
  assert.ok(responses.every(r=>r.status===200));assert.equal(responses.filter(r=>!r.data.alreadyClaimed).length,1);
  assert.equal(responses[0].data.reward.amount,5000);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM driver_achievement_rewards WHERE driver_id='driver'").get().total,1);
  const afterWallet=await wallet();assert.equal(afterWallet.available,beforeCompletion.available+9400+5000);assert.equal(afterWallet.rewards,5000);
  assert.equal(afterWallet.credits.filter(c=>c.kind==='REWARD').length,1);assert.equal((await wallet('other')).rewards,0);
  const after=profitStatistics({mode:'SIMULATION',period:'30'});
  assert.equal(after.totals.transactions,before.totals.transactions);assert.equal(after.totals.commission,before.totals.commission);
  assert.equal(after.totals.rewards,5000);assert.equal(after.totals.profit,before.totals.profit-5000);
  for(const key of Object.keys(after.totals)){
   assert.equal(after.services.reduce((sum,row)=>sum+row[key],0),after.totals[key]);
   assert.equal(after.series.reduce((sum,row)=>sum+row[key],0),after.totals[key]);
  }
  assert.equal(profitStatistics({mode:'MIDTRANS_LIVE'}).totals.rewards,0);
  for(let i=0;i<15;i++)ride();
  assert.equal((await achievements()).completed,25);
  assert.equal((await achievements()).milestones[0].status,'CLAIMED');
  assert.equal((await claim('driver','RIDE_25')).data.reward.amount,7500);
  assert.equal((await claim('driver','RIDE_50')).status,409);
  assert.equal((await achievements()).claimedTotal,12500);
  assert.equal((await claim('other')).status,200);
  assert.equal((await wallet('other')).rewards,5000);assert.equal((await wallet()).rewards,12500);
  assert.equal(profitStatistics().totals.rewards,17500);
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='driver'").run();assert.equal((await claim()).status,401);
  assert.throws(()=>claimDriverAchievement('driver','RIDE_10'),/Akses/);
  db.prepare("UPDATE users SET account_status='ACTIVE',profile_required=1 WHERE id='driver'").run();
  assert.equal((await claim()).status,409,'Profile completion is required before claiming');
  db.prepare("UPDATE users SET profile_required=0 WHERE id='driver'").run();
  for(const mode of ['MIDTRANS_SANDBOX','MIDTRANS_LIVE','DISABLED']){
   process.env.PAYMENT_MODE=mode;
   assert.equal(driverAchievements('driver').claimedTotal,0);
   assert.equal(driverAchievements('driver').milestones.some(m=>m.canClaim),false);
   assert.throws(()=>claimDriverAchievement('driver','RIDE_10'),/simulasi/);
  }
  process.env.PAYMENT_MODE='SIMULATION';process.env.NODE_ENV='production';
  assert.throws(()=>claimDriverAchievement('driver','RIDE_10'),/simulasi/);
  process.env.NODE_ENV='development';
  assert.equal((await achievements()).claimedTotal,12500,'Claims survive reloads and repeated requests');
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();
  const resolved=path.resolve(folder),tempRoot=path.resolve(tmpdir())+path.sep;
  if(!resolved.startsWith(tempRoot)||!path.basename(resolved).startsWith('anjemin-achievements-'))throw Error('Unexpected test cleanup path');
  rmSync(resolved,{recursive:true,force:true});
  delete process.env.ANJEMIN_DATA_DIR;delete process.env.PAYMENT_MODE;delete process.env.NODE_ENV;
 }
});
