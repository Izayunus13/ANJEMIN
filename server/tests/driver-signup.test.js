import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('driver signup requires rules consent, SIM type and private photo; uploads remain admin-only and failed registrations leave no documents',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-driver-signup-'));
 const uploads=path.join(folder,'uploads');
 process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');
 const port=56000+crypto.randomInt(3000),base='http://localhost:'+port;
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64');
 const photo='data:image/png;base64,'+png.toString('base64');
 let child;
 const signup={full_name:'Calon Penganjem',username:'penganjem_a',email:'penganjem_a@example.test',phone:'6281234567101',password:'DriverSignupTest123!',role:'DRIVER',campus_email:'penganjem@students.example.test',vehicle:'Honda Beat H 1234 XX',ktm_photo:photo,sim_type:'A',sim_photo:photo,sim_declared:true,driver_rules_accepted:true,driver_rules_version:'2026-10-26'};
 const verify=phone=>db.prepare("INSERT INTO signup_otp(phone,code_hash,expires_at,verified) VALUES(?,'test',?,1) ON CONFLICT(phone) DO UPDATE SET verified=1,expires_at=excluded.expires_at").run(phone,new Date(Date.now()+300000).toISOString());
 async function call(url,{cookie='',method='GET',body}={}){
  const r=await fetch(base+url,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const type=r.headers.get('content-type')||'';
  return {status:r.status,data:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0],type,cache:r.headers.get('cache-control')};
 }
 const register=body=>call('/api/auth/signup',{method:'POST',body});
 const files=()=>readdirSync(uploads).sort();
 try{
  // Existing approved accounts migrate without losing their verification status.
  db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,referral_code) VALUES('legacy','Legacy Driver','legacy','legacy@example.test','6281234567000','unused','DRIVER','APPROVED','LEGACY')").run();
  db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES('admin','Pengelola','admin','admin@example.test','6281234567001','unused','ADMIN','ADMIN')").run();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash('admin-token'),'admin',new Date(Date.now()+3600000).toISOString());
  const admin='anjemin_session=admin-token';
  verify(signup.phone);
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,ANJEMIN_UPLOAD_DIR:uploads,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>{logs+=c;});child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.ok(ready,'Server did not start: '+logs);
  for(const patch of [{driver_rules_accepted:'true'},{driver_rules_version:'outdated'},{sim_type:'B'},{sim_photo:null},{sim_photo:'data:image/png;base64,'+Buffer.from('not an image').toString('base64')},{sim_declared:'true'},{sim_photo:'data:image/png;base64,'+Buffer.alloc(4*1024*1024+1).toString('base64')}]){
   const result=await register({...signup,...patch});assert.equal(result.status,400,JSON.stringify(result.data));
   assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE username=?").get(signup.username).n,0);
   assert.deepEqual(files(),[],'Rejected signup must not leave a KTM or SIM file behind');
   assert.equal(db.prepare('SELECT verified FROM signup_otp WHERE phone=?').get(signup.phone).verified,1);
  }
  const unverified=await register({...signup,phone:'6281234567199'});assert.equal(unverified.status,400);assert.deepEqual(files(),[]);
  // Both photos may reach the documented 4 MB limit, including base64 overhead.
  const large=Buffer.alloc(4*1024*1024);png.copy(large);
  const largePhoto='data:image/png;base64,'+large.toString('base64');
  const first=await register({...signup,ktm_photo:largePhoto,sim_photo:largePhoto});assert.equal(first.status,200,JSON.stringify(first.data));
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(first.data.user.id);
  assert.equal(row.sim_type,'A');assert.equal(row.driver_status,'PENDING');assert.equal(row.sim_declared,1);
  const consent=db.prepare('SELECT rules_version,accepted_at FROM driver_rules_consents WHERE user_id=?').get(row.id);
  assert.equal(consent.rules_version,'2026-10-26');assert.ok(Number.isFinite(Date.parse(consent.accepted_at)));
  assert.match(row.sim_path,/^private-/);assert.match(row.ktm_path,/^private-/);assert.notEqual(row.sim_path,row.ktm_path);
  assert.equal(statSync(path.join(uploads,row.sim_path)).size,4*1024*1024);
  assert.equal(db.prepare('SELECT verified FROM signup_otp WHERE phone=?').get(signup.phone),undefined);
  assert.ok(!('sim_path' in first.data.user));assert.ok(!('ktm_path' in first.data.user));
  const c={...signup,username:'penganjem_c',email:'penganjem_c@example.test',phone:'6281234567102',sim_type:'C'};
  verify(c.phone);const second=await register(c);assert.equal(second.status,200);assert.equal(db.prepare('SELECT sim_type FROM users WHERE id=?').get(second.data.user.id).sim_type,'C');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM driver_rules_consents WHERE user_id=?').get(second.data.user.id).n,1);
  const beforeDuplicate=files();const duplicate={...signup,phone:'6281234567103'};verify(duplicate.phone);
  assert.equal((await register(duplicate)).status,409);assert.deepEqual(files(),beforeDuplicate,'Duplicate account must remove both new uploads');
  const customer={full_name:'Customer Pengguna',username:'customer',email:'customer@example.test',phone:'6281234567104',password:signup.password,role:'CUSTOMER',sim_type:'A',sim_photo:photo};
  verify(customer.phone);const buyer=await register(customer);assert.equal(buyer.status,200);
  const customerRow=db.prepare('SELECT sim_type,sim_path,ktm_path FROM users WHERE id=?').get(buyer.data.user.id);
  assert.deepEqual({...customerRow},{sim_type:null,sim_path:null,ktm_path:null});assert.deepEqual(files(),beforeDuplicate);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM driver_rules_consents WHERE user_id=?').get(buyer.data.user.id).n,0);
  for(const document of [row.sim_path,row.ktm_path]){
   const endpoint='/api/image/'+document;
   assert.equal((await call(endpoint)).status,401);
   for(const cookie of [first.cookie,second.cookie,buyer.cookie])assert.equal((await call(endpoint,{cookie})).status,403);
   const allowed=await call(endpoint,{cookie:admin});assert.equal(allowed.status,200);assert.equal(allowed.type,'image/png');assert.equal(allowed.cache,'no-store');
  }
  const overview=await call('/api/admin/overview',{cookie:admin});assert.equal(overview.status,200);
  const driver=overview.data.drivers.find(d=>d.id===row.id);assert.equal(driver.sim_type,'A');assert.equal(driver.sim_path,row.sim_path);
  const legacy=overview.data.drivers.find(d=>d.id==='legacy');assert.equal(legacy.driver_status,'APPROVED');assert.equal(legacy.sim_type,null);assert.equal(legacy.sim_path,null);
  const recap=await call('/api/admin/users',{cookie:admin});assert.equal(recap.data.users.find(u=>u.id===row.id).sim_type,'A');
  for(const cookie of [first.cookie,buyer.cookie])assert.equal((await call('/api/admin/overview',{cookie})).status,403);
  const me=(await call('/api/auth/me',{cookie:first.cookie})).data.user;assert.ok(!('sim_path' in me));
  const orphan='private-'+crypto.randomUUID()+'.png';writeFileSync(path.join(uploads,orphan),png);
  assert.equal((await call('/api/image/'+orphan,{cookie:admin})).status,404,'Unlinked private photos must not be served');
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  db.close();
  const resolved=path.resolve(folder),tempRoot=path.resolve(tmpdir())+path.sep;
  assert.ok(resolved.startsWith(tempRoot)&&path.basename(resolved).startsWith('anjemin-driver-signup-'));
  rmSync(resolved,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
