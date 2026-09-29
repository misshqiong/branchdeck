import { EventEmitter } from 'node:events';
import pty from 'node-pty';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { branchInfo, listeners, groupOf, externalRuntime } from './system.mjs';
import { atomicJson, validateConfig } from './store.mjs';
const runner = fileURLToPath(new URL('./runner.mjs', import.meta.url));
const active = new Set(['starting', 'running', 'ready', 'unhealthy', 'stopping']);
export class Manager extends EventEmitter {
  constructor(directory, environment = process.env) {
    super(); this.directory = directory; this.environment = environment; this.runs = new Map(); this.pending = new Set(); this.children = new Map(); this.logBuffers = new Map(); this.terminals = new Map(); this.historyFile = path.join(directory, 'history.json');
    fs.mkdirSync(path.join(directory, 'logs'), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.historyFile)) {
      try { for (const run of JSON.parse(fs.readFileSync(this.historyFile, 'utf8'))) { if (active.has(run.status)) { run.status = 'interrupted'; run.detail = '上次应用异常退出；旧 PID 不会被接管或结束'; } this.runs.set(run.configId, run); } } catch { /* History is optional, unlike saved configuration. */ }
    }
  }
  isActive(id) { return this.children.has(id) || this.pending.has(id); }
  get(id) { return this.runs.get(id) || null; }
  list() { return [...this.runs.values()]; }
  update(run, values = {}) { Object.assign(run, values); atomicJson(this.historyFile, this.list()); this.emit('change'); }
  log(run, data) {
    let raw = String(data);
    for (const secret of run._secrets || []) raw = raw.split(secret).join('••••');
    const terminal = this.terminals.get(run.id) || { data:'', sequence:0 };
    terminal.data = (terminal.data + raw).slice(-1000000); terminal.sequence++; this.terminals.set(run.id, terminal);
    this.emit('terminal', {configId:run.configId, runId:run.id, sequence:terminal.sequence, data:raw});
    let value = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g,'\n');
    for (const secret of run._secrets || []) value = value.split(secret).join('••••');
    try {
      if (fs.existsSync(run.logPath) && fs.statSync(run.logPath).size > 10 * 1024 * 1024) fs.renameSync(run.logPath, `${run.logPath}.1`);
      fs.appendFileSync(run.logPath, value, { mode: 0o600 });
    } catch { run.detail = '日志文件写入失败，请检查磁盘空间'; }
    let buffer = this.logBuffers.get(run.id);
    if (!buffer) {
      buffer = { text: '' }; this.logBuffers.set(run.id, buffer);
      setTimeout(() => { this.logBuffers.delete(run.id); this.emit('log', { configId: run.configId, runId: run.id, text: buffer.text }); }, 80);
    }
    buffer.text = (buffer.text + value).slice(-100000);
  }
  tail(id) {
    const run = this.get(id); if (!run || !fs.existsSync(run.logPath)) return '';
    const fd = fs.openSync(run.logPath, 'r');
    try { const size = fs.fstatSync(fd).size; const bytes = Buffer.alloc(Math.min(size, 100000)); fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length)); return bytes.toString('utf8'); } finally { fs.closeSync(fd); }
  }
  async start(input) {
    const config = validateConfig(input);
    if (this.isActive(config.id)) throw new Error('此配置已在运行或启动中');
    // Reserve the directory before asynchronous preflight: environment variants share state.
    for (const id of [...this.pending, ...this.children.keys()]) if (config.kind === 'service' && this.get(id)?.kind !== 'task' && this.get(id)?.cwd === config.cwd) throw new Error('此目录已有运行中的配置，请先停止后再切换环境');
    this.pending.add(config.id);
    const previous=this.get(config.id);if(previous)this.terminals.delete(previous.id);
    const run = { id: randomUUID(), configId: config.id, kind: config.kind, cwd: config.cwd, command: config.command, environment: config.environment, status: 'starting', startedAt: Date.now(), endedAt: null, pid: null, exitCode: null, branch: '', commit: '', detail: '正在检查目录、端口和外部运行实例', logPath: '' };
    run.logPath = path.join(this.directory, 'logs', `${run.id}.log`);
    Object.defineProperty(run, '_secrets', { value: Object.values(config.env).filter(x => x.length >= 4), enumerable: false });
    this.runs.set(config.id, run); this.update(run);
    try {
      const git = await branchInfo(config.cwd); run.branch = git.branch; run.commit = git.commit;
      const external = config.kind === 'service' ? await externalRuntime(config.cwd, this.environment.BRANCHDECK_EXTERNAL_RUNTIME_DIR) : null;
      if (external) throw new Error(`该目录已有外部运行实例（PID ${external.pid}）。请先从原启动入口停止，避免现有脚本替换它。`);
      if (config.port) {
        const owners = await listeners(config.port);
        if (owners.length) throw new Error(`端口 ${config.port} 已被 ${owners.map(x => `${x.command} (PID ${x.pid})`).join('、')} 占用；未停止占用进程。`);
      }
      const launch = { command:config.command, cwd:config.cwd, stopCommand:config.stopCommand, stopSignal:config.stopSignal, stopTimeout:config.stopTimeout, env:{...this.environment,...config.env,TERM:'xterm-256color',COLORTERM:'truecolor'} };
      delete launch.env.ELECTRON_RUN_AS_NODE; delete launch.env.FORCE_COLOR;
      const child = pty.spawn(process.execPath, [runner], { name:'xterm-256color', cols:100, rows:24, cwd:config.cwd, env:{...this.environment,ELECTRON_RUN_AS_NODE:'1',BRANCHDECK_LAUNCH:Buffer.from(JSON.stringify(launch)).toString('base64')} });
      const entry = {child, pid:child.pid, exited:false, requestedStop:false, stopWait:(config.stopTimeout+(config.stopCommand?5:0)+4)*1000};
      this.children.set(config.id, entry);
      run.pid = child.pid;
      this.log(run, `[BranchDeck] ${new Date().toLocaleString()} · ${run.branch} ${run.commit}\r\n$ ${config.command}\r\n\r\n`);
      this.update(run, {status:config.port?'starting':'running', detail:config.port?`等待本次进程监听端口 ${config.port}`:'交互终端运行中'});
      let readinessTimer, probing = false;
      let initialized=false,initialOutput='',readyResolve;
      const ready=new Promise(resolve=>{readyResolve=resolve;});
      child.onData(data=>{
        if(initialized){this.log(run,data);return;}
        initialOutput+=data;const marker='\x1b]777;branchdeck-ready\x07',index=initialOutput.indexOf(marker);
        if(index>=0){initialized=true;const output=initialOutput.slice(0,index)+initialOutput.slice(index+marker.length);initialOutput='';if(output)this.log(run,output);readyResolve();}
      });
      entry.exit = new Promise(resolve => child.onExit(({exitCode:code,signal}) => {
        if(!initialized){if(initialOutput)this.log(run,initialOutput);readyResolve();}
        entry.exited=true; clearInterval(readinessTimer); this.children.delete(config.id);
        const stopped=entry.requestedStop||code===130||signal===2;
        const status=stopped?'stopped':code===0?(config.kind==='task'?'succeeded':'stopped'):'failed';
        this.log(run, `\r\n[BranchDeck] ${stopped?'已停止进程组':'进程已退出'} · code=${code}${signal?` · signal=${signal}`:''}\r\n`);
        this.update(run,{status,endedAt:Date.now(),exitCode:code,detail:stopped?'已停止':`退出码 ${code}`});resolve();
      }));
      if (config.port) readinessTimer = setInterval(async () => {
        if (probing || !this.children.has(config.id) || run.status === 'stopping') return;
        probing = true;
        try {
          const owners = await listeners(config.port);
          const groups = await Promise.all(owners.map(x => groupOf(x.pid)));
          if (!this.children.has(config.id) || run.status === 'stopping') return;
          if (groups.includes(run.pid)) { if (run.status !== 'ready') this.update(run, { status: 'ready', detail: `本次进程正在监听端口 ${config.port}` }); }
          else if (Date.now() - run.startedAt > config.timeout * 1000 || run.status === 'ready') {
            if (run.status !== 'unhealthy') this.update(run, { status: 'unhealthy', detail: `端口 ${config.port} 未就绪；进程仍在运行，可查看日志或停止` });
          }
        } catch (e) { if (this.children.has(config.id) && run.status !== 'stopping' && run.detail !== e.message) this.update(run, { status: 'unhealthy', detail: e.message }); }
        finally { probing = false; }
      }, 1000);
      let startupTimer;
      try{await Promise.race([ready,new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(new Error('终端初始化超时')),10000);})]);}
      catch(error){if(await groupOf(entry.pid)===entry.pid)process.kill(-entry.pid,'SIGKILL');throw error;}
      finally{clearTimeout(startupTimer);}
      return run;
    } catch (error) { this.log(run, `[BranchDeck] ${error.message}\n`); this.update(run, { status: 'failed', detail: error.message, endedAt: Date.now() }); throw error; }
    finally { this.pending.delete(config.id); }
  }
  terminalSnapshot(id) {
    const run=this.get(id); if(!run)return {runId:null,sequence:0,data:'',active:false};
    const buffer=this.terminals.get(run.id);
    return {runId:run.id,sequence:buffer?.sequence||0,data:buffer?.data??this.tail(id).replace(/\r?\n/g,'\r\n'),active:this.children.has(id)};
  }
  input(id,runId,data) {
    if(typeof data!=='string'||data.length>65536)throw new Error('终端输入无效');
    const entry=this.children.get(id);if(!entry||entry.exited||this.get(id)?.id!==runId)throw new Error('此终端已结束，请重新运行');
    entry.child.write(data);
  }
  resize(id,runId,cols,rows) {
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>500||rows<1||rows>300)throw new Error('终端尺寸无效');
    const entry=this.children.get(id);if(entry&&!entry.exited&&this.get(id)?.id===runId)entry.child.resize(cols,rows);
  }
  async stop(id, force = false) {
    if(this.pending.has(id))throw new Error('正在检查启动配置，请稍后停止');
    const entry=this.children.get(id);if(!entry||entry.exited)return;
    const run=this.get(id);entry.requestedStop=true;this.update(run,{status:'stopping',detail:force?'正在强制停止进程组':'正在按配置停止进程组'});
    if(await groupOf(entry.pid)===entry.pid&&!entry.exited){try{process.kill(force?-entry.pid:entry.pid,force?'SIGKILL':'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
    let timeout;
    try{await Promise.race([entry.exit,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('停止超时，请检查终端后重试强制停止')),entry.stopWait);})]);}finally{clearTimeout(timeout);}
  }
  async stopAll() { await Promise.all([...this.children.keys()].map(id => this.stop(id))); }
}
