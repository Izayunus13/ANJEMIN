import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('profit statistics isolate payment modes, account for vouchers, and group completed transactions by WIB',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'anjemin-profit-'));
 process.env.ANJEMIN_DATA_DIR=folder;
 const {db}=await import('../src/db.js');
 const {profitStatistics}=await import('../src/analytics.js');
 const now=new Date('2026-10-23T06:00:00Z');
 const stats=(mode='SIMULATION',period='7')=>profitStatistics({mode,period,now});
 try{
  assert.equal(stats().totals.transactions,0);assert.equal(stats().series.length,7);
  assert.equal(stats('SIMULATION','ALL').series.length,1);
  for(const id of ['customer','driver'])db.prepare("INSERT INTO users(id,full_name,username,email,phone,password_hash,role,referral_code) VALUES(?,?,?,?,?,'unused',?,?)").run(id,id,id,id+'@example.test',id,id==='driver'?'DRIVER':'CUSTOMER',id);
  function order(id,{mode='SIMULATION',type='RIDE',fare=10000,fee=600,promo=0,date='2026-10-23 05:00:00',status='COMPLETED',payment='RELEASED'}={}){
   db.prepare("INSERT INTO service_orders(id,customer_id,driver_id,type,pickup,destination,fare,platform_fee,promo_discount,status,completed_at,payment_required) VALUES(?,'customer','driver',?,'Pickup','Destination',?,?,?,?,?,1)").run(id,type,fare,fee,promo,status,date);
   db.prepare('INSERT INTO payments(id,order_id,mode,amount,status,expires_at) VALUES(?,?,?,?,?,?)').run(id,id,mode,Math.max(0,fare-promo),payment,'2026-10-24T00:00:00Z');
  }
  order('ride',{date:'2026-10-16 17:00:00',promo:100});
  order('before-cutoff',{date:'2026-10-16 16:59:59',fare:20000,fee:1200});
  order('delivery',{type:'DELIVERY',fare:1000,fee:60,promo:500,date:'2026-10-22T18:00:00Z'});
  order('jastip',{type:'JASTIP',fare:5000,fee:300});
  order('sandbox',{mode:'MIDTRANS_SANDBOX',fare:15000,fee:900});
  order('live',{mode:'MIDTRANS_LIVE',fare:30000,fee:1800,promo:200});
  order('future',{date:'2026-10-24 05:00:00'});
  order('held',{payment:'HELD'});order('cancelled',{status:'CANCELLED'});order('active',{status:'CLAIMED',payment:'HELD'});
  order('old',{fare:1000,fee:60,date:'2025-12-01 05:00:00'});
  db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,collected,mode) VALUES('duplicate','SERVICE','ride',600,100,100,'SIMULATION')").run();
  db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,collected,mode) VALUES('live-ledger','SERVICE','live',1800,200,1000,'MIDTRANS_LIVE')").run();
  for(const [id,price,mode,fee,collected] of [['market',20000,'SIMULATION',600,200],['legacy',10000,'LEGACY',300,0]]){
   db.prepare("INSERT INTO listings(id,seller_id,title,category,price,agreed_price,description,image_path,status) VALUES(?,'driver','Item','Buku',?,?,'Description','test.png','SOLD')").run(id,price,price);
   db.prepare("INSERT INTO ledger(id,source_type,source_id,gross_fee,promo_cost,collected,created_at,mode) VALUES(?,'MARKET',?,?,0,?,'2026-10-22 10:00:00',?)").run(id,id,fee,collected,mode);
  }
  const recent=stats();
  assert.equal(recent.start,'2026-10-17');assert.equal(recent.end,'2026-10-23');assert.equal(recent.timezone,'Asia/Jakarta');
  assert.deepEqual(recent.totals,{transactions:4,volume:36000,commission:1560,promo:600,rewards:0,collected:1160,outstanding:400,profit:960});
  assert.equal(recent.series[0].transactions,1,'00:00 WIB on the starting day must be included');
  assert.equal(recent.series.at(-1).profit,-140,'Losses from vouchers must remain negative');
  assert.equal(recent.services.find(r=>r.service==='DELIVERY').profit,-440);
  for(const key of Object.keys(recent.totals)){
   assert.equal(recent.services.reduce((n,row)=>n+row[key],0),recent.totals[key]);
   assert.equal(recent.series.reduce((n,row)=>n+row[key],0),recent.totals[key]);
  }
  assert.equal(stats('SIMULATION','30').totals.transactions,5);
  assert.equal(stats('SIMULATION','90').totals.transactions,5);
  const all=stats('SIMULATION','ALL');assert.equal(all.granularity,'month');assert.equal(all.series.length,11);assert.equal(all.totals.transactions,6);assert.equal(all.totals.profit,2220);
  assert.deepEqual(stats('MIDTRANS_LIVE').totals,{transactions:1,volume:30000,commission:1800,promo:200,rewards:0,collected:1000,outstanding:800,profit:1600});
  assert.equal(stats('MIDTRANS_SANDBOX').totals.commission,900);
  assert.equal(stats('LEGACY').totals.transactions,1);assert.equal(stats('LEGACY').totals.commission,300);
  assert.throws(()=>stats('INVALID'),/Filter statistik/);assert.throws(()=>stats('SIMULATION','0'),/Filter statistik/);
 }finally{db.close();rmSync(folder,{recursive:true,force:true});delete process.env.ANJEMIN_DATA_DIR;}
});
