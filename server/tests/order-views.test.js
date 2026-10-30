import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('order list fetches payments and public identities in one query regardless of order count',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-order-views-'));process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js'),{orderViews}=await import('../src/order-views.js');
 const prepare=db.prepare.bind(db);let calls=0;
 try{
  for(const [id,role] of [['customer','CUSTOMER'],['driver','DRIVER'],['other','CUSTOMER']])db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'private-password',?,?)").run(id,id,id,'private-'+id+'@example.test','private-'+id,role,id);
  for(let i=0;i<25;i++){
   db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,status) VALUES(?,'customer','driver','RIDE','Pickup','Destination',10000,600,'CLAIMED')").run('order-'+i);
   db.prepare("INSERT INTO payments(id,order_id,mode,amount,status,expires_at) VALUES(?,?,'SIMULATION',10000,'HELD','2030-01-01T00:00:00Z')").run('payment-'+i,'order-'+i);
  }
  db.prepare=(sql)=>{calls++;return prepare(sql);};
  const rows=orderViews({id:'customer'});
  assert.equal(rows.length,25);assert.equal(calls,1,'Avoid one payment/profile query per order');
  assert.ok(rows.every(o=>o.payment.status==='HELD'&&o.customer_profile.id==='customer'&&o.driver_profile.id==='driver'));
  const serialized=JSON.stringify(rows);
  for(const field of ['private-password','private-customer','private-driver','public_'])assert.ok(!serialized.includes(field),'Do not expose private or internal projection fields');
  assert.equal(orderViews({id:'other'}).length,0);
 }finally{db.prepare=prepare;db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;}
});
