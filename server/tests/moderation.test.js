import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('only admins can view reports or freeze accounts; freezing revokes access until reactivated',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-moderation-'));
 process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');
 const {hashPassword}=await import('../src/security.js');
 const password='ModerationTest123!';
 const port=45000+crypto.randomInt(10000),base='http://localhost:'+port;
 let child,streamController;
 const session=(user,token=user)=>db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
  .run(crypto.createHash('sha256').update(token).digest('hex'),user,new Date(Date.now()+3600000).toISOString());
 async function call(user,url,method='GET',body={}){
  const r=await fetch(base+url,{method,headers:{Cookie:'anjemin_session='+user,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,?,?,'APPROVED',1,?)")
    .run(id,id,id,id+'@example.test',id,hashPassword(password),role,id);
   session(id);
  }
  session('driver','driver-second-device');
  db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,status) VALUES('order','customer','driver','RIDE','Pickup','Destination',10000,600,'CLAIMED')").run();
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();
  let ready=false;
  for(let i=0;i<100;i++){
   try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}
  }
  assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await call('customer','/api/orders/order/reports','POST',{category:'SUSPICIOUS',details:'Laporan rahasia untuk peninjauan Pengelola.'})).status,200);
  const reports=await call('admin','/api/admin/reports');
  assert.equal(reports.status,200);
  const report=reports.data.reports[0];
  assert.equal(report.subject_id,'driver');
  assert.equal(report.subject_status,'ACTIVE');
  for(const user of ['','customer','driver','other']){
   const response=await call(user,'/api/admin/reports');
   assert.equal(response.status,user?403:401);
   assert.ok(!('reports' in response.data));
  }
  assert.ok(!JSON.stringify((await call('driver','/api/orders/mine')).data).includes(report.details));
  assert.equal((await call('driver','/api/orders/order/reports','POST',{category:'DANGER',details:'Laporan dari Penganjem untuk Pengelola.'})).status,200);
  const about=await call('admin','/api/admin/reports?scope=ABOUT_DRIVER');
  assert.equal(about.status,200);assert.equal(about.data.reports.length,1);
  assert.equal(about.data.reports[0].id,report.id);assert.equal(about.data.reports[0].subject_id,'driver');
  const byDriver=await call('admin','/api/admin/reports?scope=BY_DRIVER');
  assert.equal(byDriver.status,200);assert.equal(byDriver.data.reports.length,1);
  assert.equal(byDriver.data.reports[0].reporter_id,'driver');assert.equal(byDriver.data.reports[0].subject_id,'customer');
  assert.equal((await call('admin','/api/admin/reports')).data.reports.length,2);
  assert.equal((await call('admin','/api/admin/reports?scope=INVALID')).status,400);
  for(const scope of ['ABOUT_DRIVER','BY_DRIVER'])for(const user of ['','customer','driver']){
   const denied=await call(user,'/api/admin/reports?scope='+scope);
   assert.equal(denied.status,user?403:401);assert.ok(!('reports' in denied.data));
  }

  const url='/api/admin/users/driver/account-status';
  const freeze={status:'FROZEN',reason:'Akun ditinjau berdasarkan laporan.',report_id:report.id};
  for(const user of ['','customer','driver'])assert.equal((await call(user,url,'POST',freeze)).status,user?403:401);
  assert.equal((await call('admin',url,'POST',{...freeze,status:'INVALID'})).status,400);
  assert.equal((await call('admin',url,'POST',{...freeze,reason:''})).status,400);
  assert.equal((await call('admin',url,'POST',{...freeze,report_id:'missing'})).status,400);
  assert.equal((await call('admin','/api/admin/users/other/account-status','POST',freeze)).status,400);
  assert.equal((await call('admin','/api/admin/users/admin/account-status','POST',{...freeze,report_id:null})).status,403);
  assert.equal((await call('admin','/api/admin/users/missing/account-status','POST',freeze)).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_status_history').get().n,0);
  // An already-connected stream must stop when the admin freezes its account.
  streamController=new AbortController();
  const stream=await fetch(base+'/api/driver/stream',{headers:{Cookie:'anjemin_session=driver'},signal:streamController.signal});
  assert.equal(stream.status,200);
  const reader=stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
  assert.equal((await call('admin',url,'POST',freeze)).status,200);
  let ending='';
  while(true){const chunk=await reader.read();if(chunk.done)break;ending+=new TextDecoder().decode(chunk.value);}
  assert.match(ending,/account-frozen/);
  const frozen=db.prepare('SELECT account_status,ready,frozen_at,freeze_reason,driver_status FROM users WHERE id=?').get('driver');
  assert.equal(frozen.account_status,'FROZEN');assert.equal(frozen.ready,0);assert.ok(frozen.frozen_at);assert.equal(frozen.freeze_reason,freeze.reason);assert.equal(frozen.driver_status,'APPROVED');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='driver'").get().n,0);
  for(const token of ['driver','driver-second-device'])assert.equal((await call(token,'/api/driver/jobs')).status,401);
  assert.equal((await call('driver','/api/driver/ready','POST',{ready:true})).status,401);
  assert.equal((await call('','/api/auth/login','POST',{identifier:'driver',password})).status,403);
  assert.equal((await call('','/api/auth/login','POST',{identifier:'driver',password:'wrong'})).status,401);
  assert.equal((await call('driver','/api/auth/me')).data.user,null);
  // Even a stale session row cannot bypass the frozen-account check.
  session('driver','stale-session');
  assert.equal((await call('stale-session','/api/driver/wallet')).status,401);
  assert.equal((await call('admin',url,'POST',freeze)).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_status_history').get().n,1);
  const history=db.prepare('SELECT * FROM account_status_history').get();
  assert.equal(history.admin_id,'admin');assert.equal(history.user_id,'driver');assert.equal(history.report_id,report.id);assert.equal(history.previous_status,'ACTIVE');assert.equal(history.new_status,'FROZEN');
  assert.equal((await call('admin','/api/admin/reports')).data.reports.find(r=>r.id===report.id).subject_status,'FROZEN');
  assert.equal(db.prepare("SELECT status FROM service_orders WHERE id='order'").get().status,'CLAIMED');
  const reactivate={status:'ACTIVE',reason:'Peninjauan selesai dan akun dapat digunakan.',report_id:report.id};
  assert.equal((await call('customer',url,'POST',reactivate)).status,403);
  assert.equal((await call('admin',url,'POST',reactivate)).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_status_history').get().n,2);
  assert.equal((await call('driver','/api/driver/jobs')).status,401,'Revoked sessions must stay revoked after reactivation');
  const login=await call('','/api/auth/login','POST',{identifier:'driver',password});
  assert.equal(login.status,200);assert.ok(login.cookie);
  const token=login.cookie.match(/anjemin_session=([^;]+)/)[1];
  assert.equal((await call(token,'/api/driver/ready','POST',{ready:true})).status,200);
  // Customer accounts have the same freeze and login restrictions.
  const customerUrl='/api/admin/users/customer/account-status';
  assert.equal((await call('admin',customerUrl,'POST',freeze)).status,200);
  assert.equal((await call('customer','/api/orders','POST',{type:'RIDE'})).status,401);
  assert.equal((await call('','/api/auth/login','POST',{identifier:'customer',password})).status,403);
  assert.equal((await call('admin','/api/admin/users')).data.users.find(u=>u.id==='customer').account_status,'FROZEN');
  assert.equal((await call('admin',customerUrl,'POST',reactivate)).status,200);
  assert.equal((await call('','/api/auth/login','POST',{identifier:'customer',password})).status,200);
 }finally{
  streamController?.abort();
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
