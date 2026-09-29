import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccessStore} from '../electron/access.mjs';
import {Discovery} from '../electron/discovery.mjs';
import {HistoryDiscovery} from '../electron/history.mjs';

function fixture(t) {
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-access-')));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const project=path.join(home,'project'),other=path.join(home,'other');
  for(const directory of [project,other]){fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'package.json'),'{}');}
  const calls={starts:[],stops:[]};
  const options={directory:path.join(home,'data'),enabled:true,home,startAccessing:bookmark=>{calls.starts.push(bookmark);if(bookmark==='stale')throw new Error('stale');return ()=>calls.stops.push(bookmark);}};
  const store=new AccessStore(options);t.after(()=>store.close());
  const select=(paths,bookmarks=paths.map(()=> 'valid'))=>({canceled:false,filePaths:paths,bookmarks});
  return {home,project,other,calls,options,store,select};
}
test('scopes restore before scanning and never expose bookmark data through the snapshot',t=>{
  const f=fixture(t);f.store.accept(f.select([f.project]),'workspace');
  assert.equal(f.store.allows(f.project),true);assert.equal(f.store.allows(f.other),false);
  assert.equal(JSON.stringify(f.store.snapshot()).includes('bookmark'),false);
  const restart=new AccessStore(f.options);t.after(()=>restart.close());
  assert.equal(restart.allows(f.project),false);restart.restore();assert.equal(restart.allows(f.project),true);
  assert.equal(fs.statSync(f.store.file).mode&0o777,0o600);
});
test('cancelled selection and missing bookmarks do not acquire or persist authority',t=>{
  const f=fixture(t);assert.deepEqual(f.store.accept({canceled:true},'workspace'),[]);
  assert.throws(()=>f.store.accept(f.select([f.project],[]),'workspace'),/持久授权/);
  assert.equal(f.calls.starts.length,0);assert.equal(fs.existsSync(f.store.file),false);
});
test('expired grants remain visible for reauthorization, and a failed batch releases acquired scopes',t=>{
  const f=fixture(t);assert.throws(()=>f.store.accept(f.select([f.project,f.other],['valid','stale']),'workspace'));
  assert.equal(f.store.allows(f.project),false);assert.deepEqual(f.calls.stops,['valid']);
  fs.mkdirSync(path.dirname(f.store.file),{recursive:true});
  fs.writeFileSync(f.store.file,JSON.stringify([{id:'old',path:f.project,kind:'workspace',bookmark:'stale'}]));
  const restored=new AccessStore(f.options);restored.restore();t.after(()=>restored.close());
  assert.equal(restored.snapshot().entries[0].active,false);assert.match(restored.snapshot().entries[0].error,/重新选择/);
  restored.accept(f.select([f.project]),'workspace','old');assert.equal(restored.allows(f.project),true);assert.equal(restored.entries.length,1);
});
test('file grants exclude siblings, directory grants do not follow symlinks outside their scope',t=>{
  const f=fixture(t);const file=path.join(f.project,'package.json');
  f.store.accept(f.select([file]),'shell');assert.equal(f.store.allows(file),true);assert.equal(f.store.allows(f.project),false);
  f.store.accept(f.select([f.project]),'workspace');fs.symlinkSync(f.other,path.join(f.project,'escape'));
  assert.equal(f.store.allows(path.join(f.project,'escape','package.json')),false);
});
test('removal takes effect on restart and later grants do not resurrect removed bookmarks',t=>{
  const f=fixture(t);f.store.accept(f.select([f.project]),'workspace');f.store.forget(f.store.entries[0].id);
  assert.equal(f.store.allows(f.project),true);assert.equal(f.store.snapshot().entries[0].pendingRemoval,true);
  f.store.accept(f.select([f.other]),'workspace');
  const restart=new AccessStore(f.options);restart.restore();t.after(()=>restart.close());
  assert.equal(restart.allows(f.project),false);assert.equal(restart.allows(f.other),true);
});
test('workspace discovery only adds authorized paths, including candidates from saved commands',async t=>{
  const f=fixture(t);f.store.accept(f.select([f.project]),'workspace');
  const discovery=new Discovery({home:f.home,roots:[f.project,f.other],metadata:false,canAccess:p=>f.store.allows(p)});
  const result=await discovery.scan([{cwd:f.other}]);
  assert.deepEqual(result.workspaces.map(w=>w.path),[f.project]);
  assert.ok(discovery.folders(result.workspaces[0].id).some(e=>e.name==='package.json'));
});
test('history files require authorization and become available after selection',t=>{
  const f=fixture(t);const file=path.join(f.home,'.zsh_history');fs.writeFileSync(file,'npm test\n');
  const history=new HistoryDiscovery({home:f.home,environment:{},canAccess:p=>f.store.allows(p)});
  assert.deepEqual(history.sources(),[]);f.store.accept(f.select([file]),'history');assert.deepEqual(history.sources(),[file]);
});
test('the full version does not restore scopes or restrict existing discovery',t=>{
  const f=fixture(t);const full=new AccessStore({...f.options,enabled:false});
  assert.equal(full.allows(f.other),true);assert.deepEqual(full.accept({canceled:false,filePaths:[f.project]},'workspace'),[f.project]);
  assert.equal(f.calls.starts.length,0);
});
