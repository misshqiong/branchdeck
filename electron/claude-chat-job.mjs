import {Worker} from 'node:worker_threads';
// Recovery performs filesystem/decompression work off the Electron UI thread.
export function runChatRecovery(options) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./claude-chat-worker.mjs',import.meta.url),{workerData:options});
    let settled=false;
    worker.once('message',message=>{settled=true;message.error?reject(new Error(message.error)):resolve(message.result);});
    worker.once('error',error=>{settled=true;reject(error);});
    worker.once('exit',code=>{if(!settled)reject(new Error(`聊天缓存扫描未完成 (${code})`));});
  });
}
