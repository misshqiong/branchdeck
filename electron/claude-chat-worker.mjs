import {parentPort,workerData} from 'node:worker_threads';
import {recoverClaudeChats} from './claude-chat-recovery.mjs';
try {parentPort.postMessage({result:await recoverClaudeChats(workerData)});}
catch(error){parentPort.postMessage({error:error.message});}
