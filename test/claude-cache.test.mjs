import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClaudeCache} from '../electron/claude-cache.mjs';
import {Discovery} from '../electron/discovery.mjs';
function fixture(t){const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-cache-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const write=(name,text)=>{const file=path.join(home,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};const cwd=path.join(home,'unusual-project');fs.mkdirSync(cwd);const cache=new ClaudeCache({home:path.join(home,'.claude')});return {home,cwd,cache,write};}
test('discovers unindexed projects from transcript cwd, not message contents; catalog never returns bodies',async t=>{
 const {home,cwd,cache,write}=fixture(t);
 write('.claude/projects/encoded/session.jsonl','broken\n'+JSON.stringify({message:{content:'PRIVATE_SENTINEL',cwd:home}})+'\n'+JSON.stringify({cwd,timestamp:'2026-01-01T00:00:00Z',message:{content:'PRIVATE_SENTINEL'}})+'\n');
 write('.claude/projects/encoded/memory/MEMORY.md','PRIVATE_MEMORY');
 write('.claude/projects/encoded/session/tool-results/result.txt','PRIVATE_RESULT');
 const projects=await cache.scan();assert.ok(projects.some(p=>p.path===cwd));assert.ok(!projects.some(p=>p.path===home));
 const w={id:'one',path:cwd};const list=cache.list(w,[w]);assert.equal(list.files.length,3);assert.ok(!JSON.stringify(list).includes('PRIVATE_'));
 assert.ok(cache.preview(w,[w],list.files.find(f=>f.kind==='memory').id).content.includes('PRIVATE_MEMORY'));
 const d=new Discovery({home});const result=await d.scan();assert.ok(result.workspaces.some(w=>w.path===cwd&&w.sources.includes('Claude Code')));assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});
test('index-only and custom Claude directory work, and unknown paths are excluded',async t=>{
 const {home,cwd,write}=fixture(t);write('custom/projects/key/sessions-index.json',JSON.stringify({entries:[{sessionId:'a',projectPath:cwd},{sessionId:'bad',projectPath:'/missing/branchdeck-test'}]}));write('custom/projects/key/a.jsonl','{}\n');
 const d=new Discovery({home,claudeHome:path.join(home,'custom')});const result=await d.scan();assert.ok(result.workspaces.some(w=>w.path===cwd));assert.equal(d.claudeCache.list(result.workspaces[0],result.workspaces).files.length,2);
});
test('cache access is rechecked, forged IDs and cross-workspace reads are blocked, symlinks excluded',async t=>{
 const {home,cwd,cache,write}=fixture(t);write('.claude/projects/key/a.jsonl',JSON.stringify({cwd})+'\n');const memory=write('.claude/projects/key/memory/MEMORY.md','secret');write('outside.md','outside');fs.symlinkSync(path.join(home,'outside.md'),path.join(home,'.claude/projects/key/escape.md'));
 await cache.scan();const w={id:'one',path:cwd},other={id:'two',path:home+'/elsewhere'},list=cache.list(w,[w,other]);assert.equal(list.files.length,2);const id=list.files.find(f=>f.kind==='memory').id;
 assert.throws(()=>cache.preview(other,[w,other],id));assert.throws(()=>cache.preview(w,[w],'/etc/passwd'));
 cache.canAccess=()=>false;assert.throws(()=>cache.preview(w,[w],id));cache.canAccess=()=>true;
 fs.unlinkSync(memory);fs.symlinkSync(path.join(home,'outside.md'),memory);assert.throws(()=>cache.preview(w,[w],id));
});
test('large Unicode files page without loss; invalid offsets and binary files are rejected',async t=>{
 const {cwd,cache,write}=fixture(t);write('.claude/projects/key/a.jsonl',JSON.stringify({cwd})+'\n');const text='你好🙂'.repeat(40000);write('.claude/projects/key/memory/MEMORY.md',text);write('.claude/projects/key/binary.txt','\0binary');await cache.scan();const w={id:'one',path:cwd},list=cache.list(w,[w]);const id=list.files.find(f=>f.kind==='memory').id;let offset=0,actual='',pages=0;
 do{const page=cache.preview(w,[w],id,offset);actual+=page.content;offset=page.nextOffset;pages++;}while(offset!==null);
 assert.equal(actual,text);assert.ok(pages>1);assert.throws(()=>cache.preview(w,[w],id,-1));assert.throws(()=>cache.preview(w,[w],id,Infinity));assert.throws(()=>cache.preview(w,[w],list.files.find(f=>f.name==='binary.txt').id));
});
test('nested worktree sessions stay with the most specific workspace',async t=>{
 const {home,cwd,cache,write}=fixture(t);const child=path.join(cwd,'worktrees/feature');fs.mkdirSync(child,{recursive:true});write('.claude/projects/key/a.jsonl',JSON.stringify({cwd:child})+'\n');write('.claude/projects/key/a/subagents/agent.jsonl','{}\n');await cache.scan();const main={id:'main',path:cwd},branch={id:'branch',path:child};assert.equal(cache.list(main,[main,branch]).files.length,0);assert.equal(cache.list(branch,[main,branch]).files.length,2);
});
test('metadata disable and access denial prevent Claude discovery',async t=>{
 const {home,cwd,write}=fixture(t);write('.claude/projects/key/a.jsonl',JSON.stringify({cwd})+'\n');const d=new Discovery({home,metadata:false});assert.equal((await d.scan()).workspaces.length,0);const denied=new Discovery({home,canAccess:p=>typeof p==='string'&&!p.includes('.claude')});assert.equal((await denied.scan()).workspaces.length,0);
});
test('an oversized transcript header is bounded and cannot use message text as a directory',async t=>{
 const {cwd,cache,write}=fixture(t);write('.claude/projects/key/a.jsonl',JSON.stringify({message:{cwd,content:'x'.repeat(9*1024*1024)}})+'\n');const projects=await cache.scan();assert.equal(projects.length,0);assert.ok(cache.warnings.length);assert.equal(cache.files.size,0);
});
test('unknown transcripts are not shared across ambiguous project indexes',async t=>{
 const {home,cwd,cache,write}=fixture(t);const other=path.join(home,'other');fs.mkdirSync(other);write('.claude/projects/key/sessions-index.json',JSON.stringify({entries:[{sessionId:'a',projectPath:cwd},{sessionId:'b',projectPath:other}]}));write('.claude/projects/key/unknown.jsonl','{"message":{"content":"private"}}\n');await cache.scan();const w={id:'one',path:cwd};assert.ok(!cache.list(w,[w]).files.some(f=>f.name==='unknown.jsonl'));
 cache.canAccess=p=>p!==cwd;assert.equal(cache.list(w,[w]).files.length,0);
});
