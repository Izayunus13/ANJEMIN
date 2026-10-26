import {db} from './db.js';
import {apiError,uuid} from './security.js';
import {paymentMode} from './payments.js';

// One-time lifetime milestones. Live reward funding is not enabled by this simulation.
const milestones=Object.freeze([
 {id:'RIDE_10',target:10,amount:5000,title:'Langkah Awal'},
 {id:'RIDE_25',target:25,amount:7500,title:'Makin Andal'},
 {id:'RIDE_50',target:50,amount:10000,title:'Andalan Kampus'},
 {id:'RIDE_100',target:100,amount:15000,title:'Penganjem Pro'},
 {id:'RIDE_250',target:250,amount:25000,title:'Bintang Kampus'},
 {id:'RIDE_500',target:500,amount:50000,title:'Legenda ANJEMIN'}
].map(Object.freeze));
const simulationEnabled=()=>paymentMode()==='SIMULATION'&&process.env.NODE_ENV!=='production';
function driverAccount(id){
 const u=db.prepare("SELECT role,driver_status,account_status FROM users WHERE id=?").get(id);
 if(!u||u.role!=='DRIVER'||u.account_status!=='ACTIVE')throw apiError('Akses pencapaian tidak diizinkan.',403);
 return u;
}
function completedRides(driverId,mode){
 return db.prepare(`SELECT COUNT(*) AS total FROM service_orders o
 JOIN payments p ON p.order_id=o.id
 JOIN wallet_credits c ON c.order_id=o.id AND c.payment_id=p.id AND c.driver_id=o.driver_id AND c.mode=p.mode
 WHERE o.driver_id=? AND o.customer_id<>o.driver_id AND o.type='RIDE' AND o.status='COMPLETED'
 AND datetime(o.completed_at)<=datetime('now') AND p.status='RELEASED' AND p.mode=?`).get(driverId,mode).total;
}
export function driverAchievements(driverId){
 const u=driverAccount(driverId),mode=paymentMode(),completed=completedRides(driverId,mode);
 const claims=db.prepare('SELECT milestone,amount,created_at FROM driver_achievement_rewards WHERE driver_id=? AND mode=?').all(driverId,mode);
 const claimed=new Map(claims.map(r=>[r.milestone,r]));
 const eligible=u.driver_status==='APPROVED',enabled=simulationEnabled();
 const rows=milestones.map(m=>({...m,progress:Math.min(completed,m.target),remaining:Math.max(0,m.target-completed),
  claimed_at:claimed.get(m.id)?.created_at||null,status:claimed.has(m.id)?'CLAIMED':completed>=m.target?'READY':'LOCKED',
  canClaim:enabled&&eligible&&!claimed.has(m.id)&&completed>=m.target}));
 return {mode,simulationEnabled:enabled,eligible,completed,claimedTotal:claims.reduce((sum,r)=>sum+r.amount,0),
  claimableTotal:rows.filter(r=>r.canClaim).reduce((sum,r)=>sum+r.amount,0),
  nextMilestone:rows.find(r=>r.status==='LOCKED')||null,milestones:rows};
}
export function claimDriverAchievement(driverId,milestoneId){
 if(!simulationEnabled())throw apiError('Klaim reward hanya tersedia dalam simulasi.',403);
 const milestone=milestones.find(m=>m.id===milestoneId);
 if(!milestone)throw apiError('Target pencapaian tidak ditemukan.',404);
 db.exec('BEGIN IMMEDIATE');
 try{
  const u=driverAccount(driverId),mode=paymentMode();
  if(u.driver_status!=='APPROVED')throw apiError('Tunggu persetujuan Pengelola sebelum klaim reward.',403);
  let reward=db.prepare('SELECT * FROM driver_achievement_rewards WHERE driver_id=? AND milestone=? AND mode=?').get(driverId,milestone.id,mode);
  const alreadyClaimed=!!reward;
  if(!reward){
   if(completedRides(driverId,mode)<milestone.target)throw apiError('Jumlah anjeman selesai belum mencapai target.',409);
   const id=uuid();
   db.prepare('INSERT INTO driver_achievement_rewards(id,driver_id,milestone,target,title,amount,mode) VALUES(?,?,?,?,?,?,?)')
    .run(id,driverId,milestone.id,milestone.target,milestone.title,milestone.amount,mode);
   reward=db.prepare('SELECT * FROM driver_achievement_rewards WHERE id=?').get(id);
  }
  db.exec('COMMIT');return {reward,alreadyClaimed};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
