import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {commandKey,words} from './history.mjs';
const ignored=new Set(['node_modules','target','dist','build','vendor','release','coverage']);
function read(file){try{if(fs.statSync(file).size>1024*1024)return '';return fs.readFileSync(file,'utf8');}catch{return '';}}
function exists(file){try{return fs.statSync(file).isFile();}catch{return false;}}
function belongs(root,directory){
 let real;try{real=fs.realpathSync(directory);}catch{return false;}
 if(real!==root&&!real.startsWith(root+path.sep))return false;
 let current=real;
 while(current!==root){if(fs.existsSync(path.join(current,'.git'))||path.basename(current).startsWith('.')||ignored.has(path.basename(current)))return false;current=path.dirname(current);}
 return true;
}
function units(root){
 const result=[],queue=[{cwd:root,depth:0}];let count=0;
 while(queue.length&&count++<200){const {cwd,depth}=queue.shift();if(!belongs(root,cwd))continue;let scripts={};try{scripts=JSON.parse(read(path.join(cwd,'package.json'))).scripts||{};}catch{}
  result.push({cwd,scripts,pom:exists(path.join(cwd,'pom.xml')),gradle:['build.gradle','build.gradle.kts'].some(f=>exists(path.join(cwd,f))),compose:['compose.yaml','compose.yml','docker-compose.yml','docker-compose.yaml'].some(f=>exists(path.join(cwd,f))),targets:new Set([...read(path.join(cwd,'Makefile')).matchAll(/^([A-Za-z0-9_.:-]+)\s*:(?!=)/gm)].map(m=>m[1]))});
  if(depth>=3)continue;try{for(const entry of fs.readdirSync(cwd,{withFileTypes:true})){if(entry.isDirectory()&&!entry.name.startsWith('.')&&!ignored.has(entry.name))queue.push({cwd:path.join(cwd,entry.name),depth:depth+1});}}catch{}
 }
 return result;
}
function invocation(command){
 let tokens=words(command);if(!tokens)return null;let relative=null;
 if(tokens[0]?.value==='cd'){if(tokens[1]?.value==='--')tokens=tokens.filter((_,i)=>i!==1);if(!tokens[2]?.operator||tokens[2].value!=='&&')return null;relative=tokens[1].value;if(path.isAbsolute(relative)||relative.startsWith('~'))return null;tokens=tokens.slice(3);}
 if(tokens.some(t=>t.operator))return null;
 let index=0;while(tokens[index]&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].value))index++;
 if(!tokens[index])return null;const executable=tokens[index].value,tool=path.basename(executable),args=tokens.slice(index+1).map(t=>t.value);
 // Scope options and shell expansion need a deliberate directory choice.
 if(args.some(a=>/^(?:--(?:dir|cwd|prefix|filter|workspace|workspaces|recursive|project-dir(?:ectory)?|file|directory)(?:=|$)|-[CFwfp](?!-))/.test(a))||tokens.some(t=>/[?*\[\]~]/.test(t.value)))return null;
 const packageManager=['npm','pnpm','yarn','bun'].includes(tool);
 const script=packageManager?(['run','run-script'].includes(args[0])?args[1]:args[0]):null;
 if(packageManager&&(!script||script.startsWith('-')))return null;
 return {tool,args,executable,script,relative};
}
function key(cwd,command){
 const call=invocation(command);
 // Package manager shorthands and generated quoted script names share one button.
 if(call?.script&&!call.relative){const tokens=words(command).map(t=>t.value),index=tokens.findIndex(v=>path.basename(v)===call.tool);const args=tokens.slice(index+1);if(['run','run-script'].includes(args[0]))args.shift();return `${cwd}\0${JSON.stringify([...tokens.slice(0,index+1),'run',...args])}`;}
 return commandKey(cwd,command);
}
function matches(call,unit,root){
 if(call.executable.startsWith('./')&&!exists(path.join(unit.cwd,call.executable)))return false;
 if(call.script)return typeof unit.scripts[call.script]==='string';
 if(['mvn','mvnw'].includes(call.tool))return unit.pom;
 if(['gradle','gradlew'].includes(call.tool))return unit.gradle;
 if(call.tool==='make'){const targets=call.args.filter(a=>!a.startsWith('-'));return targets.length>0&&targets.every(t=>unit.targets.has(t));}
 if(call.tool==='docker')return call.args[0]==='compose'&&unit.compose;
 const script=['node','python','python3','bash','sh','zsh'].includes(call.tool)?call.args[0]:call.executable.startsWith('./')?call.executable:null;
 if(!script||path.isAbsolute(script))return false;
 const target=path.resolve(unit.cwd,script);return belongs(root,path.dirname(target))&&exists(target)&&belongs(root,path.dirname(fs.realpathSync(target)));
}
export function matchHistory(workspace,candidates,base){
 const root=fs.realpathSync(workspace.path),projects=units(root),result=base.map(item=>({...item})),byKey=new Map(result.map(item=>[key(item.cwd,item.command),item]));let added=0;
 for(const candidate of candidates){
  let cwd=null,evidence='';
  if(candidate.cwd){if(!belongs(root,candidate.cwd))continue;cwd=candidate.cwd;evidence='历史命令中指定的目录';}
  else{const call=invocation(candidate.command);if(!call)continue;
   if(call.relative){const target=path.resolve(root,call.relative);const unit=projects.find(p=>p.cwd===target);if(!unit||!belongs(root,target)||!matches(call,unit,root))continue;cwd=root;evidence='匹配项目中的相对目录与脚本';}
   else{const possible=projects.filter(unit=>matches(call,unit,root));if(possible.length!==1)continue;cwd=possible[0].cwd;evidence=call.script?`匹配 package.json 中的 ${call.script}`:'匹配唯一的项目配置或脚本文件';}
  }
  const entryKey=key(cwd,candidate.command),existing=byKey.get(entryKey),history={id:candidate.id,count:candidate.count,evidence};
  if(existing){if(!existing.history||existing.history.count<candidate.count)existing.history=history;continue;}
  if(added>=24)continue;
  const item={...candidate,id:`history-${createHash('sha256').update(entryKey).digest('hex').slice(0,20)}`,cwd,history,relative:path.relative(root,cwd)||'.',evidence,detected:true,environment:'History',env:{},port:null,timeout:90,stopCommand:'',stopSignal:'SIGTERM',stopTimeout:5};
  result.push(item);byKey.set(entryKey,item);added++;
 }
 return result;
}
