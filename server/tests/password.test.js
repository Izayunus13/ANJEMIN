import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import crypto from 'node:crypto';

test('password change verifies credentials, preserves current session and revokes other sessions',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-password-'));
 process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');
 const {hashPassword,verifyPassword,sha256}=await import('../src/security.js');
 const port=53000+crypto.randomInt(2000),base='http://localhost:'+port;
 let child;
 async function call(url,body,token='current'){
  const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:token?'anjemin_session='+token:''},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json()};
 }
 try{
  db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES('password-user','Password User','passworduser','password@example.test','6281234567890',?,'CUSTOMER','PASSWORD')").run(hashPassword('old-password-123'));
  for(const token of ['current','other'])db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token),'password-user',new Date(Date.now()+3600000).toISOString());
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED'},stdio:'ignore'});
  let ready=false;
  for(let i=0;i<100;i++){try{await fetch(base+'/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready,'server ready');
  const body={current_password:'old-password-123',new_password:'new-password-456',confirm_password:'new-password-456'};
  assert.equal((await call('/api/account/password',body,'')).status,401);
  assert.equal((await call('/api/account/password',{...body,current_password:'wrong'})).status,400);
  assert.equal((await call('/api/account/password',{...body,new_password:'short',confirm_password:'short'})).status,400);
  assert.equal((await call('/api/account/password',{...body,confirm_password:'mismatch-password'})).status,400);
  assert.equal((await call('/api/account/password',{...body,new_password:body.current_password,confirm_password:body.current_password})).status,400);
  assert.ok(verifyPassword('old-password-123',db.prepare("SELECT password_hash FROM users WHERE id='password-user'").get().password_hash));
  assert.equal((await call('/api/account/password',body)).status,200);
  assert.ok((await call('/api/auth/me')).data.user);
  assert.equal((await call('/api/auth/me',undefined,'other')).data.user,null);
  assert.equal((await call('/api/auth/login',{identifier:'passworduser',password:'old-password-123'},'')).status,401);
  assert.equal((await call('/api/auth/login',{identifier:'passworduser',password:'new-password-456'},'')).status,200);
 }finally{
  if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
  db.close();rmSync(folder,{recursive:true,force:true});
 }
});
