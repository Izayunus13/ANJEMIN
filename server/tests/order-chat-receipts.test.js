import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

test('order message receipts require recipient acknowledgements, remain private and durable, and advance without loading new messages',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-chat-receipts-'));
 process.env.ANJEMIN_DATA_DIR=folder;const {db}=await import('../src/db.js');
 const port=54000+crypto.randomInt(2000),base='http://localhost:'+port,hash=s=>crypto.createHash('sha256').update(s).digest('hex');let child;
 async function call(user,url,method='GET',body){
  const r=await fetch(base+url,{method,headers:{Cookie:user?'anjemin_session='+user:'','Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
 }
 const messages=(user,order='order',after=0)=>call(user,'/api/orders/'+order+'/messages?after='+after);
 const deliver=(user,ids)=>call(user,'/api/account/order-chat/delivered','POST',{message_ids:ids});
 const read=(user,ids,order='order')=>call(user,'/api/orders/'+order+'/messages/read','POST',{message_ids:ids});
 const row=id=>db.prepare('SELECT delivered_at,read_at FROM order_messages WHERE id=?').get(id);
 const send=async(user,order,body,extra={})=>{const r=await call(user,'/api/orders/'+order+'/messages','POST',{body,...extra});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.message_id;};
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER'],['admin','ADMIN']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(id),id,new Date(Date.now()+3600000).toISOString());
  }
  for(const id of ['order','second'])db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,status) VALUES(?,'customer','driver','RIDE','Pickup','Destination',10000,600,'CLAIMED')").run(id);
  child=spawn(process.execPath,['server/src/index.js'],{env:{...process.env,ANJEMIN_UPLOAD_DIR:path.join(folder,'uploads'),PORT:String(port),APP_URL:base,NODE_ENV:'development',ADMIN_EMAIL:'',ADMIN_PASSWORD:'GANTI_TEST_DISABLED',PAYMENT_MODE:'SIMULATION'},stdio:'pipe'});
  let logs='';child.stderr.on('data',c=>logs+=c);child.stdout.resume();let ready=false;
  for(let i=0;i<100;i++){try{await call('','/api/config');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Server did not start: '+logs);
  const first=await send('customer','order','Pesan pertama'),second=await send('customer','order','Pesan yang belum terlihat'),another=await send('customer','second','Pesan pesanan lain'),reply=await send('driver','order','Balasan Penganjem');
  assert.deepEqual({...row(first)},{delivered_at:null,read_at:null});
  const own=await messages('customer');assert.equal(own.data.receipts.length,2);assert.ok(own.data.receipts.every(r=>r.delivered_at===null&&r.read_at===null));
  assert.ok(own.data.messages.every(m=>'delivered_at' in m&&'read_at' in m));
  // Fetching data is separate from the browser acknowledging that it received it.
  assert.equal((await messages('driver')).status,200);assert.equal(row(first).delivered_at,null);
  const inbox=await call('driver','/api/account/order-chat/inbox');assert.deepEqual(inbox.data.messages.map(m=>m.id),[first,second,another]);assert.ok(inbox.data.messages.some(m=>m.body==='Pesan pertama'));
  assert.equal(row(first).delivered_at,null);assert.equal(row(first).read_at,null);
  assert.deepEqual((await call('other','/api/account/order-chat/inbox')).data.messages,[]);
  assert.equal((await call('','/api/account/order-chat/inbox')).status,401);assert.equal((await call('admin','/api/account/order-chat/inbox')).status,403);
  assert.equal((await deliver('',[first])).status,401);assert.equal((await deliver('admin',[first])).status,403);assert.equal((await deliver('customer',[first])).status,404);assert.equal((await deliver('other',[first])).status,404);
  assert.equal((await deliver('driver',[first,reply])).status,404);assert.equal(row(first).delivered_at,null,'Mixed unauthorized acknowledgements must roll back');
  for(const ids of [null,['1'],[-1],[1.2],Array(201).fill(first)])assert.equal((await deliver('driver',ids)).status,400);
  assert.equal((await deliver('driver',[])).status,200);
  const delivered=await deliver('driver',[first,first]);assert.equal(delivered.status,200);assert.equal(delivered.data.receipts.length,1);assert.ok(row(first).delivered_at);assert.equal(row(first).read_at,null);
  assert.deepEqual((await call('driver','/api/account/order-chat/inbox')).data.messages.map(m=>m.id),[second,another]);
  db.prepare("UPDATE order_messages SET delivered_at='2026-10-24 03:45:00' WHERE id=?").run(first);
  assert.equal((await deliver('driver',[first])).status,200);assert.equal(row(first).delivered_at,'2026-10-24 03:45:00');
  assert.equal((await read('customer',[first])).status,404);assert.equal((await read('other',[first])).status,404);assert.equal((await read('admin',[first])).status,404);assert.equal((await read('driver',[another])).status,404);assert.equal((await read('driver',[first,another])).status,404);assert.equal(row(first).read_at,null);
  const seen=await read('driver',[first]);assert.equal(seen.status,200);assert.ok(row(first).read_at);assert.equal(row(first).delivered_at,'2026-10-24 03:45:00');assert.equal(row(second).read_at,null,'An unseen message must not be marked read');
  db.prepare("UPDATE order_messages SET read_at='2026-10-24 03:46:00' WHERE id=?").run(first);assert.equal((await read('driver',[first])).status,200);assert.equal(row(first).read_at,'2026-10-24 03:46:00');
  assert.equal((await deliver('driver',[first])).status,200);assert.equal(row(first).read_at,'2026-10-24 03:46:00','Delivery acknowledgement must never downgrade a read message');
  const updates=await messages('customer','order',reply+10);assert.deepEqual(updates.data.messages,[]);assert.equal(updates.data.receipts.find(r=>r.id===first).read_at,'2026-10-24 03:46:00');assert.ok(!updates.data.receipts.some(r=>r.id===reply||r.id===another));
  assert.equal((await read('customer',[reply])).status,200);assert.ok(row(reply).delivered_at);assert.ok(row(reply).read_at,'Reading implies delivery');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
  const photo=await send('customer','order','',{media:png,request_id:crypto.randomUUID()});assert.equal((await read('driver',[photo])).status,200);assert.ok(row(photo).read_at);
  const photoMessage=(await messages('customer')).data.messages.find(m=>m.id===photo);assert.equal(photoMessage.media.kind,'image');assert.ok(photoMessage.read_at);
  db.prepare("UPDATE service_orders SET status='COMPLETED' WHERE id='order'").run();assert.equal((await read('driver',[second])).status,200);assert.ok(row(second).read_at,'Completed history can still be read');
  assert.equal((await deliver('driver',[first,second])).status,200);
  assert.equal((await read('driver',[])).status,200);assert.equal((await call('driver','/api/orders/order/messages/read','POST',null)).status,400);
  db.prepare("UPDATE users SET account_status='FROZEN' WHERE id='driver'").run();assert.equal((await deliver('driver',[another])).status,401);assert.equal((await call('driver','/api/account/order-chat/inbox')).status,401);assert.equal(row(another).read_at,null);
 }finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}db.close();
  const resolved=path.resolve(folder);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('anjemin-chat-receipts-'));
  rmSync(resolved,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;
 }
});
