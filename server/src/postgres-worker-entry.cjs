const {workerData}=require('node:worker_threads');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

// Surface startup errors through the same channel as query errors. The main
// thread may be waiting synchronously and cannot process Worker error events.
import(pathToFileURL(path.join(__dirname,'postgres-worker.js')).href).catch(error=>{
 workerData.port.postMessage({id:0,error:{message:error.message,code:error.code||'DATABASE_WORKER_STARTUP'}});
 const signal=new Int32Array(workerData.signal);
 Atomics.store(signal,0,1);Atomics.notify(signal,0);
});
