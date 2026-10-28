import fs from 'node:fs';
import path from 'node:path';
import {db,remoteDatabase} from './db.js';

const root=path.resolve(process.env.ANJEMIN_UPLOAD_DIR||'server/uploads');
if(!remoteDatabase)fs.mkdirSync(root,{recursive:true});
function validate(name){
 if(!/^(public|private|avatar|chat)-[a-f0-9-]+\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(name))throw new Error('Nama berkas tidak valid.');
}
export function writeStoredFile(name,body){
 validate(name);
 if(remoteDatabase)db.prepare('INSERT INTO stored_files(name,body) VALUES(?,?)').run(name,Buffer.from(body));
 else fs.writeFileSync(path.join(root,name),body,{flag:'wx',mode:0o600});
}
export function readStoredFile(name){
 validate(name);
 if(remoteDatabase){
  const row=db.prepare('SELECT body FROM stored_files WHERE name=?').get(name);
  return row?Buffer.from(row.body):null;
 }
 const file=path.join(root,name);return fs.existsSync(file)?fs.readFileSync(file):null;
}
export function removeStoredFile(name){
 validate(name);
 if(remoteDatabase)db.prepare('DELETE FROM stored_files WHERE name=?').run(name);
 else fs.rmSync(path.join(root,name),{force:true});
}
