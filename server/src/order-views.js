import {db} from './db.js';
const profileFields=['id','full_name','username','role','driver_status','profile_photo_path'];
const paymentFields=['id','order_id','mode','amount','status','qr_url','expires_at','paid_at','released_at','created_at'];
const projection=(alias,prefix,fields)=>fields.map(field=>alias+'.'+field+' AS '+prefix+field).join(',');
function extract(row,prefix,fields){
 const result={};for(const field of fields){result[field]=row[prefix+field];delete row[prefix+field];}
 return result.id?result:null;
}
// One query for the whole list, including payment and both public profiles.
export function orderViews(user){
 return db.prepare(`SELECT o.*,cu.username customer_name,du.username driver_name,
 ${projection('cu','customer_public_',profileFields)},${projection('du','driver_public_',profileFields)},${projection('p','payment_public_',paymentFields)}
 FROM service_orders o JOIN users cu ON cu.id=o.customer_id LEFT JOIN users du ON du.id=o.driver_id
 LEFT JOIN payments p ON p.order_id=o.id WHERE o.customer_id=? OR o.driver_id=?
 ORDER BY o.created_at DESC LIMIT 80`).all(user.id,user.id).map(row=>{
  const customer_profile=extract(row,'customer_public_',profileFields),driver_profile=extract(row,'driver_public_',profileFields),payment=extract(row,'payment_public_',paymentFields);
  return {...row,payment,customer_profile,driver_profile};
 });
}
