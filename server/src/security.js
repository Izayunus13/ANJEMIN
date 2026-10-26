import crypto from 'node:crypto';
import {db} from './db.js';

export const uuid = () => crypto.randomUUID();
export function hashPassword(password) {
 const salt=crypto.randomBytes(16).toString('hex');
 return `${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password,stored) {
 if(!stored || !stored.includes(':'))return false;
 const [salt,hex]=stored.split(':');
 const actual=crypto.scryptSync(password,salt,64), expected=Buffer.from(hex,'hex');
 return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);
}
export const sha256 = str => crypto.createHash('sha256').update(str).digest('hex');
export function cookieHeader(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));}
export function currentUser(req){
 const token=cookieHeader(req).anjemin_session;
 if(!token)return null;
 return db.prepare(`SELECT u.id,u.full_name,u.username,u.email,u.phone,u.role,u.driver_status,u.ready,u.referral_code,u.created_at,u.profile_photo_path,u.profile_required,u.profile_completed_at
 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='ACTIVE'`).get(sha256(token),new Date().toISOString())||null;
}
export function needsProfile(u){return !!u&&['CUSTOMER','DRIVER'].includes(u.role)&&!!u.profile_required&&!u.profile_completed_at;}
export function createSession(userId,res,isProd,remember=false){
 const lifetime=remember?30*86400:7*86400;
 const token=crypto.randomBytes(32).toString('hex');
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token),userId,new Date(Date.now()+lifetime*1000).toISOString());
 res.setHeader('Set-Cookie',`anjemin_session=${token}; HttpOnly; SameSite=Lax; Path=/${remember?'; Max-Age='+lifetime:''}${isProd?'; Secure':''}`);
}
export function requireUser(req){const u=currentUser(req); if(!u)throw Object.assign(new Error('Silakan login dahulu.'),{status:401});return u;}
export function requireRole(req,roles){const u=requireUser(req);if(!roles.includes(u.role))throw Object.assign(new Error('Akses tidak diizinkan.'),{status:403});return u;}
export function validatePhone(s){
 const clean=String(s||'').replace(/[\s.()-]/g,'');
 let v=clean.startsWith('0')?'62'+clean.slice(1):clean.startsWith('+')?clean.slice(1):clean;
 if(!/^62[0-9]{9,13}$/.test(v))throw Object.assign(new Error('Gunakan nomor Indonesia aktif, contoh 081234567890.'),{status:400});
 return v;
}
export function limited(val,min,max,name){const x=String(val||'').trim(); if(x.length<min||x.length>max)throw Object.assign(new Error(`${name} harus ${min}–${max} karakter.`),{status:400});return x;}
export function amount(val,min=1,max=50000000){const n=Number(val);if(!Number.isInteger(n)||n<min||n>max)throw Object.assign(new Error('Nominal tidak valid.'),{status:400});return n;}
export function dateAfter(days){return new Date(Date.now()+days*86400000).toISOString();}
export function apiError(message,status=400){return Object.assign(new Error(message),{status});}
const limitMap = new Map();
export function rateLimit(key,limit,minutes){
 const now=Date.now(); const value=limitMap.get(key)||{count:0,reset:now+minutes*60000};
 if(now>value.reset){value.count=0;value.reset=now+minutes*60000;}
 value.count++;limitMap.set(key,value);
 if(value.count>limit)throw apiError('Terlalu banyak percobaan, tunggu sebentar.',429);
 if(limitMap.size>20000)for(const [k,v] of limitMap)if(now>v.reset)limitMap.delete(k);
}
