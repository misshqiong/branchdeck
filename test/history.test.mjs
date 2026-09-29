import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classify,parseHistory,HistoryDiscovery} from '../electron/history.mjs';
import {Store} from '../electron/store.mjs';
function fixture(t){const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-history-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const repo=path.join(home,'project with spaces');fs.mkdirSync(repo);const history=new HistoryDiscovery({home,environment:{}});return {home,repo,history};}
test('parses zsh extended and bash timestamps and keeps multiline records indivisible',()=>{
 const zsh=parseHistory(': 1700000000:0;npm run dev\n: 1700000001:2;pnpm run \\\ntest\n: 1700000002:0;echo example\nnpm run destroy\n');
 assert.equal(zsh.length,3);assert.equal(zsh[0].timestamp,1700000000000);assert.equal(zsh[1].command,'pnpm run  test');assert.equal(classify(zsh[2].command),null);
 assert.deepEqual(parseHistory('#1700000000\ngit status\n#1700000001\nnpm test\n').map(x=>x.command),['git status','npm test']);
 assert.equal(parseHistory('git status\nnpm test\n').length,2);
});
test('only same-command absolute directories are inferred; adjacent cd never assigns a cwd',t=>{
 const {home,repo,history}=fixture(t);fs.writeFileSync(path.join(home,'.zsh_history'),`cd '${repo}'\nnpm run dev\ncd '${repo}' && pnpm run test\ncd relative && npm test\ngit -C '${repo}' status\n`);
 const result=history.scan();assert.equal(result.candidates.find(c=>c.command==='npm run dev').cwd,null);
 const bound=result.candidates.find(c=>c.command==='pnpm run test');assert.equal(bound.cwd,repo);assert.equal(bound.kind,'task');
 assert.equal(result.candidates.find(c=>c.command.startsWith('cd relative')).cwd,null);assert.equal(result.candidates.find(c=>c.command.startsWith('git -C')).cwd,repo);
 assert.equal(classify('cd /missing-history-dir && npm run dev',home),null);
});
test('filters likely credentials, substitutions, destructive Git, and shell operators without executing',t=>{
 const {home}=fixture(t),marker=path.join(home,'must-not-exist');
 for(const command of ['TOKEN=abcd pnpm run dev','npm run dev --password supersecret','git push --force','git reset --hard','rm -rf ./cache',`npm run dev $(touch '${marker}')`,'npm run dev; echo secret','npm run dev | cat',`node -e "require('fs').writeFileSync('${marker}','x')"`])assert.equal(classify(command,home),null,command);
 assert.equal(fs.existsSync(marker),false);assert.equal(classify('NODE_ENV=test pnpm run dev:test').kind,'service');assert.equal(classify('git pull --ff-only').requiresConfirm,true);
});
test('duplicates across session histories do not inflate timestamped frequency',t=>{
 const {home,history}=fixture(t);const text=': 1700000000:0;npm run dev\n: 1700000001:0;npm run dev\n: 1700000002:0;git status\n';fs.writeFileSync(path.join(home,'.zsh_history'),text);fs.mkdirSync(path.join(home,'.zsh_sessions'));fs.writeFileSync(path.join(home,'.zsh_sessions/copy.history'),text);
 const before=fs.readFileSync(path.join(home,'.zsh_history'));const result=history.scan();assert.equal(result.candidates[0].count,2);assert.equal(result.candidates[0].sources.length,2);assert.equal(result.candidates.length,2);assert.deepEqual(fs.readFileSync(path.join(home,'.zsh_history')),before);
});
test('custom literal HISTFILE is detected without sourcing configuration',t=>{
 const {home,history}=fixture(t);fs.writeFileSync(path.join(home,'.zshrc'),'HISTFILE="$HOME/custom_history"\ntouch '+path.join(home,'executed')+'\n');fs.writeFileSync(path.join(home,'custom_history'),'npm test\n');assert.equal(history.scan().candidates.length,1);assert.equal(fs.existsSync(path.join(home,'executed')),false);
});
test('bulk import validates before a single write, does not overwrite existing, and skips normalized duplicates',t=>{
 const {home,repo,history}=fixture(t);fs.writeFileSync(path.join(home,'.bash_history'),'npm run dev\nnpm test\n');const store=new Store(path.join(home,'data'),false);store.save({name:'original',cwd:repo,command:"npm run 'dev'",kind:'service'});
 const result=history.scan(),choices=result.candidates.map(c=>({id:c.id,cwd:repo}));const prepared=history.prepare(result.scanId,choices,store.configs);assert.equal(prepared.skipped,1);store.importConfigs(prepared.configs);assert.equal(store.configs.length,2);assert.equal(store.configs[0].name,'original');assert.equal(fs.existsSync(path.join(home,'data/history.json')),false);
 const before=fs.readFileSync(store.file);assert.throws(()=>history.prepare(result.scanId,choices.map(c=>({...c,cwd:'/missing-history-cwd'})),store.configs),/工作目录/);assert.deepEqual(fs.readFileSync(store.file),before);
 assert.throws(()=>store.importConfigs([{...store.configs[0],id:'new-id'},{...store.configs[0],cwd:'/missing-history-cwd',id:'other-id'}]),/工作目录/);assert.deepEqual(fs.readFileSync(store.file),before);
 assert.equal(history.prepare(result.scanId,choices,store.configs).configs.length,0);
});
test('import only uses candidates from current scan and cannot override a known directory',t=>{
 const {home,repo,history}=fixture(t);fs.writeFileSync(path.join(home,'.bash_history'),`cd '${repo}' && npm test\n`);const old=history.scan();history.scan();assert.throws(()=>history.prepare(old.scanId,[],[]),/已更新/);const result=history.scan();assert.throws(()=>history.prepare(result.scanId,[{id:'fabricated',cwd:repo,command:'rm -rf .'}],[]),/候选/);const prepared=history.prepare(result.scanId,[{id:result.candidates[0].id,cwd:home}],[]);assert.equal(prepared.configs[0].cwd,repo);
});
test('scan tails oversized history and reports truncation',t=>{
 const {home,history}=fixture(t);fs.writeFileSync(path.join(home,'.bash_history'),'# padding\n'.repeat(450000)+'npm test\n');const result=history.scan();assert.ok(result.warnings.some(w=>w.includes('最近')));assert.equal(result.candidates[0].command,'npm test');
});
