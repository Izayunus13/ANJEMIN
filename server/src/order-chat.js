import fs from 'node:fs';
import path from 'node:path';
import {db} from './db.js';
import {apiError,uuid,sha256} from './security.js';

export const ORDER_MEDIA_LIMIT=3*1024*1024;
const mediaRoot=path.resolve(process.env.ANJEMIN_UPLOAD_DIR||'server/uploads');
fs.mkdirSync(mediaRoot,{recursive:true});
const mediaPattern=/^chat-[a-f0-9-]+\.(png|jpg|webp|gif|mp4|webm)$/;
export function orderMediaUsage(orderId){
 const used=db.prepare('SELECT COALESCE(SUM(size_bytes),0) total FROM order_message_media WHERE order_id=?').get(orderId).total;
 return {limit:ORDER_MEDIA_LIMIT,used,remaining:Math.max(0,ORDER_MEDIA_LIMIT-used)};
}
function decodeMedia(uri){
 if(typeof uri!=='string')throw apiError('Lampiran media tidak valid.');
 const match=uri.match(/^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/\r\n]*={0,2})$/);
 if(!match)throw apiError('Gunakan JPG, PNG, WebP, GIF, MP4, atau WebM.');
 const body=Buffer.from(match[2],'base64');
 if(!body.length||body.length>ORDER_MEDIA_LIMIT)throw apiError('Media maksimal 3 MB, dihitung total per pesanan.');
 const mime=match[1];let valid=false,ext='';
 if(mime==='image/png'){valid=body.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));ext='png';}
 if(mime==='image/jpeg'){valid=body.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));ext='jpg';}
 if(mime==='image/webp'){valid=body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP';ext='webp';}
 if(mime==='image/gif'){valid=['GIF87a','GIF89a'].includes(body.toString('ascii',0,6));ext='gif';}
 if(mime==='video/mp4'){valid=body.length>=16&&body.toString('ascii',4,8)==='ftyp'&&body.readUInt32BE(0)>=16&&body.readUInt32BE(0)<=body.length;ext='mp4';}
 if(mime==='video/webm'){valid=body.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))&&body.subarray(0,4096).includes(Buffer.from('webm'));ext='webm';}
 if(!valid)throw apiError('Isi berkas tidak sesuai format media yang dipilih.');
 return {body,mime,ext,kind:mime.startsWith('image/')?'image':'video'};
}
export function sendOrderChatMessage(orderId,senderId,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw apiError('Pesan tidak valid.');
 if(input.body!==undefined&&typeof input.body!=='string')throw apiError('Teks pesan tidak valid.');
 const body=(input.body||'').trim(),hasMedia=input.media!==undefined&&input.media!==null;
 if(body.length>1000)throw apiError('Pesan maksimal 1000 karakter.');
 if(!body&&!hasMedia)throw apiError('Tulis pesan atau pilih foto/video terlebih dahulu.');
 const media=hasMedia?decodeMedia(input.media):null,key=media?String(input.request_id||''):null;
 if(media&&!/^[a-zA-Z0-9_-]{16,80}$/.test(key))throw apiError('Kode pengiriman media tidak valid. Silakan pilih ulang lampiran.');
 const requestHash=media?sha256(JSON.stringify({body,media:input.media})):null;
 let filename=null;
 db.exec('BEGIN IMMEDIATE');
 try{
  const order=db.prepare('SELECT status,customer_id,driver_id FROM service_orders WHERE id=?').get(orderId);
  if(!order||!order.driver_id||![order.customer_id,order.driver_id].includes(senderId))throw apiError('Chat pesanan tidak ditemukan.',404);
  if(media){
   const prior=db.prepare('SELECT message_id,request_hash FROM order_message_media WHERE order_id=? AND sender_id=? AND request_key=?').get(orderId,senderId,key);
   if(prior){
    if(prior.request_hash!==requestHash)throw apiError('Kode pengiriman sudah dipakai untuk media lain.',409);
    db.exec('COMMIT');return {ok:true,message_id:prior.message_id,media_usage:orderMediaUsage(orderId)};
   }
  }
  if(order.status!=='CLAIMED')throw apiError('Pesanan sudah berakhir. Chat hanya dapat dibaca.',409);
  if(media&&media.body.length>orderMediaUsage(orderId).remaining)throw apiError('Batas total media 3 MB untuk pesanan ini sudah terlampaui.',409);
  const inserted=db.prepare('INSERT INTO order_messages(order_id,sender_id,body,media_only) VALUES(?,?,?,?)')
   .run(orderId,senderId,body||(media.kind==='image'?'Lampiran foto':'Lampiran video'),body?0:1);
  const messageId=Number(inserted.lastInsertRowid);
  if(media){
   filename='chat-'+uuid()+'.'+media.ext;fs.writeFileSync(path.join(mediaRoot,filename),media.body,{flag:'wx',mode:0o600});
   db.prepare('INSERT INTO order_message_media(id,message_id,order_id,sender_id,file_path,mime_type,size_bytes,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(uuid(),messageId,orderId,senderId,filename,media.mime,media.body.length,key,requestHash);
  }
  db.exec('COMMIT');return {ok:true,message_id:messageId,media_usage:orderMediaUsage(orderId)};
 }catch(e){db.exec('ROLLBACK');if(filename)fs.rmSync(path.join(mediaRoot,filename),{force:true});throw e;}
}
export function orderChatMessages(orderId,after){
 return db.prepare(`SELECT m.id,m.sender_id,m.body,m.media_only,m.created_at,m.delivered_at,m.read_at,u.username sender_name,a.file_path,a.mime_type,a.size_bytes
 FROM order_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN order_message_media a ON a.message_id=m.id
 WHERE m.order_id=? AND m.id>? ORDER BY m.id LIMIT 200`).all(orderId,after).map(({file_path,mime_type,size_bytes,...m})=>({...m,
 media:file_path?{url:'/api/orders/'+orderId+'/media/'+file_path,mime_type,size:size_bytes,kind:mime_type.startsWith('image/')?'image':'video'}:null}));
}
export function loadOrderChatMedia(orderId,filename){
 if(!mediaPattern.test(filename))throw apiError('Media tidak ditemukan.',404);
 const media=db.prepare('SELECT mime_type FROM order_message_media WHERE order_id=? AND file_path=?').get(orderId,filename);
 if(!media)throw apiError('Media tidak ditemukan.',404);
 const location=path.join(mediaRoot,filename);if(!fs.existsSync(location))throw apiError('Media tidak ditemukan.',404);
 return {body:fs.readFileSync(location),type:media.mime_type};
}


export function orderChatReceipts(orderId,senderId){
 return db.prepare('SELECT id,delivered_at,read_at FROM order_messages WHERE order_id=? AND sender_id=? ORDER BY id').all(orderId,senderId);
}
export function pendingOrderChatInbox(userId){
 return db.prepare(`SELECT m.id,m.order_id,m.sender_id,m.body,m.media_only,m.created_at,a.file_path,a.mime_type,a.size_bytes
 FROM order_messages m JOIN service_orders o ON o.id=m.order_id LEFT JOIN order_message_media a ON a.message_id=m.id
 WHERE m.delivered_at IS NULL AND m.sender_id<>? AND o.driver_id IS NOT NULL
 AND (?=o.customer_id OR ?=o.driver_id) AND m.sender_id IN (o.customer_id,o.driver_id)
 ORDER BY m.id LIMIT 100`).all(userId,userId,userId).map(({file_path,mime_type,size_bytes,...m})=>({...m,
 media:file_path?{url:'/api/orders/'+m.order_id+'/media/'+file_path,mime_type,size:size_bytes,kind:mime_type.startsWith('image/')?'image':'video'}:null}));
}
export function acknowledgeOrderChat(userId,messageIds,{read=false,orderId=null}={}){
 if(!Array.isArray(messageIds)||messageIds.length>200||messageIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw apiError('Daftar pesan tidak valid.');
 const ids=[...new Set(messageIds)];if(!ids.length)return {ok:true,receipts:[]};
 const placeholders=ids.map(()=>'?').join(',');
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare(`SELECT m.id,m.order_id FROM order_messages m JOIN service_orders o ON o.id=m.order_id
   WHERE m.id IN (${placeholders}) AND m.sender_id<>? AND o.driver_id IS NOT NULL
   AND (?=o.customer_id OR ?=o.driver_id) AND m.sender_id IN (o.customer_id,o.driver_id)`).all(...ids,userId,userId,userId);
  if(rows.length!==ids.length||orderId&&rows.some(row=>row.order_id!==orderId))throw apiError('Pesan tidak ditemukan.',404);
  db.prepare(`UPDATE order_messages SET delivered_at=COALESCE(delivered_at,CURRENT_TIMESTAMP)${read?',read_at=COALESCE(read_at,CURRENT_TIMESTAMP)':''} WHERE id IN (${placeholders})`).run(...ids);
  const receipts=db.prepare(`SELECT id,delivered_at,read_at FROM order_messages WHERE id IN (${placeholders}) ORDER BY id`).all(...ids);
  db.exec('COMMIT');return {ok:true,receipts};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
