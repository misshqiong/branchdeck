import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {validateConfig} from './store.mjs';
const MAX_FILE=4*1024*1024,MAX_TOTAL=16*1024*1024;
// Parse literal shell words only. No shell evaluation, substitutions or history execution.
export function words(command){
 const result=[];let i=0;
 while(i<command.length){
  if(/\s/.test(command[i])){i++;continue;}
  const start=i;let value='',quote='';
  if(command.slice(i,i+2)==='&&'){result.push({value:'&&',start,end:i+2,operator:true});i+=2;continue;}
  while(i<command.length){
   const c=command[i];
   if(!quote&&/\s/.test(c))break;
   if(c==='`'||c==='$'||/[\x00-\x1f\x7f]/.test(c))return null;
   if(!quote&&/[;&|<>]/.test(c))return null;
   if(c==='\\'&&quote!=="'"){if(i+1>=command.length)return null;value+=command[++i];i++;continue;}
   if(c==='"'||c==="'"){if(!quote){quote=c;i++;continue;}if(quote===c){quote='';i++;continue;}}
   value+=c;i++;
  }
  if(quote)return null;result.push({value,start,end:i});
 }
 return result;
}
export function parseHistory(text){
 const records=[];let current=null;
 const lines=text.replace(/\\\r?\n/g,' ').split(/\r?\n/);
 const stamped=lines.some(line=>/^: \d+:[\d.]+;/.test(line)||/^#\d{9,}$/.test(line));
 const finish=()=>{if(current?.command.trim())records.push(current);current=null;};
 for(const line of lines){
  const extended=line.match(/^: (\d+):[\d.]+;(.*)$/);
  if(extended){finish();current={command:extended[2],timestamp:Number(extended[1])*1000};continue;}
  if(/^#\d{9,}$/.test(line)){finish();current={command:'',timestamp:Number(line.slice(1))*1000};continue;}
  if(stamped&&current){if(line||current.command)current.command+=`${current.command?'\n':''}${line}`;}
  else if(line.trim()&&!line.startsWith('#'))records.push({command:line,timestamp:null});
 }
 finish();return records.map(record=>({...record,command:record.command.trimEnd()}));
}

const sensitive=/(?:password|passwd|token|secret|credential|api[_-]?key|access[_-]?key|private[_-]?key|authorization|bearer|BEGIN\s+.*PRIVATE|:\/\/[^\s/]+:[^\s/]+@|\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]+|\bAKIA[A-Z0-9]{12,})/i;
function directory(value,home){
 const target=value==='~'?home:value.startsWith('~/')?path.join(home,value.slice(2)):value;
 if(!path.isAbsolute(target))return null;
 try{return fs.statSync(target).isDirectory()?fs.realpathSync(target):null;}catch{return null;}
}
export function classify(command,home=os.homedir()){
 command=command.trim();if(!command||command.length>2000||sensitive.test(command))return null;
 let tokens=words(command);if(!tokens?.length)return null;
 let cwd=null,explicitDirectory=false;
 if(tokens[0].value==='cd'){
  if(tokens[1]?.value==='--')tokens=tokens.filter((_,index)=>index!==1);
  if(tokens[2]?.value!=='&&'||!tokens[2].operator)return null;
  const target=tokens[1].value;
  if(path.isAbsolute(target)||target.startsWith('~/')||target==='~'){
   cwd=directory(target,home);if(!cwd)return null;command=command.slice(tokens[3]?.start||command.length).trim();explicitDirectory=true;
  }
  tokens=tokens.slice(3);
 }
 if(tokens.some(t=>t.operator))return null;
 let index=0;while(tokens[index]&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].value))index++;
 if(!tokens[index])return null;
 const executable=tokens[index].value,tool=path.basename(executable),args=tokens.slice(index+1).map(t=>t.value);
 let kind='task',requiresConfirm=false,category='custom';
 if(['npm','pnpm','yarn','bun'].includes(tool)){
  const verb=args.find((arg,i)=>!arg.startsWith('-')&&!(i&&['--dir','--cwd','--prefix','-C','--filter','-F','--workspace','-w'].includes(args[i-1])));
  if(!verb||['exec','dlx','x','create','publish','login','config','add','remove','uninstall','install','i','link','unlink'].includes(verb))return null;
  if(!['run','run-script','dev','start','serve','test','build','lint','check','typecheck','preview','watch','format'].includes(verb)&&!/^(dev|start|test|build|lint|check|serve):/.test(verb))return null;
  const script=['run','run-script'].includes(verb)?args[args.indexOf(verb)+1]:verb;
  if(!script)return null;kind=/^(dev|start|serve|preview|watch)(:|$)/.test(script)||args.includes('--watch')?'service':'task';
 }else if(tool==='git'){
  const offset=args[0]==='-C'?2:0,verb=args[offset];
  if(!['status','diff','log','show','branch','fetch','pull','switch','checkout','commit','merge','rebase','stash'].includes(verb))return null;
  if(args.some(a=>/^(--force(?:-with-lease)?|-f|--hard|--delete|-D|-d)$/.test(a))||['drop','clear'].some(a=>args.includes(a)))return null;
  requiresConfirm=!['status','diff','log','show','fetch'].includes(verb);category='git';
  if(offset){const target=args[1];if(!path.isAbsolute(target)&&!target.startsWith('~/'))return null;cwd=directory(target,home);if(!cwd)return null;explicitDirectory=true;}
 }else if(['mvn','mvnw','gradle','gradlew','make'].includes(tool)){
  if(!args.some(a=>/^(spring-boot:run|bootRun|run|dev|start|serve|test|build|compile|verify|check|lint|package|install|clean)(:|$)/.test(a)))return null;
  kind=args.some(a=>/^(spring-boot:run|bootRun|run|dev|start|serve)(:|$)/.test(a))?'service':'task';
 }else if(tool==='docker'&&args[0]==='compose'){
  if(!['up','down','start','stop','restart','logs','ps','build'].includes(args[1])||args.includes('-d')||args.includes('--detach'))return null;
  kind=args[1]==='up'||args[1]==='logs'&&args.some(a=>a==='-f'||a==='--follow')?'service':'task';requiresConfirm=['down','stop','restart'].includes(args[1]);
 }else if(['node','python','python3','bash','sh','zsh'].includes(tool)){
  if(!args[0]||args[0].startsWith('-')||!/[.](?:[cm]?js|py|sh)$/.test(args[0]))return null;
  kind=/(?:^|[/_.-])(dev|serve|server|start|watch)(?:[/_.-]|$)/.test(args[0])?'service':'task';
 }else if(executable.startsWith('./')&&/[.]sh$/.test(executable)){
  kind=/(?:^|[/_.-])(dev|serve|server|start|watch)(?:[/_.-]|$)/.test(executable)?'service':'task';
 }else return null;
 return {command,cwd,kind,requiresConfirm,category,name:command.slice(0,85),directoryEvidence:explicitDirectory?'命令内指定目录':'历史未记录目录'};
}
export function commandKey(cwd,command){return `${cwd}\0${JSON.stringify(words(command)?.map(t=>t.value)??command.trim())}`;}
export class HistoryDiscovery{
 constructor({home=os.homedir(),environment=process.env,canAccess=()=>true}={}){this.canAccess=canAccess;this.home=home;this.environment=environment;this.extraFiles=[];this.scanId='';this.candidates=new Map();}
 sources(){
  const list=[path.join(this.home,'.zsh_history'),path.join(this.home,'.bash_history')];
  if(this.environment.HISTFILE&&path.isAbsolute(this.environment.HISTFILE))list.unshift(this.environment.HISTFILE);
  // Read only literal HISTFILE assignments, never source shell configuration.
  for(const name of ['.zshenv','.zshrc','.bashrc','.bash_profile']){
   try{const file=path.join(this.home,name);if(!this.canAccess(file))continue;if(fs.statSync(file).size>256000)continue;
    for(const line of fs.readFileSync(file,'utf8').split('\n')){const m=line.match(/^\s*(?:export\s+)?HISTFILE=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/);if(!m)continue;let value=(m[1]??m[2]??m[3]).replace(/^\$\{?HOME\}?\//,this.home+'/').replace(/^~\//,this.home+'/');if(!value.includes('$')&&!value.includes('`')&&path.isAbsolute(value))list.push(value);}
   }catch{}
  }
  try{const base=path.join(this.home,'.zsh_sessions');const files=(this.canAccess(base)?fs.readdirSync(base):[]).filter(n=>n.endsWith('.history')).map(n=>({file:path.join(base,n),mtime:fs.statSync(path.join(base,n)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime).slice(0,12);list.push(...files.map(x=>x.file));}catch{}
  list.unshift(...this.extraFiles);const seen=new Set();return list.filter(file=>{try{if(!this.canAccess(file))return false;const real=fs.realpathSync(file);if(seen.has(real)||!fs.statSync(real).isFile())return false;seen.add(real);return true;}catch{return false;}}).slice(0,20);
 }
 scan({limit=300}={}){
  const aggregate=new Map(),sources=[],warnings=[],workspaceRoots=new Set();let total=0,skipped=0,records=0;
  for(const file of this.sources()){
   if(total>=MAX_TOTAL){warnings.push('已达到 16 MB 扫描上限，部分文件未读取');break;}
   let fd;
   try{
    fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,length=Math.min(size,MAX_FILE,MAX_TOTAL-total),buffer=Buffer.alloc(length);fs.readSync(fd,buffer,0,length,size-length);total+=length;
    let text=buffer.toString('utf8');if(size>length){text=text.slice(text.indexOf('\n')+1);warnings.push(`${path.basename(file)} 仅扫描最近的历史记录`);}
    const parsed=parseHistory(text);sources.push({path:file,name:path.basename(file),records:parsed.length});const perFile=new Map();
    for(const record of parsed){
     const tokens=words(record.command),values=tokens?.map(t=>t.value)||[];
     const target=values[0]==='cd'?values[values[1]==='--'?2:1]:values[0]==='git'&&values[1]==='-C'?values[2]:null;
     if(target&&(path.isAbsolute(target)||target.startsWith('~/'))){const root=directory(target,this.home);if(root)workspaceRoots.add(root);}
     records++;const item=classify(record.command,this.home);if(!item){skipped++;continue;}const key=commandKey(item.cwd,item.command);let value=aggregate.get(key);if(!value){value={...item,id:createHash('sha256').update(key).digest('hex').slice(0,24),count:0,lastUsed:null,sources:[],stamps:new Set(),plainCount:0};aggregate.set(key,value);}if(!value.sources.includes(file))value.sources.push(file);
     if(record.timestamp){value.stamps.add(record.timestamp);value.lastUsed=Math.max(value.lastUsed||0,record.timestamp);}else perFile.set(key,(perFile.get(key)||0)+1);
    }
    for(const [key,count] of perFile)aggregate.get(key).plainCount=Math.max(aggregate.get(key).plainCount,count);
   }catch{warnings.push(`${path.basename(file)} 无法读取`);}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  if(aggregate.size>limit)warnings.push(`已找到 ${aggregate.size} 条候选，优先展示频次最高的 ${limit} 条`);
  const list=[...aggregate.values()].map(({stamps,plainCount,...item})=>({...item,count:Math.max(stamps.size,plainCount)})).sort((a,b)=>b.count-a.count||(b.lastUsed||0)-(a.lastUsed||0)).slice(0,limit);
  this.scanId=randomUUID();this.candidates=new Map(list.map(item=>[item.id,item]));return {scanId:this.scanId,candidates:list,sources,warnings,skipped,records,workspaceRoots:[...workspaceRoots].slice(-350)};
 }
 prepare(scanId,selections,existing){
  if(scanId!==this.scanId)throw new Error('历史列表已更新，请重新扫描');
  if(!Array.isArray(selections)||!selections.length||selections.length>100)throw new Error('请选择 1–100 条命令');
  const keys=new Set(existing.map(c=>commandKey(c.cwd,c.command))),configs=[];let skipped=0;
  for(const choice of selections){const item=this.candidates.get(choice.id);if(!item)throw new Error('候选命令不存在，请重新扫描');const cwd=item.cwd||choice.cwd;
   const config=validateConfig({...item,id:undefined,cwd,environment:'History'}),key=commandKey(config.cwd,config.command);
   if(keys.has(key)){skipped++;continue;}keys.add(key);configs.push(config);
  }
  return {configs,skipped};
 }
}
