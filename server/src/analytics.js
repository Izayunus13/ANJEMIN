import {db} from './db.js';
import {apiError} from './security.js';

export const profitModes=['SIMULATION','MIDTRANS_SANDBOX','MIDTRANS_LIVE','LEGACY'];
export function commissionEntries(mode){
 return db.prepare(`
 SELECT COALESCE(l.id,o.id) AS id,'SERVICE' AS source_type,o.id AS source_id,o.type AS service,
 o.fare AS volume,o.platform_fee AS gross_fee,o.promo_discount AS promo_cost,
 CASE WHEN p.mode IN ('SIMULATION','MIDTRANS_SANDBOX') THEN o.platform_fee ELSE COALESCE(l.collected,0) END AS collected,
 o.completed_at AS created_at,p.mode
 FROM service_orders o JOIN payments p ON p.order_id=o.id
 LEFT JOIN ledger l ON l.source_type='SERVICE' AND l.source_id=o.id
 WHERE o.status='COMPLETED' AND p.status='RELEASED' AND p.mode=?
 UNION ALL
 SELECT l.id,l.source_type,l.source_id,
 CASE WHEN l.source_type='SERVICE' THEN COALESCE(o.type,'SERVICE') ELSE 'MARKET' END,
 CASE WHEN l.source_type='SERVICE' THEN COALESCE(o.fare,0) WHEN l.source_type='MARKET_UPLOAD' THEN l.gross_fee ELSE COALESCE(item.agreed_price,item.price,0) END,
 l.gross_fee,l.promo_cost,l.collected,l.created_at,l.mode
 FROM ledger l LEFT JOIN service_orders o ON l.source_type='SERVICE' AND o.id=l.source_id
 LEFT JOIN listings item ON l.source_type='MARKET' AND item.id=l.source_id
 WHERE l.mode=? AND (l.source_type<>'SERVICE' OR NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=l.source_id))
 ORDER BY created_at DESC`).all(mode,mode);
}

function jakartaDay(value){
 if(value==null)return null;
 const date=new Date(typeof value==='string'&&!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)?value.replace(' ','T')+'Z':value);
 if(!Number.isFinite(date.getTime()))return null;
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
const empty=()=>({transactions:0,volume:0,commission:0,promo:0,rewards:0,collected:0,outstanding:0,profit:0});
function add(target,row){
 target.transactions++;target.volume+=row.volume;target.commission+=row.gross_fee;target.promo+=row.promo_cost;
 target.collected+=row.collected;target.outstanding+=Math.max(0,row.gross_fee-row.collected);target.profit+=row.gross_fee-row.promo_cost;
}
export function profitStatistics({mode='SIMULATION',period='30',now=new Date()}={}){
 if(!profitModes.includes(mode)||!['7','30','90','ALL'].includes(period))throw apiError('Filter statistik tidak valid.');
 const today=jakartaDay(now);
 const startDate=new Date(today+'T00:00:00Z');
 if(period!=='ALL')startDate.setUTCDate(startDate.getUTCDate()-Number(period)+1);
 const cutoff=period==='ALL'?null:startDate.toISOString().slice(0,10);
 const entries=commissionEntries(mode).map(row=>({...row,day:jakartaDay(row.created_at)})).filter(row=>row.day&&row.day<=today&&(!cutoff||row.day>=cutoff));
 const rewards=db.prepare('SELECT amount,created_at FROM driver_achievement_rewards WHERE mode=?').all(mode)
  .map(row=>({...row,day:jakartaDay(row.created_at)})).filter(row=>row.day&&row.day<=today&&(!cutoff||row.day>=cutoff));
 const start=cutoff||[...entries,...rewards].reduce((min,row)=>row.day<min?row.day:min,today);
 const totals=empty(),services=new Map(['RIDE','DELIVERY','JASTIP','MARKET'].map(service=>[service,{service,...empty()}]));
 const buckets=new Map(),monthly=period==='ALL';
 const cursor=new Date((monthly?start.slice(0,7)+'-01':start)+'T00:00:00Z');
 const final=monthly?today.slice(0,7):today;
 while((monthly?cursor.toISOString().slice(0,7):cursor.toISOString().slice(0,10))<=final){
  const key=cursor.toISOString().slice(0,monthly?7:10);buckets.set(key,{date:key,...empty()});
  if(monthly)cursor.setUTCMonth(cursor.getUTCMonth()+1);else cursor.setUTCDate(cursor.getUTCDate()+1);
 }
 for(const row of entries){
  add(totals,row);
  if(!services.has(row.service))services.set(row.service,{service:row.service,...empty()});
  add(services.get(row.service),row);add(buckets.get(row.day.slice(0,monthly?7:10)),row);
 }
 for(const row of rewards){
  for(const target of [totals,services.get('RIDE'),buckets.get(row.day.slice(0,monthly?7:10))]){
   target.rewards+=row.amount;target.profit-=row.amount;
  }
 }
 return {mode,period,timezone:'Asia/Jakarta',start,end:today,granularity:monthly?'month':'day',totals,
  services:[...services.values()],series:[...buckets.values()]};
}
