import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CommandCatalog} from '../electron/catalog.mjs';
import {HistoryDiscovery} from '../electron/history.mjs';
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-catalog-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const workspace={id:'workspace',path:home};const item=(id,extra={})=>({id,cwd:home,command:`npm run ${id}`,name:id,detected:true,kind:'task',...extra});return {home,workspace,item,catalog:new CommandCatalog(home)};}
test('initial shortlist prioritizes history, caps seeding, and never creates runnable configs',t=>{const {home,workspace,item,catalog}=fixture(t);const items=Array.from({length:12},(_,i)=>item(`lint:${i}`,{history:{count:i+1}}));const view=catalog.reconcile(workspace,items);assert.equal(view.commands.length,8);assert.equal(view.commands[0].id,'lint:11');assert.equal(view.suggestions.length,4);assert.equal(fs.existsSync(path.join(home,'configs.json')),false);});
test('later discoveries only suggest; accept and dismiss survive rescans and restart',t=>{const {home,workspace,item,catalog}=fixture(t);catalog.reconcile(workspace,[item('test')]);const items=[item('test'),item('new',{history:{count:50}}),item('ignore')];assert.equal(catalog.reconcile(workspace,items).commands.length,1);catalog.decide(workspace,items,'new','accept');catalog.decide(workspace,items,'ignore','dismiss');const restarted=new CommandCatalog(home);assert.deepEqual(restarted.reconcile(workspace,items).commands.map(l=>l.id),['test','new']);assert.equal(restarted.reconcile(workspace,items).suggestions.length,0);assert.equal(restarted.reconcile(workspace,[]).commands.length,2);assert.throws(()=>restarted.decide(workspace,items,'unknown','accept'));});
test('manual import replaces an identical discovered command and keeps custom settings',t=>{const {workspace,item,catalog}=fixture(t);catalog.reconcile(workspace,[item('test')]);const saved=item('saved',{command:'npm run test',detected:false,port:3000});const view=catalog.reconcile(workspace,[saved]);assert.equal(view.commands.length,1);assert.equal(view.commands[0].port,3000);assert.equal(view.commands[0].id,'saved');});
test('history exposes only literal explicit directory roots, without assigning adjacent cd to commands',t=>{const {home}=fixture(t);fs.writeFileSync(path.join(home,'.zsh_history'),`cd '${home}'\nnpm run test\ncd $(touch bad)\n`);const result=new HistoryDiscovery({home,environment:{}}).scan();assert.deepEqual(result.workspaceRoots,[fs.realpathSync(home)]);assert.equal(result.candidates[0].cwd,null);assert.equal(fs.existsSync(path.join(home,'bad')),false);});

test('moving a saved configuration cannot leave an old workspace pointing at its new execution directory',t=>{const {workspace,item,catalog}=fixture(t);catalog.reconcile(workspace,[item('dev')]);const view=catalog.reconcile(workspace,[],[item('dev',{cwd:'/another/project',detected:false})]);assert.equal(view.commands.length,0);});

test('relative moves persist across restart and fresh discovery without reordering unseen commands',t=>{
 const {home,workspace,item,catalog}=fixture(t),items=['a','b','c','d'].map(id=>item(id));
 catalog.reconcile(workspace,items);catalog.move(workspace,items,'d','b');
 assert.deepEqual(new CommandCatalog(home).reconcile(workspace,items).commands.map(l=>l.id),['a','d','b','c']);
 catalog.move(workspace,items,'a','c',true);
 assert.deepEqual(catalog.reconcile(workspace,[...items,item('new')]).commands.map(l=>l.id),['d','b','c','a']);
 assert.throws(()=>catalog.move(workspace,items,'foreign','b'));
});
test('removal survives discovery, history rotation and restart; undo restores position',t=>{
 const {home,workspace,item,catalog}=fixture(t),items=['a','b','c'].map(id=>item(id));catalog.reconcile(workspace,items);
 catalog.remove(workspace,items,'b');const restarted=new CommandCatalog(home);
 const variant=item('history-b',{command:items[1].command,history:{count:90}});
 const view=restarted.reconcile(workspace,[...items,variant]);
 assert.deepEqual(view.commands.map(l=>l.id),['a','c']);assert.equal(view.suggestions.length,0);assert.equal(view.removed[0].id,'b');
 assert.deepEqual(restarted.reconcile(workspace,[]).commands.map(l=>l.id),['a','c']);
 assert.deepEqual(restarted.restore(workspace,items,'b').commands.map(l=>l.id),['a','b','c']);
 assert.throws(()=>restarted.remove(workspace,items,'foreign'));assert.throws(()=>restarted.restore(workspace,items,'foreign'));
});
test('saved shortcut removal stays hidden until restore or explicit save/import',t=>{
 const {workspace,item,catalog}=fixture(t),saved=item('custom',{detected:false}),items=[saved,item('b')];catalog.reconcile(workspace,items,items);
 catalog.remove(workspace,items,'custom',items);assert.deepEqual(catalog.reconcile(workspace,items,items).commands.map(l=>l.id),['b']);
 assert.deepEqual(catalog.restore(workspace,items,'custom',items).commands.map(l=>l.id),['custom','b']);
 catalog.remove(workspace,items,'custom',items);catalog.revive(saved);assert.equal(catalog.reconcile(workspace,items,items).commands.some(l=>l.id==='custom'),true);
});
test('legacy catalog migrates insertion order and workspace shortlists remain isolated',t=>{
 const {home,workspace,item}=fixture(t),a=item('a'),b=item('b');fs.writeFileSync(path.join(home,'command-catalog.json'),JSON.stringify({workspace:{accepted:{b,a},dismissed:[]}}));
 const catalog=new CommandCatalog(home),items=[a,b];assert.deepEqual(catalog.reconcile(workspace,items).commands.map(l=>l.id),['b','a']);
 catalog.remove(workspace,items,'a');assert.deepEqual(catalog.reconcile({id:'other'},items).commands.map(l=>l.id),['a','b']);
});
