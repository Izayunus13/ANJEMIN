import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('order chat supports private media with an atomic shared 3 MB limit, retries, video ranges, and completed-order history',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-order-chat-')),uploads=path.join(folder,'uploads');
 process.env.ANJEMIN_DATA_DIR=folder;const {db}=await import('../src/db.js');
 const port=57000+crypto.randomInt(2500),base='http://localhost:'+port,hash=s=>crypto.createHash('sha256').update(s).digest('hex');let child;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64');
 function image(size=png.length){const b=Buffer.alloc(size);png.copy(b);return 'data:image/png;base64,'+b.toString('base64');}
 const send=(user,id,body='',media,request_id=crypto.randomUUID())=>call(user,'/api/orders/'+id+'/messages','POST',{body,...(media!==undefined?{media,request_id}:{})});
 async function call(user,url,method='GET',body,headers={}){
  const r=await fetch(base+url,{method,headers:{Cookie:user?'anjemin_session='+user:'','Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const type=r.headers.get('content-type')||'';return {status:r.status,data:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers};
 }
 const chat=(user,id,after=0)=>call(user,'/api/orders/'+id+'/messages?after='+after);
 function order(id,status='CLAIMED'){db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,status) VALUES(?,'customer','driver','RIDE','Pickup','Destination',10000,600,?)").run(id,status);}
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(id),id,new Date(Date.now()+3600000).toISOString());
  }
  for(const id of ['order','other-order','race','video','rollback'])order(id);
  order('completed','COMPLETED');
  db.prepare("INSERT INTO order_messages(order_id,sender_id,body,created_at) VALUES('order','driver','Pesan lama tetap tersimpan','2026-10-24 03:45:13')").run();
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,ANJEMIN_UPLOAD_DIR:uploads,PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>logs+=c);child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await chat('','order')).status,401);
  for(const who of ['other','admin']){assert.equal((await chat(who,'order')).status,404);assert.equal((await send(who,'order','Rahasia')).status,404);}
  const old=await chat('customer','order');assert.equal(old.status,200);assert.equal(old.data.messages[0].body,'Pesan lama tetap tersimpan');assert.equal(old.data.messages[0].media,null);assert.equal(old.data.media_usage.limit,3145728);
  assert.equal((await send('customer','order')).status,400);assert.equal((await send('customer','order','x'.repeat(1001))).status,400);
  assert.equal((await send('customer','order','',image(3145729))).status,400);
  assert.equal((await send('customer','order','','data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64'))).status,400);
  assert.equal((await send('customer','order','','data:image/jpeg;base64,'+png.toString('base64'))).status,400);
  assert.equal((await send('customer','order','',image(),'bad')).status,400);assert.deepEqual(readdirSync(uploads),[]);
  assert.equal((await send('customer','order','Halo, saya di gerbang kampus.')).status,200);
  const key=crypto.randomUUID(),media=image(2*1024*1024),first=await send('customer','order','Ini posisi jemput saya.',media,key);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.media_usage.used,2097152);
  const retry=await send('customer','order','Ini posisi jemput saya.',media,key);assert.equal(retry.status,200);assert.equal(retry.data.message_id,first.data.message_id);
  assert.equal((await send('customer','order','Caption berbeda',media,key)).status,409);
  const messages=await chat('driver','order');const photo=messages.data.messages.find(m=>m.id===first.data.message_id);
  assert.equal(photo.sender_id,'customer');assert.equal(photo.media.kind,'image');assert.equal(photo.media.size,2097152);assert.equal(photo.media_only,0);
  const url=photo.media.url;assert.match(url,/^\/api\/orders\/order\/media\/chat-/);
  for(const who of ['customer','driver']){const r=await call(who,url);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.data.length,2097152);}
  assert.equal((await call('',url)).status,401);assert.equal((await call('other',url)).status,404);assert.equal((await call('admin',url)).status,404);
  assert.equal((await call('customer',url.replace('/order/','/other-order/'))).status,404);
  assert.equal((await call('customer','/api/image/'+url.split('/').at(-1))).status,404);
  const second=await send('driver','order','',image(1024*1024));assert.equal(second.status,200);assert.equal(second.data.media_usage.used,3145728);
  const only=(await chat('customer','order',first.data.message_id)).data.messages[0];assert.equal(only.media_only,1);assert.equal(only.media.kind,'image');
  const filesBefore=readdirSync(uploads).sort();assert.equal((await send('customer','order','',image())).status,409);assert.deepEqual(readdirSync(uploads).sort(),filesBefore);
  assert.equal((await send('driver','order','Kuota penuh, teks tetap dapat dikirim.')).status,200);
  assert.equal((await chat('customer','other-order')).data.media_usage.used,0);
  const raced=await Promise.all([send('customer','race','',media),send('driver','race','',media)]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);assert.equal((await chat('customer','race')).data.media_usage.used,2097152);
  // A minimal MP4 ftyp header exercises typed delivery and range responses.
  const mp4=Buffer.alloc(24);mp4.writeUInt32BE(24,0);mp4.write('ftyp',4);mp4.write('isom',8);mp4.write('isom',16);mp4.write('mp42',20);
  assert.equal((await send('driver','video','Video lokasi','data:video/mp4;base64,'+mp4.toString('base64'))).status,200);
  const video=(await chat('customer','video')).data.messages[0].media;assert.equal(video.kind,'video');
  const ranged=await call('customer',video.url,'GET',undefined,{Range:'bytes=4-11'});assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 4-11/24');assert.deepEqual(ranged.data,mp4.subarray(4,12));
  assert.equal((await call('driver',video.url,'GET',undefined,{Range:'bytes=99-'})).status,416);
  const suffix=await call('driver',video.url,'GET',undefined,{Range:'bytes=-4'});assert.equal(suffix.status,206);assert.deepEqual(suffix.data,mp4.subarray(20));
  const webm=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.from('webm')]);assert.equal((await send('customer','video','','data:video/webm;base64,'+webm.toString('base64'))).status,200);
  assert.equal((await send('customer','video','','data:video/webm;base64,'+Buffer.from('not webm').toString('base64'))).status,400);
  // A database failure must roll back both the new message and its newly written file.
  db.exec("CREATE TRIGGER reject_test_media BEFORE INSERT ON order_message_media WHEN NEW.order_id='rollback' BEGIN SELECT RAISE(ABORT,'reject test media'); END;");
  const before=readdirSync(uploads).sort();assert.equal((await send('customer','rollback','',image())).status,500);assert.equal(db.prepare("SELECT COUNT(*) n FROM order_messages WHERE order_id='rollback'").get().n,0);assert.deepEqual(readdirSync(uploads).sort(),before);
  assert.equal((await send('customer','completed','Pesan terlambat')).status,409);
  db.prepare("UPDATE service_orders SET status='COMPLETED' WHERE id='order'").run();assert.equal((await send('driver','order','Pesan terlambat')).status,409);
  assert.equal((await call('customer',url)).status,200);assert.equal((await chat('driver','order')).status,200);assert.equal((await send('customer','order','Ini posisi jemput saya.',media,key)).status,200);
  assert.equal((await chat('customer','order',-1)).status,400);
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='customer'").run();assert.equal((await call('customer',url)).status,401);
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}db.close();
  const resolved=path.resolve(folder);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('anjemin-order-chat-'));
  rmSync(resolved,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
