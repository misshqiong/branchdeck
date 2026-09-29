import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'branchdeck-lifecycle-'));
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
let app;
try{
 app=await electron.launch({executablePath:path.resolve(process.argv[2]||'release/mac-arm64/BranchDeck.app/Contents/MacOS/BranchDeck'),env:{...process.env,BRANCHDECK_DATA_DIR:data,BRANCHDECK_NO_DISCOVERY:'1',BRANCHDECK_DISCOVERY_HOME:data},timeout:25000});
 const page=await app.firstWindow();await page.locator('.sidebar').waitFor();
 await page.evaluate(async({cwd,command,port})=>{const c=await window.branchdeck.save({name:'退出验收',cwd,command,port,kind:'service',environment:'Local'});await window.branchdeck.action(c.id,'start');},{cwd:data,command:`'${process.execPath}' -e 'require("net").createServer().listen(${port},"127.0.0.1")'`,port});
 const deadline=Date.now()+15000;while(!(await page.evaluate(async()=>(await window.branchdeck.snapshot()).runs.some(r=>r.status==='ready')))){if(Date.now()>deadline)throw new Error('Service readiness timeout');await new Promise(r=>setTimeout(r,100));}
 assert.equal(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.close();return w.isVisible();}),false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await app.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:0});app.quit();});assert.equal((await page.evaluate(()=>window.branchdeck.snapshot())).runs[0].status,'ready');
 const closed=app.waitForEvent('close');await app.evaluate(({app,dialog})=>{dialog.showMessageBox=async()=>({response:1});app.quit();});await closed;
 const probe=net.createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(r=>probe.close(r));
 console.log('PASS: packaged app · close window keeps service · cancel quit keeps service · stop-and-quit releases port');
}catch(error){console.error('Lifecycle failure:',error);process.exitCode=1;}finally{if(app){try{await app.evaluate(({app})=>app.exit(0));await app.close();}catch{}}await new Promise(r=>setTimeout(r,500));fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
