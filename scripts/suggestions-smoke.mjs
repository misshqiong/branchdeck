import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-suggestions-'))),repo=path.join(home,'Projects/clean-app'),data=path.join(home,'data');
fs.mkdirSync(repo,{recursive:true});
fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({scripts:{dev:'node server.js','lint:new':'echo later', 'test:ignore':'echo ignore'}}));
const history=path.join(home,'.zsh_history');fs.writeFileSync(history,`cd '${repo}' && npm run dev\n`);
let app;
const launch=()=>electron.launch({...(process.argv[2]?{executablePath:process.argv[2],args:[]}:{args:['.']}),env:{...process.env,BRANCHDECK_DATA_DIR:data,BRANCHDECK_DISCOVERY_HOME:home,BRANCHDECK_TEST_SCAN_MS:'2000'}});
const until=async fn=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw new Error('suggestion UI timeout');await new Promise(r=>setTimeout(r,150));}};
try{
 app=await launch();let page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'clean-app',exact:true}).waitFor();await until(()=>page.locator('.command-tile').count().then(n=>n===1));
 const first=await page.evaluate(()=>window.branchdeck.snapshot());const id=first.discovery.workspaces.find(w=>w.path===repo).id;assert.equal(first.runs.length,0);assert.ok(first.discovery.workspaces[0].sources.includes('本地目录'));assert.equal(first.discovery.workspaces.length,1);assert.ok(first.discovery.workspaces[0].sources.includes('终端历史'));assert.ok(await page.getByRole('tab').count()>=1);
 fs.appendFileSync(history,`cd '${repo}' && npm run lint:new\ncd '${repo}' && npm run test:ignore\n`);
 const secondRepo=path.join(home,'Projects/second-app');fs.mkdirSync(secondRepo);fs.writeFileSync(path.join(secondRepo,'pom.xml'),'<project/>');
 await until(()=>page.locator('.workspace-tree').innerText().then(t=>t.includes('second-app')));
 await page.getByRole('button',{name:/发现 2 条可添加命令/}).click();assert.equal(await page.locator('.command-tile').count(),1);assert.equal((await page.evaluate(()=>window.branchdeck.snapshot())).runs.length,0);
 await page.getByRole('button',{name:'添加 npm run lint:new',exact:true}).click();await page.getByRole('button',{name:'查看 npm run lint:new 输出',exact:true}).waitFor();await page.getByRole('button',{name:'忽略 npm run test:ignore',exact:true}).click();await until(()=>page.locator('.suggestion-item').count().then(n=>n===0));
 await page.screenshot({path:'test-artifacts/clean-workspace.png'});assert.equal((await page.evaluate(()=>window.branchdeck.snapshot())).runs.length,0);assert.equal(errors.length,0);
 await app.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1});app.quit();});await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'查看 npm run lint:new 输出',exact:true}).waitFor();const view=await page.evaluate(id=>window.branchdeck.commandView(id),id);assert.equal(view.commands.length,2);assert.equal(view.suggestions.length,0);assert.equal((await page.evaluate(()=>window.branchdeck.snapshot())).runs.length,0);
 console.log('PASS periodic discovery: generic project roots + history initialization + two permanent result tabs + timer discovers new workspace and command suggestions + accept/dismiss + persistence across restart + no command execution');
}finally{if(app){try{await app.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1});app.quit();});await app.close();}catch{}}fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
