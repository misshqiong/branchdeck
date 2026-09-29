import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {Manager} from '../electron/manager.mjs';
import {TerminalSessions} from '../electron/sessions.mjs';
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
async function until(fn){const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw new Error('Shell condition timeout');await new Promise(r=>setTimeout(r,50));}}
function setup(t){const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-shell-')));const env={...process.env,HOME:home,ZDOTDIR:home};const manager=new Manager(home,env),sessions=new TerminalSessions(home,env,manager);const workspace={id:'one',path:home};t.after(async()=>{await sessions.stopAll();await manager.stopAll();fs.rmSync(home,{recursive:true,force:true});});const config=(command,extra={})=>({id:'command',name:'command',cwd:home,command,kind:'task',env:{},port:null,timeout:5,...extra});return {home,manager,sessions,workspace,config};}
test('persistent login shell loads aliases and keeps cwd, prompt, history and Ctrl+C across commands',async t=>{
 const {home,sessions,workspace}=setup(t);fs.writeFileSync(path.join(home,'.zshrc'),"alias hello='printf ALIAS_OK'\nPROMPT='fixture> '\nHISTSIZE=100\n");fs.mkdirSync(path.join(home,'child'));
 const shell=sessions.create(workspace);await until(()=>sessions.get(shell.id).status==='idle');
 sessions.input(shell.id,'hello\r');await until(()=>sessions.snapshot(shell.id).data.includes('ALIAS_OK')&&sessions.get(shell.id).status==='idle');
 sessions.input(shell.id,'cd child\r');await until(()=>sessions.get(shell.id).cwd===path.join(home,'child'));
 sessions.input(shell.id,'sleep 30\r');await until(()=>sessions.get(shell.id).status==='busy');await new Promise(r=>setTimeout(r,150));await sessions.interrupt(shell.id);await until(()=>sessions.get(shell.id).status==='idle');
 sessions.input(shell.id,'printf AFTER_INTERRUPT\r');await until(()=>sessions.snapshot(shell.id).data.includes('AFTER_INTERRUPT')&&sessions.get(shell.id).status==='idle');assert.equal(sessions.get(shell.id).child.pid,shell.pid);
 assert.equal(fs.readFileSync(path.join(home,'.zshrc'),'utf8').includes('BranchDeck'),false);
});
test('shortcuts reuse an idle shell, preserve drafts and busy jobs, and fill-only never executes',async t=>{
 const {sessions,workspace,config,home}=setup(t);const first=sessions.create(workspace);await until(()=>sessions.get(first.id).status==='idle');
 const reused=await sessions.send(workspace,config('printf SHORTCUT_OK'),first.id);assert.equal(reused.id,first.id);await until(()=>sessions.get(first.id).status==='idle');
 const marker=path.join(home,'must-not-run');const fill=await sessions.send(workspace,config(`touch ${quote(marker)}`),first.id,true);assert.equal(fill.id,first.id);assert.equal(fs.existsSync(marker),false);
 const other=await sessions.send(workspace,config('sleep 30',{id:'second'}),first.id);assert.notEqual(other.id,first.id);await until(()=>sessions.get(other.id).status==='busy');
 const third=await sessions.send(workspace,config('printf NEW_TERMINAL',{id:'third'}),other.id);assert.notEqual(third.id,other.id);assert.equal(sessions.get(other.id).busy,true);assert.equal(fs.existsSync(marker),false);
 await sessions.interrupt(other.id);await until(()=>sessions.get(other.id).status==='idle');
 const another={id:'two',path:home};const isolated=await sessions.send(another,config('printf ISOLATED'),first.id);assert.notEqual(isolated.id,first.id);assert.equal(isolated.workspaceId,'two');
});
test('managed services have a dedicated tab, repeated launch focuses it, and stopping returns to a shell',async t=>{
 const {sessions,workspace,config,manager}=setup(t);const service=config(`${quote(process.execPath)} -e 'console.log("SERVICE_READY");setInterval(()=>{},1000)'`,{kind:'service'});
 const opened=await sessions.send(workspace,service);const repeat=await sessions.send(workspace,service);assert.equal(opened.id,repeat.id);assert.equal(manager.children.size,1);await until(()=>sessions.snapshot(opened.id).data.includes('SERVICE_READY'));
 await sessions.interrupt(opened.id);await until(()=>sessions.get(opened.id).status==='idle');assert.equal(sessions.get(opened.id).kind,'shell');sessions.input(opened.id,'printf AFTER_SERVICE\r');await until(()=>sessions.snapshot(opened.id).data.includes('AFTER_SERVICE')&&sessions.get(opened.id).status==='idle');
});
test('closing a busy shell releases its child listener and preserves an unrelated listener',async t=>{
 const {sessions,workspace,config,home}=setup(t);const external=net.createServer();await new Promise(r=>external.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>external.close(r)));
 const file=path.join(home,'port');const shell=await sessions.send(workspace,config(`${quote(process.execPath)} -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>require("fs").writeFileSync(${JSON.stringify(file)},String(s.address().port)))'`));await until(()=>fs.existsSync(file));const port=Number(fs.readFileSync(file,'utf8'));await sessions.close(shell.id);
 const probe=net.createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(r=>probe.close(r));assert.ok(external.listening);assert.throws(()=>sessions.input(shell.id,'echo bad'),/已关闭/);
});
test('failed service preflight opens an editable shell and never stops the occupied port owner',async t=>{
 const {sessions,workspace,config}=setup(t);const owner=net.createServer();await new Promise(r=>owner.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>owner.close(r)));
 await assert.rejects(()=>sessions.send(workspace,config('sleep 30',{kind:'service',port:owner.address().port})),/端口/);
 const shell=sessions.list()[0];await until(()=>sessions.get(shell.id).status==='idle');assert.equal(sessions.get(shell.id).kind,'shell');assert.ok(owner.listening);assert.ok(sessions.snapshot(shell.id).data.includes('端口'));
});
