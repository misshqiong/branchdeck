import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import pty from 'node-pty';
import {randomUUID,randomBytes} from 'node:crypto';
import {run,groupOf} from './system.mjs';

const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const active=new Set(['starting','running','ready','unhealthy','stopping']);

// Each shell owns a PTY independently of saved command configurations.
export class TerminalSessions extends EventEmitter {
 constructor(directory,environment,manager){
  super();this.directory=directory;this.environment=environment;this.manager=manager;this.sessions=new Map();this.initializing=new Map();this.nextIndex=new Map();this.shuttingDown=false;
  this.shellDirectory=path.join(directory,'shell-integration');fs.mkdirSync(this.shellDirectory,{recursive:true,mode:0o700});
  for(const file of ['.zshenv','.zprofile','.zshrc','.zlogin']){
   let script=`# BranchDeck wrapper: source user configuration without editing it.\nexport ZDOTDIR="$BRANCHDECK_USER_ZDOTDIR"\n[[ -r "$ZDOTDIR/${file}" ]] && builtin source "$ZDOTDIR/${file}"\nexport BRANCHDECK_USER_ZDOTDIR="\${ZDOTDIR:-$HOME}"\nexport ZDOTDIR="$BRANCHDECK_SHELL_DIR"\n`;
   if(file==='.zlogin')script+=`export ZDOTDIR="$BRANCHDECK_USER_ZDOTDIR"\nautoload -Uz add-zsh-hook\n_branchdeck_precmd() { builtin printf '\\e]777;branchdeck;%s;idle;%s\\a' "$BRANCHDECK_SHELL_TOKEN" "$PWD"; }\n_branchdeck_preexec() { builtin printf '\\e]777;branchdeck;%s;busy;%s\\a' "$BRANCHDECK_SHELL_TOKEN" "$PWD"; }\nadd-zsh-hook precmd _branchdeck_precmd\nadd-zsh-hook preexec _branchdeck_preexec\n`;
   fs.writeFileSync(path.join(this.shellDirectory,file),script,{mode:0o600});
  }
  manager.on('terminal',event=>{for(const s of this.sessions.values())if(s.runId===event.runId)this.output(s,event.data);});
  manager.on('change',()=>{for(const s of this.sessions.values())if(s.kind==='service'&&s.configId){const r=manager.get(s.configId);if(!r||r.id!==s.runId)continue;s.status=r.status;s.busy=active.has(r.status);if(!s.busy&&!s.child&&!s.transitioning&&!s.closing&&!this.shuttingDown){s.transitioning=true;this.output(s,'\r\n[BranchDeck] 返回交互 Shell\r\n');this.spawnShell(s);s.transitioning=false;}}this.emit('change');});
 }
 describe(s){return {id:s.id,workspaceId:s.workspaceId,name:s.name,kind:s.kind,cwd:s.cwd,status:s.status,busy:s.busy,draft:s.draft,configId:s.configId||null,runId:s.runId||null,pid:s.child?.pid||this.manager.get(s.configId)?.pid||null};}
 list(){return [...this.sessions.values()].map(s=>this.describe(s));}
 get(id,workspaceId){const s=this.sessions.get(id);if(!s||workspaceId&&s.workspaceId!==workspaceId)throw new Error('终端不属于当前工作区或已关闭');return s;}
 output(s,data){s.data=(s.data+data).slice(-1000000);s.sequence++;this.emit('data',{sessionId:s.id,sequence:s.sequence,data});}
 allocate(workspace,cwd,name){
  if(this.shuttingDown)throw new Error('正在退出');
  if(this.sessions.size>=32)throw new Error('最多同时保留 32 个终端，请关闭不用的标签');
  const index=(this.nextIndex.get(workspace.id)||0)+1;this.nextIndex.set(workspace.id,index);
  const s={id:randomUUID(),workspaceId:workspace.id,cwd:fs.realpathSync(cwd),name:name||`终端 ${index}`,kind:'shell',status:'starting',busy:true,draft:false,data:'',sequence:0,child:null,closing:false};
  this.sessions.set(s.id,s);return s;
 }
 create(workspace,cwd=workspace.path){const s=this.allocate(workspace,cwd);this.spawnShell(s);this.emit('change');return this.describe(s);}
 ensure(workspace){const existing=[...this.sessions.values()].find(s=>s.workspaceId===workspace.id&&s.status!=='exited');return existing?this.describe(existing):this.create(workspace);}
 spawnShell(s){
  const token=randomBytes(18).toString('hex'),prefix=`\x1b]777;branchdeck;${token};`;let pending='';
  const env={...this.environment,TERM:'xterm-256color',COLORTERM:'truecolor',ZDOTDIR:this.shellDirectory,BRANCHDECK_SHELL_DIR:this.shellDirectory,BRANCHDECK_USER_ZDOTDIR:this.environment.ZDOTDIR||this.environment.HOME,BRANCHDECK_SHELL_TOKEN:token};
  delete env.ELECTRON_RUN_AS_NODE;delete env.BRANCHDECK_LAUNCH;delete env.FORCE_COLOR;
  s.kind='shell';s.status='starting';s.busy=true;s.draft=false;
  try{
   const child=pty.spawn('/bin/zsh',['-il'],{name:'xterm-256color',cols:100,rows:24,cwd:s.cwd,env});s.child=child;
   child.onData(chunk=>{
    pending+=chunk;
    while(pending){
     const start=pending.indexOf(prefix);
     if(start<0){let keep=0;for(let i=1;i<Math.min(prefix.length,pending.length+1);i++)if(prefix.startsWith(pending.slice(-i)))keep=i;const end=pending.length-keep;if(end)this.output(s,pending.slice(0,end));pending=pending.slice(end);break;}
     if(start){this.output(s,pending.slice(0,start));pending=pending.slice(start);}
     const end=pending.indexOf('\x07',prefix.length);
     if(end<0){if(pending.length>16384){this.output(s,pending);pending='';}break;}
     const value=pending.slice(prefix.length,end),divider=value.indexOf(';'),state=value.slice(0,divider),cwd=value.slice(divider+1);pending=pending.slice(end+1);
     if(state==='idle'||state==='busy'){
      s.busy=state==='busy';s.status=state;s.draft=false;
      try{if(path.isAbsolute(cwd)&&fs.statSync(cwd).isDirectory())s.cwd=fs.realpathSync(cwd);}catch{}
      this.emit('change');
     }
    }
   });
   s.exit=new Promise(resolve=>child.onExit(({exitCode})=>{if(s.child!==child){resolve();return;}s.child=null;s.busy=false;s.status='exited';this.output(s,`\r\n[Shell 已退出 · ${exitCode}]\r\n`);this.emit('change');resolve();}));
  }catch(error){s.child=null;s.status='exited';s.busy=false;this.output(s,`\r\n无法打开 Shell：${error.message}\r\n`);this.emit('change');}
 }
 snapshot(id){const s=this.get(id);return {sequence:s.sequence,data:s.data};}
 input(id,data,shortcut=false){
  if(typeof data!=='string'||data.length>65536)throw new Error('终端输入无效');
  const s=this.get(id);if(s.closing)throw new Error('终端正在关闭');
  if(s.kind==='service'){this.manager.input(s.configId,s.runId,data);return;}
  if(!s.child)throw new Error('Shell 已退出，请新建终端');
  // Reserve immediately, before the shell's asynchronous preexec event arrives.
  if(!s.busy){if(!shortcut){s.configId=null;s.runId=null;}s.draft=true;if(shortcut?data==='\r':/[\r\n]/.test(data)){s.busy=true;s.status='busy';}this.emit('change');}
  s.child.write(data);
 }
 resize(id,cols,rows){if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>500||rows<1||rows>300)throw new Error('终端尺寸无效');const s=this.get(id);if(s.kind==='service')this.manager.resize(s.configId,s.runId,cols,rows);else s.child?.resize(cols,rows);}
 async ready(s){const deadline=Date.now()+12000;while(s.status==='starting'&&Date.now()<deadline&&!s.closing)await pause(40);if(!s.child||s.busy||s.draft||s.closing)throw new Error('终端尚未空闲，请等待提示符后重试');}
 async send(workspace,config,preferredId,fillOnly=false){
  if(this.shuttingDown)throw new Error('正在退出');
  const managed=!fillOnly&&(config.kind==='service'||config.port||config.stopCommand);
  if(managed){
   const existing=[...this.sessions.values()].find(s=>s.workspaceId===workspace.id&&s.configId===config.id&&s.kind==='service'&&this.manager.isActive(config.id));
   if(existing)return this.describe(existing);
   if(this.initializing.has(config.id))return this.initializing.get(config.id);
   const pending=(async()=>{
    const s=this.allocate(workspace,config.cwd,config.name);s.kind='service';s.configId=config.id;
    try{const running=this.manager.start(config);s.runId=this.manager.get(config.id)?.id;const r=await running;s.runId=r.id;s.status=r.status;s.busy=active.has(r.status);if(!s.busy&&!s.child)this.spawnShell(s);this.emit('change');return this.describe(s);}
    catch(error){s.busy=false;this.output(s,`\r\n${error.message}\r\n`);if(!s.child)this.spawnShell(s);this.emit('change');throw error;}
   })();this.initializing.set(config.id,pending);try{return await pending;}finally{this.initializing.delete(config.id);}
  }
  let s=preferredId?this.sessions.get(preferredId):null;
  if(!s||s.workspaceId!==workspace.id||s.kind!=='shell'||s.busy||s.draft||s.closing||!s.child)s=this.get(this.create(workspace,config.cwd).id);
  // Lock the chosen terminal before awaiting startup, so simultaneous clicks cannot interleave.
  if(s.reserved)s=this.get(this.create(workspace,config.cwd).id);s.reserved=true;
  try{
   await this.ready(s);
   let command=config.command;
   if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command))throw new Error('快捷命令含终端控制字符，请先编辑');
   const variables=Object.entries(config.env||{});
   if(variables.length)command=`( ${variables.map(([key,value])=>`export ${key}=${quote(value)};`).join(' ')}\n${command}\n)`;
   if(s.cwd!==config.cwd)command=`builtin cd -- ${quote(config.cwd)} && ${command}`;
   s.configId=config.id;s.runId=null;
   this.input(s.id,`\x1b[200~${command}\x1b[201~`,true);
   if(!fillOnly)this.input(s.id,'\r',true);
   this.emit('change');return this.describe(s);
  }finally{s.reserved=false;}
 }
 async interrupt(id){const s=this.get(id);if(s.kind==='service')await this.manager.stop(s.configId);else this.input(id,'\x03');}
 async close(id){
  const s=this.get(id);if(s.closePromise)return s.closePromise;s.closing=true;
  s.closePromise=(async()=>{
   if(s.kind==='service')await this.manager.stop(s.configId);
   const child=s.child;
   if(child){
    // Job-control commands have separate process groups. Select only this PTY's jobs.
    const tty=await run('/bin/ps',['-p',String(child.pid),'-o','tty=']).catch(()=> '');
    const signalJobs=async signal=>{
     if(!s.child||await groupOf(child.pid)!==child.pid||!tty||tty==='??'||tty==='?')return;
     const table=await run('/bin/ps',['-axo','pid=,pgid=,tty=']);
     const groups=new Set(table.split('\n').map(line=>line.trim().split(/\s+/)).filter(([pid,pgid,t])=>t===tty&&Number(pid)!==child.pid&&Number(pgid)!==child.pid).map(([,pgid])=>Number(pgid)));
     for(const group of groups)if(group>1)try{process.kill(-group,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
    };
    await signalJobs('SIGTERM');await pause(150);await signalJobs('SIGKILL');
    try{child.kill('SIGHUP');}catch{}
    await Promise.race([s.exit,pause(800)]);
    if(s.child===child){try{child.kill('SIGKILL');}catch{}await Promise.race([s.exit,pause(800)]);}
   }
   this.sessions.delete(id);this.emit('change');
  })();try{await s.closePromise;}catch(error){s.closing=false;s.closePromise=null;throw error;}
 }
 async stopAll(){this.shuttingDown=true;await Promise.all([...this.sessions.keys()].map(id=>this.close(id)));}
}
