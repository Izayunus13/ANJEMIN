import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('profiles require new-account completion, protect contacts and avatars, and verify changed phone numbers',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-account-profile-')),uploads=path.join(folder,'uploads');
 process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');
 const port=51000+crypto.randomInt(3000),base='http://localhost:'+port,hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64'),photo='data:image/png;base64,'+png.toString('base64');
 let child;
 async function call(user,url,method='GET',body){
  const r=await fetch(base+url,{method,headers:{Cookie:user?'anjemin_session='+user:'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const type=r.headers.get('content-type')||'';return {status:r.status,data:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),cache:r.headers.get('cache-control')};
 }
 const form={full_name:'Nama Customer',username:'customer',email:'customer@example.test',phone:'6281234567201'};
 const save=(user,b)=>call(user,'/api/account/profile','POST',b);
 const otp=(phone,verified=1,expires=Date.now()+300000)=>db.prepare("INSERT INTO signup_otp(phone,code_hash,expires_at,verified) VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET verified=excluded.verified,expires_at=excluded.expires_at").run(phone,hash('123456'),new Date(expires).toISOString(),verified);
 try{
  for(const [id,role,phone,required] of [['customer','CUSTOMER',form.phone,1],['driver','DRIVER','6281234567202',1],['legacy','CUSTOMER','6281234567203',0],['admin','ADMIN','6281234567204',0]]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,referral_code,profile_required) VALUES(?,?,?,?,?,'unused',?,'PENDING',?,?)").run(id,'Nama '+id,id,id+'@example.test',phone,role,id,required);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(id),id,new Date(Date.now()+3600000).toISOString());
  }
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,ANJEMIN_UPLOAD_DIR:uploads,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await call('','/api/account/profile')).status,401);assert.equal((await call('admin','/api/account/profile')).status,403);
  const incomplete=await call('customer','/api/auth/me');assert.equal(incomplete.data.user.profile_complete,false);
  assert.equal((await call('legacy','/api/auth/me')).data.user.profile_complete,true);
  for(const [user,url] of [['customer','/api/orders'],['customer','/api/listings'],['driver','/api/driver/ready']]){
   const denied=await call(user,url,'POST',{});assert.equal(denied.status,409);assert.equal(denied.data.code,'PROFILE_INCOMPLETE');
  }
  assert.equal((await save('customer',form)).status,400);
  assert.equal((await save('customer',{...form,photo:'data:image/png;base64,'+Buffer.from('wrong').toString('base64')})).status,400);
  assert.deepEqual(readdirSync(uploads),[]);
  for(const patch of [{full_name:''},{username:'invalid space'},{email:'invalid'},{phone:'123'}])assert.equal((await save('customer',{...form,photo,...patch})).status,400);
  const first=await save('customer',{...form,photo,id:'driver',role:'ADMIN',driver_status:'APPROVED',profile_complete:true});
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.user.profile_complete,true);assert.equal(first.data.user.role,'CUSTOMER');assert.equal(first.data.user.id,'customer');
  const avatar=first.data.user.profile_photo_path;assert.match(avatar,/^avatar-/);assert.ok(existsSync(path.join(uploads,avatar)));
  const row=db.prepare("SELECT * FROM users WHERE id='customer'").get();assert.ok(row.profile_completed_at);assert.equal(row.ktm_path,null);assert.equal(row.sim_path,null);
  assert.equal((await call('','/api/image/'+avatar)).status,401);
  const shared=await call('driver','/api/image/'+avatar);assert.equal(shared.status,200);assert.equal(shared.cache,'no-store');assert.deepEqual(shared.data,png);
  const publicProfile=await call('driver','/api/users/customer/profile');assert.equal(publicProfile.status,200);
  assert.deepEqual(Object.keys(publicProfile.data.profile).sort(),['id','full_name','username','role','driver_status','profile_photo_path'].sort());
  assert.ok(!JSON.stringify(publicProfile.data).includes(form.email));assert.ok(!JSON.stringify(publicProfile.data).includes(form.phone));
  assert.equal((await call('','/api/users/customer/profile')).status,401);assert.equal((await call('customer','/api/users/admin/profile')).status,404);
  // Completing the profile opens transaction creation.
  const order=await call('customer','/api/orders','POST',{type:'RIDE',pickup:'Gerbang kampus',destination:'Perpustakaan kampus',fare:10000});assert.equal(order.status,200,JSON.stringify(order.data));
  assert.equal((await call('customer','/api/orders/mine')).data.orders[0].customer_profile.full_name,form.full_name);
  // Conflicting identifiers and invalid files leave the saved profile and photo intact.
  const filesBefore=readdirSync(uploads).sort();assert.equal((await save('customer',{...form,photo,username:'driver'})).status,409);assert.deepEqual(readdirSync(uploads).sort(),filesBefore);
  const newPhone='6281234567299';assert.equal((await save('customer',{...form,phone:newPhone})).status,400);
  otp(newPhone,0);assert.equal((await save('customer',{...form,phone:newPhone})).status,400);
  assert.equal((await call('customer','/api/auth/otp/verify','POST',{phone:newPhone,code:'123456'})).status,200);
  const changed=await save('customer',{...form,phone:newPhone});assert.equal(changed.status,200);assert.equal(changed.data.user.phone,newPhone);assert.equal(db.prepare('SELECT * FROM signup_otp WHERE phone=?').get(newPhone),undefined);
  const expired='6281234567298';otp(expired,1,Date.now()-1000);assert.equal((await save('customer',{...form,phone:expired})).status,400);
  const replacement=await save('customer',{...form,phone:newPhone,photo,full_name:'Nama Baru Customer'});assert.equal(replacement.status,200);
  assert.notEqual(replacement.data.user.profile_photo_path,avatar);assert.ok(!existsSync(path.join(uploads,avatar)));assert.equal((await call('driver','/api/image/'+avatar)).status,404);
  assert.equal((await call('driver','/api/users/customer/profile')).data.profile.full_name,'Nama Baru Customer');
  const driverForm={full_name:'Nama Penganjem',username:'driver',email:'driver@example.test',phone:'6281234567202',photo};assert.equal((await save('driver',driverForm)).status,200);
  assert.equal(db.prepare("SELECT driver_status FROM users WHERE id='driver'").get().driver_status,'PENDING');
  db.prepare("UPDATE service_orders SET driver_id='driver',status='CLAIMED' WHERE id=?").run(order.data.order.id);
  const own=(await call('customer','/api/orders/mine')).data.orders[0];assert.equal(own.driver_profile.full_name,driverForm.full_name);assert.ok(!('phone' in own.driver_profile));
  const chat=await call('driver','/api/orders/'+order.data.order.id+'/messages');assert.equal(chat.status,200);assert.equal(chat.data.order.customer_profile.full_name,'Nama Baru Customer');
  // A real signup starts incomplete even when registration already collected contact fields.
  const signupPhone='6281234567288';otp(signupPhone);
  const signup=await call('','/api/auth/signup','POST',{full_name:'Customer Pendaftaran',username:'signup_customer',email:'signup@example.test',phone:signupPhone,password:'SignupProfileTest123!',role:'CUSTOMER'});
  assert.equal(signup.status,200);assert.equal(signup.data.user.profile_complete,false);assert.equal(db.prepare('SELECT profile_required FROM users WHERE id=?').get(signup.data.user.id).profile_required,1);
  const orphan='avatar-'+crypto.randomUUID()+'.png';writeFileSync(path.join(uploads,orphan),png);assert.equal((await call('customer','/api/image/'+orphan)).status,404);
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='customer'").run();assert.equal((await save('customer',{...form,phone:newPhone})).status,401);
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}db.close();
  const resolved=path.resolve(folder);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('anjemin-account-profile-'));
  rmSync(resolved,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
