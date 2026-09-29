import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-history-ui-'))),repo=path.join(home,'example'),nested=path.join(repo,'apps/web'),other=path.join(home,'other'),data=path.join(home,'data');
fs.mkdirSync(nested,{recursive:true});fs.mkdirSync(other);fs.mkdirSync(path.join(home,'.codex'));
fs.writeFileSync(path.join(home,'.codex/.codex-global-state.json'),JSON.stringify({'electron-saved-workspace-roots':[repo,other]}));
fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'example'}));
fs.writeFileSync(path.join(nested,'package.json'),JSON.stringify({scripts:{'lint:history':'node -e "console.log(123)"'}}));
const marker=path.join(home,'must-not-execute');fs.writeFileSync(path.join(repo,'should-not-run.js'),`require('fs').writeFileSync(${JSON.stringify(marker)},'oops')`);
fs.writeFileSync(path.join(home,'.zsh_history'),[
 `: 1700000000:0;cd '${repo}' && npm run dev:history`,
 `: 1700000001:0;cd '${repo}' && npm run dev:history`,
 ': 1700000002:0;npm run lint:history',
 ': 1700000003:0;git pull --ff-only',
 ': 1700000004:0;TOKEN=NOT_A_REAL_TOKEN npm run dev',
 `: 1700000005:0;node '${path.join(repo,'should-not-run.js')}'`,
 `: 1700000006:0;cd '${other}' && npm run test:other`,
].join('\n')+'\n');
const customFile=path.join(home,'custom.history');fs.writeFileSync(customFile,'pnpm run typecheck:imported\n');
const original=fs.readFileSync(path.join(home,'.zsh_history'));
let app;
try{
 app=await electron.launch({...(process.argv[2]?{executablePath:process.argv[2],args:[]}:{args:['.']}),env:{...process.env,BRANCHDECK_DATA_DIR:data,BRANCHDECK_DISCOVERY_HOME:home}});
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.workspace-row').filter({hasText:'example'}).click();await page.getByRole('heading',{name:'example',exact:true}).waitFor();
 await page.getByRole('button',{name:'查看 npm run lint:history 输出',exact:true}).waitFor();
 const initial=await page.evaluate(()=>window.branchdeck.snapshot());assert.equal(initial.configs.length,0);assert.equal(initial.runs.length,0);assert.equal(fs.existsSync(marker),false);
 const workspace=initial.discovery.workspaces.find(w=>w.path===repo);const automatic=await page.evaluate(id=>window.branchdeck.launchers(id),workspace.id);const inferred=automatic.find(l=>l.command==='npm run lint:history');assert.equal(inferred.cwd,nested);assert.ok(inferred.history);assert.ok(await page.locator('.command-context').filter({hasText:'历史'}).count()>0);const automaticRow=page.locator('.task-row').filter({has:page.getByRole('button',{name:'查看 npm run lint:history 输出',exact:true})});await automaticRow.getByRole('button',{name:'执行',exact:true}).click();await automaticRow.getByLabel('空闲',{exact:true}).waitFor();assert.ok(await page.evaluate(async()=>{const s=await window.branchdeck.snapshot(),session=s.sessions.find(t=>t.configId===s.configs.find(c=>c.command==='npm run lint:history')?.id);return !!session&&(await window.branchdeck.sessionSnapshot(session.id)).data.includes('123');}));await page.screenshot({path:'test-artifacts/automatic-history.png'});
 await page.getByRole('button',{name:'从终端历史导入'}).click();await page.locator('.history-item').first().waitFor();assert.equal(await page.locator('.history-item').count(),4);assert.ok(!(await page.locator('.history-panel').innerText()).includes('NOT_A_REAL_TOKEN'));
 assert.ok((await page.locator('.history-item').first().innerText()).includes('历史记录 2 次'));
 await page.getByLabel('历史范围').selectOption('all');assert.equal(await page.locator('.history-item').count(),5);await page.getByLabel('历史范围').selectOption('workspace');
 await page.getByLabel('搜索历史命令').fill('lint:history');assert.equal(await page.locator('.history-item').count(),1);await page.getByLabel('搜索历史命令').fill('');
 await app.evaluate(({dialog},nested)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[nested]});},nested);await page.getByRole('button',{name:'更改',exact:true}).click();await page.locator('.history-target code').getByText(nested,{exact:true}).waitFor();
 await page.getByRole('button',{name:'选择当前列表',exact:true}).click();await page.getByRole('button',{name:'导入所选（3）',exact:true}).click();await page.getByRole('status').getByText('已导入 3 条',{exact:false}).waitFor();
 const snapshot=await page.evaluate(()=>window.branchdeck.snapshot());assert.equal(snapshot.configs.length,4);assert.equal(snapshot.runs.length,0);assert.equal(fs.existsSync(marker),false);assert.equal(snapshot.configs.find(c=>c.command==='npm run dev:history').cwd,repo);assert.equal(snapshot.configs.find(c=>c.command==='npm run lint:history').cwd,nested);assert.equal(snapshot.configs.find(c=>c.command==='git pull --ff-only').requiresConfirm,true);
 assert.equal(await page.locator('.history-item input:not(:disabled)').count(),0);await page.getByRole('button',{name:'查看 npm run lint:history 输出',exact:true}).waitFor();await page.getByRole('button',{name:'查看 npm run dev:history 输出',exact:true}).waitFor();await page.screenshot({path:'test-artifacts/history-import.png'});
 await page.getByTitle('重新扫描历史').click();await page.locator('.history-item').first().waitFor();assert.equal(await page.locator('.history-item input:not(:disabled)').count(),0);
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},customFile);await page.getByRole('button',{name:'选择历史文件',exact:true}).click();await page.getByLabel('导入 pnpm run typecheck:imported',{exact:true}).waitFor();
 assert.deepEqual(fs.readFileSync(path.join(home,'.zsh_history')),original);assert.equal(fs.existsSync(marker),false);assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS automatic history without opening import + nested script matching + one-click execution without import + no configuration writes or execution on discovery + history UI: discovery + filtering + frequency + workspace/all scopes + search + directory picker + atomic bulk import + no execution + duplicate prevention + custom file + source preservation + no renderer errors');
}finally{if(app){try{await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await app.evaluate(({app})=>app.quit());await app.close();}catch{}}await new Promise(r=>setTimeout(r,200));fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
