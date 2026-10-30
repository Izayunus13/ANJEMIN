import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pickupNavigation} from '../src/pickup-navigation.js';

test('pickup navigation uses exact pickup GPS, current device origin, vehicle mode and explicit address fallback',()=>{
 const user={id:'driver',role:'DRIVER'},order={id:'order',driver_id:'driver',status:'CLAIMED',pickup:'Gerbang kampus & pos satpam',pickup_lat:-7.058,pickup_lng:110.441,vehicle_type:'MOTOR'},paid={status:'HELD'};
 const nav=pickupNavigation(user,order,paid),url=new URL(nav.url);
 assert.equal(nav.source,'GPS');assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/maps/dir/');
 assert.equal(url.searchParams.get('destination'),'-7.058,110.441');assert.equal(url.searchParams.get('dir_action'),'navigate');
 assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('travelmode'),'two-wheeler');
 assert.equal(url.searchParams.has('origin'),false,'Maps must use device GPS, never an old driver sorting location');
 assert.equal(new URL(pickupNavigation(user,{...order,vehicle_type:'MOBIL'},paid).url).searchParams.get('travelmode'),'driving');
 for(const coords of [{pickup_lat:null},{pickup_lng:null},{pickup_lat:''},{pickup_lat:91},{pickup_lng:181},{pickup_lat:NaN}]){
  const fallback=pickupNavigation(user,{...order,...coords},paid);
  assert.equal(fallback.source,'ADDRESS');assert.equal(new URL(fallback.url).searchParams.get('destination'),order.pickup);
 }
 assert.equal(new URL(pickupNavigation(user,{...order,pickup_lat:0,pickup_lng:0},paid).url).searchParams.get('destination'),'0,0');
 for(const status of ['OPEN','COMPLETED','CANCELLED'])assert.equal(pickupNavigation(user,{...order,status},paid),null);
 for(const status of ['CREATING','PENDING','EXPIRED','FAILED','RELEASED'])assert.equal(pickupNavigation(user,order,{status}),null);
 assert.equal(pickupNavigation(user,order,null),null);
 assert.equal(pickupNavigation(user,{...order,delivery_reported_at:'2026-10-30 10:00:00'},paid),null);
 assert.equal(pickupNavigation({...user,id:'other'},order,paid),null);
 assert.equal(pickupNavigation({...user,role:'CUSTOMER'},order,paid),null);
 assert.equal(pickupNavigation(user,{...order,pickup_lat:null,pickup:''},paid),null);
});

test('order API exposes pickup navigation only to the assigned driver after payment and withdraws it after delivery',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-pickup-route-'));
 process.env.ANJEMIN_DATA_DIR=folder;process.env.NODE_ENV='development';process.env.ADMIN_PASSWORD='GANTI_TEST_DISABLED';
 const {db}=await import('../src/db.js'),{handleRequest}=await import('../src/index.js');
 const server=http.createServer(handleRequest);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function orders(who){
  const response=await fetch(base+'/api/orders/mine',{headers:{Cookie:'anjemin_session='+who}});
  return {status:response.status,data:await response.json()};
 }
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','DRIVER']]){
   db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,role,id);
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(id).digest('hex'),id,new Date(Date.now()+3600000).toISOString());
  }
  db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,pickup_lat,pickup_lng,destination_lat,destination_lng,fare,platform_fee,status,payment_required) VALUES('pickup-order','customer','driver','RIDE','Gerbang kampus','Kos Melati',-7.058,110.441,-7.07,110.45,10000,600,'CLAIMED',1)").run();
  db.prepare("INSERT INTO payments(id,order_id,mode,amount,status,expires_at) VALUES('pickup-payment','pickup-order','SIMULATION',10000,'PENDING','2030-01-01T00:00:00Z')").run();
  assert.equal((await orders('')).status,401);assert.equal((await orders('other')).data.orders.length,0);
  assert.equal((await orders('driver')).data.orders[0].pickup_navigation,null);
  db.prepare("UPDATE payments SET status='HELD' WHERE id='pickup-payment'").run();
  const mine=(await orders('driver')).data.orders[0];
  assert.equal(mine.pickup_navigation.source,'GPS');
  assert.equal(new URL(mine.pickup_navigation.url).searchParams.get('destination'),'-7.058,110.441','Use pickup, not drop-off');
  assert.equal((await orders('customer')).data.orders[0].pickup_navigation,null);
  db.prepare("UPDATE service_orders SET delivery_reported_at=CURRENT_TIMESTAMP WHERE id='pickup-order'").run();
  assert.equal((await orders('driver')).data.orders[0].pickup_navigation,null);
  db.prepare("UPDATE service_orders SET delivery_reported_at=NULL,status='CANCELLED' WHERE id='pickup-order'").run();
  assert.equal((await orders('driver')).data.orders[0].pickup_navigation,null);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
  rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;delete process.env.NODE_ENV;
 }
});
