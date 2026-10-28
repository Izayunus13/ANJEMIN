import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {DatabaseSync} from 'node:sqlite';

const environment={...process.env};
for(const name of ['.env','.env.local'])if(fs.existsSync(name))Object.assign(environment,parseEnv(fs.readFileSync(name,'utf8')));
if(!environment.DATABASE_URL)throw new Error('Isi DATABASE_URL di .env.local.');
const filename=path.resolve(environment.ANJEMIN_DATA_DIR||'server/data','anjemin.sqlite');
if(!fs.existsSync(filename))throw new Error('Database SQLite sumber tidak ditemukan.');
const source=new DatabaseSync(filename,{readOnly:true});
let target;
try{
 const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(row=>row.name);
 if(tables.some(name=>!/^[_a-z][_a-z0-9]*$/.test(name)))throw new Error('Nama tabel sumber tidak valid.');
 const uploads=path.resolve(environment.ANJEMIN_UPLOAD_DIR||'server/uploads');
 const files=fs.existsSync(uploads)?fs.readdirSync(uploads,{withFileTypes:true}).filter(entry=>entry.isFile()&&/^(public|private|avatar|chat)-[a-f0-9-]+\.(png|jpg|webp|gif|mp4|webm)$/.test(entry.name)).map(entry=>entry.name):[];
 const counts=Object.fromEntries(tables.map(table=>[table,source.prepare('SELECT COUNT(*) n FROM "'+table+'"').get().n]));
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'preview',tables:tables.length,accounts:counts.users,records:Object.values(counts).reduce((a,b)=>a+b,0),files:files.length}));
 if(process.argv.includes('--apply')){
  process.env.DATABASE_URL=environment.DATABASE_URL;
  process.env.ANJEMIN_DB_DRIVER='postgres';
  if(environment.ANJEMIN_DB_SCHEMA)process.env.ANJEMIN_DB_SCHEMA=environment.ANJEMIN_DB_SCHEMA;
  const {db}=await import('../server/src/db.js');
  target=db;
  target.exec('BEGIN IMMEDIATE');
  try{
   if(target.prepare('SELECT COUNT(*) n FROM users').get().n!==0)throw new Error('TARGET_NOT_EMPTY');
   for(const table of tables){
    if(table==='user_numbers')target.exec('DELETE FROM user_numbers');
    const rows=source.prepare('SELECT * FROM "'+table+'"').all();
    const columns=source.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name);
    const insert=target.prepare('INSERT INTO "'+table+'"('+columns.map(name=>'"'+name+'"').join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
    for(const row of rows)insert.run(...columns.map(name=>row[name]));
   }
   for(const [table,column] of [['user_numbers','number'],['order_messages','id']]){
    target.exec("SELECT setval(pg_get_serial_sequence('"+table+"','"+column+"'),COALESCE((SELECT MAX("+column+") FROM "+table+"),0)+1,false)");
   }
   for(const name of files)target.prepare('INSERT INTO stored_files(name,body) VALUES(?,?)').run(name,fs.readFileSync(path.join(uploads,name)));
   for(const table of tables)if(target.prepare('SELECT COUNT(*) n FROM "'+table+'"').get().n!==counts[table])throw new Error('ROW_COUNT_MISMATCH');
   target.exec('COMMIT');
   console.log(JSON.stringify({migrated:true,verified:true,accounts:counts.users,files:files.length}));
  }catch(error){target.exec('ROLLBACK');throw error;}
 }
}catch(error){
 console.error(JSON.stringify({migrated:false,code:error.code||error.message==='TARGET_NOT_EMPTY'&&'TARGET_NOT_EMPTY'||error.name}));
 process.exitCode=1;
}finally{source.close();target?.close();}
