import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('car rides require 1-7 passengers and preserve the selection in driver jobs, retries and order history',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-passengers-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.NODE_ENV='development';process.env.PAYMENT_MODE='SIMULATION';process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';
 const {db}=await import('../src/db.js'),{handleRequest}=await import('../src/index.js');
 const server=http.createServer(handleRequest);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;process.env.APP_URL=base;
 async function call(who,url,data){
  const response=await fetch(base+url,{method:data===undefined?'GET':'POST',headers:{Cookie:'anjemin_session='+who,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,data:await response.json()};
 }
 const body={type:'RIDE',vehicle_type:'MOBIL',pickup:'Gerbang kampus',destination:'Kos Melati',fare:10000};
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,driver_status,ready,referral_code) VALUES(?,?,?,?,?,'unused',?,'APPROVED',1,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  for(const invalid of [undefined,null,'',0,8,-1,1.5,'abc',true,[1]]){
   const r=await call('customer','/api/orders',{...body,passenger_count:invalid});
   assert.equal(r.status,400,JSON.stringify({invalid,response:r.data}));assert.match(r.data.error,/1.*7/);
  }
  const ids=[];
  for(let count=1;count<=7;count++){
   const created=await call('customer','/api/orders',{...body,passenger_count:count%2?String(count):count});
   assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.order.id;ids.push(id);
   assert.equal(db.prepare('SELECT passenger_count FROM service_orders WHERE id=?').get(id).passenger_count,count);
  }
  const jobs=(await call('driver','/api/driver/jobs')).data.orders;
  for(let i=0;i<7;i++)assert.equal(jobs.find(o=>o.id===ids[i]).passenger_count,i+1);
  const id=ids[6];
  db.prepare("UPDATE service_orders SET search_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(id);
  assert.equal((await call('customer','/api/orders/'+id+'/retry',{search_attempt:1})).status,200);
  assert.equal(db.prepare('SELECT passenger_count FROM service_orders WHERE id=?').get(id).passenger_count,7);
  assert.equal((await call('driver','/api/orders/'+id+'/claim',{})).status,200);
  for(const who of ['customer','driver'])assert.equal((await call(who,'/api/orders/mine')).data.orders.find(o=>o.id===id).passenger_count,7);
  const motor=await call('customer','/api/orders',{...body,vehicle_type:'MOTOR',passenger_count:7});assert.equal(motor.status,200);
  assert.equal(db.prepare('SELECT passenger_count FROM service_orders WHERE id=?').get(motor.data.order.id).passenger_count,null);
  const jastip=await call('customer','/api/orders',{...body,type:'JASTIP',item_name:'Nasi ayam',passenger_count:7});assert.equal(jastip.status,200);
  assert.equal(db.prepare('SELECT passenger_count FROM service_orders WHERE id=?').get(jastip.data.order.id).passenger_count,null);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});
  for(const key of ['ANJEMIN_DATA_DIR','NODE_ENV','PAYMENT_MODE'])delete process.env[key];
 }
});
