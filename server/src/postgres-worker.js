import {workerData} from 'node:worker_threads';
import fs from 'node:fs';
import {rootCertificates} from 'node:tls';
import {postgresSql} from './postgres-sql.js';

const {port,signal:shared,connectionString,schema,driver}=workerData;
const signal=new Int32Array(shared);
let database,inTransaction=false;
async function connect(){
 if(database)return database;
 let client;
 if(driver==='pglite'){
  const {PGlite}=await import('@electric-sql/pglite');
  client=new PGlite();await client.waitReady;
 }else{
  const {default:pg}=await import('pg');
  pg.types.setTypeParser(20,Number);
  pg.types.setTypeParser(1700,Number);
  const url=new URL(connectionString);
  for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(key);
  client=new pg.Client({
   connectionString:url.toString(),connectionTimeoutMillis:10000,query_timeout:25000,
   application_name:'anjemin',
   ssl:{rejectUnauthorized:true,ca:[...rootCertificates,fs.readFileSync(new URL('../certs/supabase-ca.crt',import.meta.url),'utf8')]},
  });
  client.on('error',()=>{database=null;inTransaction=false;});
  await client.connect();
 }
 try{
  await client.query('BEGIN');
  if(driver!=='pglite')await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['anjemin-schema:'+schema]);
  await client.query('CREATE SCHEMA IF NOT EXISTS "'+schema+'"');
  await client.query('REVOKE ALL ON SCHEMA "'+schema+'" FROM PUBLIC');
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});if(driver==='pglite')await client.close();else await client.end();throw error;}
 database=client;return client;
}
async function begin(client,writeLock){
 // Transaction poolers do not preserve session settings. Scope both settings
 // to each transaction, including reads that are issued outside an app transaction.
 const setup='BEGIN; SET LOCAL search_path TO \"'+schema+'\", pg_catalog; SET LOCAL TIME ZONE \'UTC\';';
 if(driver==='pglite')await client.exec(setup);else await client.query(setup);
 if(writeLock&&driver!=='pglite')await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['anjemin-writer:'+schema]);
 inTransaction=true;
}
function wake(message){
 port.postMessage(message);
 Atomics.store(signal,0,1);Atomics.notify(signal,0);
}
port.on('message',async ({id,operation,sql='',args=[]})=>{
 try{
  if(operation==='close'){
   if(database){if(driver==='pglite')await database.close();else await database.end();}
   wake({id,value:null});port.close();return;
  }
  if(/^PRAGMA /i.test(sql)&&!/^PRAGMA table_info/i.test(sql)){wake({id,value:null});return;}
  const client=await connect();
  if(/^BEGIN IMMEDIATE$/i.test(sql)){
   if(inTransaction)throw new Error('Transaction already active.');
   await begin(client,true);wake({id,value:null});return;
  }
  if(/^(COMMIT|ROLLBACK)$/i.test(sql)){
   await client.query(sql);inTransaction=false;wake({id,value:null});return;
  }
  const automatic=!inTransaction;
  if(automatic)await begin(client,false);
  let value;
  try{
   if(/^PRAGMA table_info\((\w+)\)/i.test(sql)){
    const table=sql.match(/^PRAGMA table_info\((\w+)\)/i)[1];
    const result=await client.query('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,table]);
    value=result.rows;
   }else{
    let result={rows:[],rowCount:0};
    for(const statement of postgresSql(sql,{returning:operation==='run'})){
     result=await client.query(statement,args.map(item=>item instanceof Uint8Array?Buffer.from(item):item));
    }
    const rows=result.rows||[];
    value=operation==='get'?rows[0]:operation==='all'?rows:
     operation==='run'?{changes:result.rowCount??result.affectedRows??rows.length,lastInsertRowid:rows.at(-1)?.id??rows.at(-1)?.number??0}:null;
   }
   if(automatic){await client.query('COMMIT');inTransaction=false;}
  }catch(error){
   if(automatic){await client.query('ROLLBACK').catch(()=>{});inTransaction=false;}
   throw error;
  }
  wake({id,value});
 }catch(error){
  wake({id,error:{message:error.code==='23505'?'UNIQUE constraint failed: '+error.constraint:error.message,code:error.code}});
 }
});
