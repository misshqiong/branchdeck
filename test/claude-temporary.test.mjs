import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {temporaryReferences,temporaryDirectories} from '../electron/claude-temporary.mjs';
import {Discovery} from '../electron/discovery.mjs';
function fixture(t){const root=fs.mkdtempSync('/tmp/branchdeck-generated-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const write=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};return {root,write};}
test('discovers scratchpads and generated file parents after cwd and makes them browsable workspaces',async t=>{
 const {root,write}=fixture(t),home=path.join(root,'home'),scratch=path.join(root,'scratchpad');fs.mkdirSync(home,{recursive:true});const file=write('scratchpad/screens/readme.md','generated');
 const records=[{cwd:home}, {attachment:{snapshot:{scratchpadDirectory:scratch}}},{type:'assistant',message:{content:[{type:'tool_use',name:'Write',input:{file_path:file}}]}},{toolUseResult:{outputFile:file}}];
 write('home/.claude/projects/project/session.jsonl',records.map(r=>JSON.stringify(r)).join('\n')+'\n');const d=new Discovery({home});const result=await d.scan();const workspace=result.workspaces.find(w=>w.path===fs.realpathSync(scratch));assert.ok(workspace);assert.ok(workspace.sources.includes('Claude 临时目录'));assert.ok(d.folders(workspace.id).some(f=>f.name==='screens'));
});
test('literal quoted Bash paths with spaces are extracted; user prose and shared temp roots are ignored',t=>{
 const {root,write}=fixture(t),file=write('output space/result.txt','output');const record={message:{content:[{type:'tool_use',name:'Bash',input:{command:`mkdir -p "${path.dirname(file)}"; echo done > "${file}"`}}]}};const refs=temporaryReferences(record);assert.ok(refs.some(r=>r.path===file));assert.equal(temporaryReferences({message:{content:'Please inspect '+file}}).length,0);
 const result=temporaryDirectories([...refs,{path:'/tmp'},{path:'/tmp/not-existing-branchdeck-dir'}]);assert.deepEqual(result.directories,[fs.realpathSync(path.dirname(file))]);assert.ok(result.missing);
});
test('denied paths and symlinks cannot expand discovery outside authorized temporary directories',t=>{
 const {root,write}=fixture(t),file=write('output/result.txt','output');fs.symlinkSync(path.dirname(file),path.join(root,'alias'));assert.equal(temporaryDirectories([{path:file}],()=>false).directories.length,0);assert.equal(temporaryDirectories([{path:path.join(root,'alias/result.txt')}]).directories.length,0);
});
