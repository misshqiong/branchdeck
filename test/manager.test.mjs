import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { Manager } from '../electron/manager.mjs';
import { Store } from '../electron/store.mjs';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const node = quote(process.execPath);
async function until(predicate, timeout = 11000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await new Promise(resolve => setTimeout(resolve, 70)); } }
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branchdeck-test-'));
  const manager = new Manager(dir);
  t.after(async () => { await manager.stopAll(); fs.rmSync(dir, { recursive: true, force: true }); });
  const config = (id = 'test', command = `${node} -e 'setInterval(()=>{},1000)'`) => ({ id, name: id, cwd: dir, command, environment: 'Local', kind: 'service', env: {}, port: null, timeout: 5 });
  return { dir, manager, config };
}
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const alive = pid => { try { const state = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim(); return state && !state.startsWith('Z'); } catch { return false; } };
test('store validates input and atomically persists configurations', t => {
  const { dir, config } = fixture(t); const store = new Store(dir);
  assert.deepEqual(store.configs, []);
  const saved = store.save(config()); assert.equal(new Store(dir).configs[0].id, saved.id);
  assert.throws(() => store.save({ ...config(), cwd: '/missing/branchdeck-directory' }), /目录不存在/);
  assert.throws(() => store.save({ ...config(), port: 99999 }), /端口/);
  assert.throws(() => store.save({ ...config(), env: { A: 5 } }), /环境变量/);
  assert.equal(fs.statSync(path.join(dir, 'configs.json')).mode & 0o777, 0o600);
  store.delete(saved.id); assert.equal(store.configs.length, 0);
});
test('task exits preserve stdout, exit status and restart history', async t => {
  const { manager, config, dir } = fixture(t);
  const c = { ...config('task', `${node} -e 'console.log("hello 测试"); process.exit(3)'`), kind: 'task' };
  await manager.start(c); await until(() => !manager.isActive(c.id));
  assert.equal(manager.get(c.id).status, 'failed'); assert.equal(manager.get(c.id).exitCode, 3); assert.match(manager.tail(c.id), /hello 测试/);
  await manager.start({ ...c, command: `${node} -e 'console.log("success")'` }); await until(() => !manager.isActive(c.id));
  assert.equal(manager.get(c.id).status, 'succeeded'); assert.equal(new Manager(dir).get(c.id).status, 'succeeded');
});
test('duplicate starts and simultaneous environment variants cannot launch twice', async t => {
  const { manager, config } = fixture(t);
  const first = manager.start(config());
  await assert.rejects(manager.start(config()), /已在运行/);
  await assert.rejects(manager.start(config('other')), /目录已有/);
  await first; await manager.stop('test'); assert.equal(manager.get('test').status, 'stopped');
});
test('occupied port blocks launch without terminating its external owner', async t => {
  const { manager, config } = fixture(t); const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  await assert.rejects(manager.start({ ...config(), port: server.address().port }), /已被.*占用/);
  assert.equal(server.listening, true); assert.equal(manager.children.size, 0);
});
test('configured external runtime blocks a matching service without stopping its owner', async t => {
  const { manager, config, dir } = fixture(t);
  const base = path.join(dir, 'external-runtimes');
  const entry = path.join(base, 'example');
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'runtime.json'), JSON.stringify({ repoRoot: dir, ownerPid: process.pid }));
  manager.environment = { ...manager.environment, BRANCHDECK_EXTERNAL_RUNTIME_DIR: base };
  await assert.rejects(manager.start(config()), /已有外部运行实例/);
  assert.equal(manager.children.size, 0);
  assert.equal(process.kill(process.pid, 0), true);
  // Removing the descriptor allows launch; unrelated external processes stay untouched.
  fs.rmSync(path.join(entry, 'runtime.json'));
  await manager.start(config());
  assert.equal(manager.isActive('test'), true);
  await manager.stop('test');
});
test('readiness is based on a listener owned by this process group and stop releases port', async t => {
  const { manager, config } = fixture(t); const port = await freePort();
  await manager.start({ ...config('server', `${node} -e 'require("net").createServer().listen(${port},"127.0.0.1")'`), port });
  await until(() => manager.get('server').status === 'ready'); await manager.stop('server');
  const server = net.createServer(); await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve)); await new Promise(resolve => server.close(resolve));
});
test('stop kills ordinary grandchildren but preserves unrelated external processes', async t => {
  const { manager, config, dir } = fixture(t);
  const external = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); t.after(() => external.kill());
  const script = path.join(dir, 'tree.cjs'); const pids = path.join(dir, 'child.pid');
  fs.writeFileSync(script, `const {spawn}=require('child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']); require('fs').writeFileSync(${JSON.stringify(pids)},String(child.pid)); setInterval(()=>{},1000);`);
  await manager.start(config('tree', `${node} ${quote(script)}`)); await until(() => fs.existsSync(pids));
  const pid = Number(fs.readFileSync(pids)); assert.ok(alive(pid)); await manager.stop('tree'); await until(() => !alive(pid)); assert.ok(alive(external.pid));
});
test('runner retains ownership after command shell exits leaving same-group descendants', async t => {
  const { manager, config, dir } = fixture(t); const pids = path.join(dir, 'orphan.pid');
  const script = path.join(dir, 'orphan.cjs');
  fs.writeFileSync(script, `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); require('fs').writeFileSync(${JSON.stringify(pids)},String(c.pid)); c.unref();`);
  await manager.start(config('orphan', `${node} ${quote(script)}`)); await until(() => fs.existsSync(pids)); await new Promise(r => setTimeout(r, 450));
  assert.ok(manager.isActive('orphan')); const pid = Number(fs.readFileSync(pids)); await manager.stop('orphan'); await until(() => !alive(pid));
});
test('a SIGTERM-resistant service can be force-stopped safely', async t => {
  const { manager, config } = fixture(t);
  await manager.start(config('stubborn', `${node} -e 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'`)); await until(() => manager.tail('stubborn').includes('\nready\n'));
  await manager.stop('stubborn', true); assert.equal(manager.get('stubborn').status, 'stopped');
});
test('readiness timeout remains stoppable and never misreports healthy', async t => {
  const { manager, config } = fixture(t); await manager.start({ ...config(), port: await freePort() }); await until(() => manager.get('test').status === 'unhealthy'); await manager.stop('test');
});
test('history from an interrupted app is display-only and does not acquire old PIDs', async t => {
  const { manager, config, dir } = fixture(t); await manager.start(config());
  const restored = new Manager(dir); assert.equal(restored.get('test').status, 'interrupted'); await restored.stop('test'); assert.equal(manager.isActive('test'), true);
});
test('PTY hangup after supervisor crash cleans up its anchored process group', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branchdeck-crash-'));
  const marker = path.join(dir, 'pid'); const harness = path.join(dir, 'supervisor.mjs');
  fs.writeFileSync(harness, `import {Manager} from ${JSON.stringify(new URL('../electron/manager.mjs', import.meta.url).href)}; import fs from 'node:fs'; const m=new Manager(${JSON.stringify(dir)}); const r=await m.start({id:'crash',name:'crash',cwd:${JSON.stringify(dir)},command:${JSON.stringify(`${node} -e 'setInterval(()=>{},1000)'`)},environment:'Local',kind:'service',env:{},port:null,timeout:5}); fs.writeFileSync(${JSON.stringify(marker)},String(r.pid)); setInterval(()=>{},1000);`);
  const supervisor = spawn(process.execPath, [harness], { stdio: 'ignore' }); let pid;
  t.after(() => { supervisor.kill(); if (pid && alive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch {} } fs.rmSync(dir,{recursive:true,force:true}); });
  await until(() => fs.existsSync(marker)); pid = Number(fs.readFileSync(marker)); assert.ok(alive(pid)); supervisor.kill('SIGKILL'); await until(() => !alive(pid));
});
test('read-only commands can run alongside a service in the same workspace', async t => {
  const {manager,config}=fixture(t);await manager.start(config('service'));
  const task={...config('command',`${node} -e 'console.log("status result")'`),kind:'task'};
  await manager.start(task);await until(()=>!manager.isActive('command'));assert.equal(manager.get('command').status,'succeeded');assert.equal(manager.isActive('service'),true);
});
test('custom shutdown command executes before the owned group is stopped', async t => {
  const {manager,config,dir}=fixture(t);const marker=path.join(dir,'stop-marker');
  await manager.start({...config('custom'),stopCommand:`${node} -e ${quote(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'stopped')`)}`,stopSignal:'SIGINT',stopTimeout:2});
  await manager.stop('custom');assert.equal(fs.readFileSync(marker,'utf8'),'stopped');assert.equal(manager.get('custom').status,'stopped');
});

test('interactive PTY preserves colors, accepts Unicode input, resizes, and Ctrl+C stops descendants', async t => {
 const {manager,config,dir}=fixture(t);const script=path.join(dir,'interactive.cjs');
 fs.writeFileSync(script,`console.log('TTY='+process.stdin.isTTY+','+process.stdout.isTTY); console.log('\\x1b[31mCOLOR_MARKER\\x1b[0m');const r=require('readline').createInterface({input:process.stdin,output:process.stdout});r.on('SIGINT',()=>process.kill(process.pid,'SIGINT'));r.on('line',line=>console.log('REPLY='+line+' SIZE='+process.stdout.columns+'x'+process.stdout.rows));setInterval(()=>{},1000);`);
 const run=await manager.start(config('interactive',`${node} ${quote(script)}`));
 await until(()=>manager.tail('interactive').includes('TTY=true,true'));
 manager.resize('interactive',run.id,90,28);manager.input('interactive',run.id,'你好 terminal\r');
 await until(()=>manager.tail('interactive').includes('REPLY=你好 terminal SIZE=90x28'));
 assert.ok(manager.terminalSnapshot('interactive').data.includes('\x1b[31m'));assert.ok(!manager.tail('interactive').includes('\x1b[31m'));
 assert.throws(()=>manager.input('interactive','stale-run','oops'),/已结束/);
 manager.input('interactive',run.id,'\x03');await until(()=>!manager.isActive('interactive'));assert.equal(manager.get('interactive').status,'stopped');assert.ok(!alive(run.pid));
});
