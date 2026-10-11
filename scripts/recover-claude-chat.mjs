import {recoverClaudeChats} from '../electron/claude-chat-recovery.mjs';
const destination=process.argv[2];
console.log(JSON.stringify(await recoverClaudeChats(destination?{destination}:{}),null,2));
