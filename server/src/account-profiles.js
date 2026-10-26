import {db} from './db.js';
import {apiError,limited,validatePhone} from './security.js';
import {saveImage,removeImage} from './upload.js';

const identityQuery=db.prepare("SELECT id,full_name,username,role,driver_status,profile_photo_path FROM users WHERE id=? AND role IN ('CUSTOMER','DRIVER')");
export function identityFor(id){return id?identityQuery.get(id)||null:null;}

export function updateAccountProfile(userId,body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw apiError('Data profil tidak valid.');
 const u=db.prepare("SELECT * FROM users WHERE id=? AND account_status='ACTIVE' AND role IN ('CUSTOMER','DRIVER')").get(userId);
 if(!u)throw apiError('Akun tidak tersedia.',401);
 const name=limited(body.full_name,3,80,'Nama lengkap').replace(/\s+/g,' ');
 const username=limited(body.username,3,24,'Username').toLowerCase();
 if(!/^[a-z0-9_]+$/.test(username))throw apiError('Username hanya huruf kecil, angka, dan underscore.');
 const email=limited(body.email,5,120,'Email').toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw apiError('Masukkan email aktif dengan format yang benar.');
 const phone=validatePhone(body.phone),changedPhone=phone!==u.phone;
 const otp=changedPhone?db.prepare('SELECT verified,expires_at FROM signup_otp WHERE phone=?').get(phone):null;
 if(changedPhone&&(!otp?.verified||Date.parse(otp.expires_at)<Date.now()))throw apiError('Verifikasi nomor telepon baru dengan OTP terlebih dahulu.');
 if(u.profile_required&&!u.profile_completed_at&&!u.profile_photo_path&&!body.photo)throw apiError('Unggah foto profil untuk melengkapi akun.');
 let savedPhoto=null,inTransaction=false;
 try{
  if(body.photo!==undefined&&body.photo!==null&&body.photo!=='')savedPhoto=saveImage(body.photo,'avatar');
  db.exec('BEGIN IMMEDIATE');inTransaction=true;
  db.prepare('UPDATE users SET full_name=?,username=?,email=?,phone=?,profile_photo_path=?,profile_completed_at=CURRENT_TIMESTAMP WHERE id=?')
   .run(name,username,email,phone,savedPhoto||u.profile_photo_path,userId);
  if(changedPhone)db.prepare('DELETE FROM signup_otp WHERE phone=?').run(phone);
  db.exec('COMMIT');inTransaction=false;
 }catch(e){
  if(inTransaction)db.exec('ROLLBACK');
  if(savedPhoto)removeImage(savedPhoto);
  if(String(e.message).includes('UNIQUE'))throw apiError('Username, email, atau nomor telepon sudah digunakan.',409);
  throw e;
 }
 if(savedPhoto&&u.profile_photo_path?.startsWith('avatar-'))removeImage(u.profile_photo_path);
 return db.prepare('SELECT * FROM users WHERE id=?').get(userId);
}
