import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('PostgreSQL supports accounts, permissions, persistent private media, order payments, and wallets', {timeout:120000}, async()=>{
 process.env.ANJEMIN_DB_DRIVER='pglite';
 process.env.NODE_ENV='development';
 process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';
 process.env.PAYMENT_MODE='SIMULATION';
 const {db,remoteDatabase}=await import('../src/db.js');
 const {hashPassword}=await import('../src/security.js');
 const {saveImage,loadImage}=await import('../src/upload.js');
 const {handleRequest}=await import('../src/index.js');
 const server=http.createServer(handleRequest);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 process.env.APP_URL=base;process.env.PORT=String(server.address().port);
 const cookies=new Map();
 async function call(who,url,body){
  const response=await fetch(base+url,{method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json',Cookie:cookies.get(who)||''},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const type=response.headers.get('Content-Type')||'';
  const data=type.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  const cookie=response.headers.get('set-cookie');if(cookie)cookies.set(who,cookie.split(';')[0]);
  return {status:response.status,data};
 }
 try{
  assert.equal(remoteDatabase,true);
  const password='Test-password-123';
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,?,?,'APPROVED',1,?)")
    .run(id,id,id,id+'@example.test',id,hashPassword(password),role,id);
   const login=await call(id,'/api/auth/login',{identifier:id.toUpperCase(),password});
   assert.equal(login.status,200,JSON.stringify(login.data));
   assert.equal((await call(id,'/api/auth/me')).data.user.id,id);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_numbers').get().n,3);
  assert.throws(()=>db.prepare("UPDATE users SET username='CUSTOMER' WHERE id='driver'").run(),/UNIQUE/);
  assert.equal((await call('customer','/api/admin/users')).status,403);
  assert.equal((await call('admin','/api/admin/users')).status,200);

  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
  const file=saveImage(image,'private');
  db.prepare('UPDATE users SET ktm_path=? WHERE id=?').run(file,'driver');
  assert.equal(db.prepare('SELECT name FROM stored_files WHERE name=?').get(file).name,file);
  assert.equal(loadImage(file).body.length,68);
  assert.equal((await call('customer','/api/image/'+file)).status,403);
  assert.equal((await call('admin','/api/image/'+file)).data.length,68);

  const created=await call('customer','/api/orders',{type:'RIDE',pickup:'Lokasi jemput',destination:'Lokasi tujuan',fare:10000});
  assert.equal(created.status,200,JSON.stringify(created.data));
  const order='/api/orders/'+created.data.order.id;
  assert.equal((await call('driver',order+'/claim',{})).status,200);
  const message=await call('customer',order+'/messages',{body:'Foto lokasi',media:image,request_id:'postgres-media-request-001'});
  assert.equal(message.status,200,JSON.stringify(message.data));
  const messages=await call('driver',order+'/messages');
  assert.equal(messages.status,200,JSON.stringify(messages.data));
  const media=messages.data.messages[0].media;
  assert.equal((await call('driver',media.url)).data.length,68);
  assert.equal((await call('admin',media.url)).status,404);
  assert.equal((await call('customer',order+'/payment',{})).status,200);
  assert.equal((await call('customer',order+'/payment/simulate',{})).status,200);
  assert.equal((await call('driver',order+'/delivered',{})).status,200);
  assert.equal((await call('customer',order+'/complete',{})).status,200);
  const wallet=await call('driver','/api/driver/wallet');
  assert.equal(wallet.status,200,JSON.stringify(wallet.data));
  assert.equal(wallet.data.available,9400);
  assert.equal((await call('admin','/api/admin/profits?mode=SIMULATION&period=ALL')).status,200);
  assert.equal((await call('driver','/api/driver/achievements')).status,200);
  assert.equal((await call('customer','/api/auth/logout',{})).status,200);
  assert.equal((await call('customer','/api/auth/me')).data.user,null);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  db.close();
 }
});
