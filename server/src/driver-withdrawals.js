import crypto from 'node:crypto';
import {db} from './db.js';
import {amount,limited,validatePhone,apiError} from './security.js';
import {paymentMode} from './payments.js';

export {withdrawalProviders} from './market-withdrawals.js';
import {withdrawalProviders} from './market-withdrawals.js';
export function driverBalance(driverId,mode){
 const credited=db.prepare('SELECT COALESCE(SUM(amount),0) n FROM wallet_credits WHERE driver_id=? AND mode=?').get(driverId,mode).n+db.prepare('SELECT COALESCE(SUM(amount),0) n FROM driver_achievement_rewards WHERE driver_id=? AND mode=?').get(driverId,mode).n;
 const withdrawn=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM driver_withdrawals WHERE driver_id=? AND mode=? AND status='SIMULATED'").get(driverId,mode).n;
 return {available:credited-withdrawn,withdrawn};
}
const publicRecord=row=>({id:row.id,amount:row.amount,channel:row.channel,provider:row.provider,account_name:row.account_name,masked_number:row.masked_number,status:row.status,mode:row.mode,created_at:row.created_at});
export function driverWithdrawals(driverId,mode){return db.prepare('SELECT * FROM driver_withdrawals WHERE driver_id=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT 10').all(driverId,mode).map(publicRecord);}
export function withdrawDriverSimulation(driverId,body){
 if(paymentMode()!=='SIMULATION'||process.env.NODE_ENV==='production')throw apiError('Penarikan Penganjem saat ini hanya tersedia dalam mode simulasi. Transfer uang sungguhan belum diaktifkan.',503);
 if(!body||typeof body!=='object'||Array.isArray(body))throw apiError('Data penarikan tidak valid.');
 if(body.confirmed!==true)throw apiError('Konfirmasikan data tujuan penarikan terlebih dahulu.');
 const total=amount(body.amount,1,100000000),channel=String(body.channel||''),provider=String(body.provider||'');
 const providers=Object.hasOwn(withdrawalProviders,channel)?withdrawalProviders[channel]:null;
 if(!providers?.some(([code])=>code===provider))throw apiError('Pilih bank atau e-wallet yang sesuai.');
 const name=limited(body.account_name,2,100,'Nama pemilik').replace(/\s+/g,' ');
 const normalize=value=>{
  if(typeof value!=='string')throw apiError('Isi nomor rekening atau nomor HP e-wallet.');
  if(channel==='EWALLET')return validatePhone(value);
  const number=value.replace(/[\s-]/g,'');
  if(!/^\d{6,20}$/.test(number))throw apiError('Nomor rekening harus terdiri dari 6 sampai 20 angka.');
  return number;
 };
 const number=normalize(body.account_number),confirmation=normalize(body.confirm_number);
 if(number!==confirmation)throw apiError('Konfirmasi nomor tujuan tidak sama. Periksa kembali.');
 const key=String(body.request_key||'');if(!/^[a-zA-Z0-9_-]{16,80}$/.test(key))throw apiError('Identitas permintaan tidak valid. Buka ulang formulir penarikan.');
 const hash=crypto.createHash('sha256').update(JSON.stringify([total,channel,provider,name,number])).digest('hex');
 const previous=db.prepare('SELECT * FROM driver_withdrawals WHERE driver_id=? AND request_key=?').get(driverId,key);
 if(previous){if(previous.request_hash!==hash)throw apiError('Permintaan ini sudah dipakai dengan data berbeda. Buka formulir penarikan baru.',409);return publicRecord(previous);}
 const balance=driverBalance(driverId,'SIMULATION');
 if(total>balance.available)throw apiError('Saldo tersedia tidak mencukupi. Dana yang masih ditahan belum dapat ditarik.',409);
 const id=crypto.randomUUID(),masked='****'+number.slice(-4);
 // Simulation needs only a fingerprint and the masked destination, never the full account number.
 db.prepare("INSERT INTO driver_withdrawals(id,driver_id,mode,amount,channel,provider,account_name,masked_number,request_key,request_hash,status) VALUES(?,?,'SIMULATION',?,?,?,?,?,?,?,'SIMULATED')")
  .run(id,driverId,total,channel,provider,name,masked,key,hash);
 return publicRecord(db.prepare('SELECT * FROM driver_withdrawals WHERE id=?').get(id));
}
