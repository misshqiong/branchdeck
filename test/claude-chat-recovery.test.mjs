import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseCache,cacheCategory,recoverClaudeChats} from '../electron/claude-chat-recovery.mjs';
function cache(url,body,{encoding='',status=200,disposition=''}={}) {
 const key=Buffer.from('1/0/'+url);const h=Buffer.alloc(24);h.writeBigUInt64LE(0xfcfb6d1ba7725c30n);h.writeUInt32LE(5,8);h.writeUInt32LE(key.length,12);
 const headers=Buffer.from(`HTTP/1.1 ${status} OK\0content-type: application/json\0content-encoding: ${encoding}\0content-disposition: ${disposition}\0set-cookie: PRIVATE_COOKIE\0`);
 const eof1=Buffer.alloc(24),eof0=Buffer.alloc(24);for(const eof of [eof1,eof0])eof.writeBigUInt64LE(0xf4fa6f45970d41d8n);eof0.writeUInt32LE(headers.length,16);
 return Buffer.concat([h,key,body,eof1,headers,eof0]);
}
test('cache decoder handles gzip, rejects incomplete streams, and excludes login/runtime endpoints',()=>{
 const body=Buffer.from('{"chat_messages":[]}');const data=cache('https://claude.ai/api/organizations/org/chat_conversations/chat',zlib.gzipSync(body),{encoding:'gzip'});
 assert.deepEqual(parseCache(data).body,body);assert.throws(()=>parseCache(data.subarray(0,-10)));
 assert.equal(cacheCategory('https://claude.ai/api/organizations/org/payment_method'),null);
 assert.equal(cacheCategory('https://www.claudeusercontent.com/_runtime/script.js'),null);
 assert.equal(cacheCategory('https://www.claudeusercontent.com/_f/version/project/main.html').kind,'artifact-files');
});
test('recovery preserves useful chat content, deduplicates downloads, excludes errors and secrets, and prevents filename escape',async t=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-chat-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=path.join(home,'Library/Application Support/Claude/Cache/Cache_Data');fs.mkdirSync(root,{recursive:true});
 const url='https://claude.ai/api/organizations/org/conversations/chat/wiggle/download-file?token=PRIVATE_TOKEN';
 fs.writeFileSync(path.join(root,'a_0'),cache(url,Buffer.from('useful document'),{disposition:'attachment; filename="../../document.md"'}));
 fs.writeFileSync(path.join(root,'b_0'),cache(url,Buffer.from('useful document')));
 fs.writeFileSync(path.join(root,'c_0'),cache('https://claude.ai/api/organizations/org/chat_conversations/chat',Buffer.from(JSON.stringify({uuid:'chat',name:'Example',settings:{token:'PRIVATE_SETTINGS'},chat_messages:[{sender:'human',text:'hello',attachments:[{name:'input.pdf'}]}]}))));
 fs.writeFileSync(path.join(root,'d_0'),cache(url,Buffer.from('{"error":"no access"}'),{status:403}));
 const result=await recoverClaudeChats({home});assert.equal(result.files.downloads,1);assert.equal(result.conversationsWithMessages,1);assert.equal(result.counts.ignoredErrors,1);
 const manifest=JSON.parse(fs.readFileSync(path.join(result.output,'manifest.json')));assert.equal(manifest.records.find(r=>r.file.startsWith('downloads/')).sources.length,2);
 for(const record of manifest.records){assert.ok(!record.file.includes('..'));const body=fs.readFileSync(path.join(result.output,record.file),'utf8');assert.ok(!body.includes('PRIVATE_'));}
 assert.ok(!JSON.stringify(manifest).includes('PRIVATE_'));
 const denied=await recoverClaudeChats({home,canAccess:p=>!p.startsWith(root)});assert.equal(denied.counts.cacheEntries,0);
});
