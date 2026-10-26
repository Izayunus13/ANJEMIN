import fs from 'node:fs';
import path from 'node:path';
import {uuid,apiError} from './security.js';
const root=path.resolve(process.env.ANJEMIN_UPLOAD_DIR||'server/uploads');fs.mkdirSync(root,{recursive:true});
// Tidak melayani dokumen KTM dan SIM secara publik. Semua URL image listing lewat endpoint publik khusus.
export function saveImage(dataUri,visibility='public'){
 if(typeof dataUri!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(dataUri))throw apiError('Foto harus PNG, JPG, atau WebP.');
 const b=Buffer.from(dataUri.split(',')[1],'base64');
 if(!b.length || b.length>4*1024*1024)throw apiError('Foto maksimal 4MB.');
 let ext='';
 if(b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))ext='png';
 else if(b.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))ext='jpg';
 else if(b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP')ext='webp';
 else throw apiError('Isi berkas bukan gambar yang didukung.');
 const filename=`${visibility}-${uuid()}.${ext}`;
 fs.writeFileSync(path.join(root,filename),b,{flag:'wx',mode:0o600});
 return filename;
}
export function removeImage(filename){
 if(!/^(public|private|avatar)-[a-f0-9-]+\.(png|jpg|webp)$/.test(filename||''))throw apiError('Nama berkas tidak valid.');
 fs.rmSync(path.join(root,filename),{force:true});
}
export function loadImage(filename){
 if(!/^(public|private|avatar)-[a-f0-9-]+\.(png|jpg|webp)$/.test(filename||''))throw apiError('Gambar tidak ditemukan.',404);
 const fn=path.join(root,filename);
 if(!fs.existsSync(fn))throw apiError('Gambar tidak ditemukan.',404);
 const type=filename.endsWith('.png')?'image/png':filename.endsWith('.webp')?'image/webp':'image/jpeg';
 return {body:fs.readFileSync(fn),type};
}
