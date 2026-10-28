import { Worker,MessageChannel,receiveMessageOnPort } from 'node:worker_threads';
import path from 'node:path';

export function createPostgresDatabase({connectionString=process.env.DATABASE_URL,schema=process.env.ANJEMIN_DB_SCHEMA||'anjemin',driver='postgres'}={}){
 if(!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))throw new Error('ANJEMIN_DB_SCHEMA tidak valid.');
 if(driver==='postgres'&&!connectionString)throw new Error('DATABASE_URL belum dikonfigurasi.');
 const {port1,port2}=new MessageChannel();
 const shared=new SharedArrayBuffer(4),signal=new Int32Array(shared);
 const worker=new Worker(path.join(process.cwd(),'server/src/postgres-worker-entry.cjs'),{
  workerData:{port:port2,signal:shared,connectionString,schema,driver},transferList:[port2],
  execArgv:[],env:{...process.env,NODE_OPTIONS:''},
 });
 worker.unref();port1.unref();
 let sequence=0,closed=false;
 function call(operation,sql='',args=[]){
  if(closed)throw new Error('Database sudah ditutup.');
  const id=++sequence;
  Atomics.store(signal,0,0);
  port1.postMessage({id,operation,sql,args});
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   const message=receiveMessageOnPort(port1)?.message;
   if(message&&(message.id===id||message.id===0)){
    if(message.error){
     const error=Object.assign(new Error(message.error.message),{code:message.error.code});
     throw error;
    }
    return message.value;
   }
   Atomics.wait(signal,0,0,Math.min(100,Math.max(1,deadline-Date.now())));
   Atomics.store(signal,0,0);
  }
  closed=true;void worker.terminate();port1.close();
  throw Object.assign(new Error('Database belum merespons. Coba lagi.'),{status:503,code:'DATABASE_WORKER_TIMEOUT'});
 }
 return {
  prepare(sql){return {get:(...args)=>call('get',sql,args),all:(...args)=>call('all',sql,args),run:(...args)=>call('run',sql,args)};},
  exec(sql){return call('exec',sql);},
  close(){if(closed)return;try{call('close');}finally{closed=true;port1.close();void worker.terminate();}},
 };
}
