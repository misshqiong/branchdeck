import fs from 'node:fs';
import path from 'node:path';
import {run} from './system.mjs';
import {parseWorktrees} from './discovery.mjs';
export const within=(root,value)=>typeof value==='string'&&(value===root||value.startsWith(root+path.sep));
export function inspectFolder(root,relative='',protectedPaths=[]){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(path.sep).some(p=>p==='..'||p==='.git'))throw new Error('请选择工作区内的普通文件夹');
 const base=fs.realpathSync(root),target=path.resolve(base,relative),stat=fs.lstatSync(target);
 if(path.basename(target)==='.git'||!within(base,target)||stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(target)!==target)throw new Error('不能删除符号链接或工作区以外的目录');
 if(['/', '/Users','/Applications','/Library','/System','/Volumes','/private','/usr','/bin','/sbin','/opt'].includes(target)||['/System','/Library','/usr','/bin','/sbin'].some(p=>within(p,target))||protectedPaths.some(p=>within(target,p)))throw new Error('不能删除主目录、系统目录或 BranchDeck 正在使用的目录');
 return {path:target,dev:stat.dev,ino:stat.ino};
}
export function sameFolder(before,after){if(before.path!==after.path||before.dev!==after.dev||before.ino!==after.ino)throw new Error('文件夹已被替换，请重新选择后再删除');}
export async function checkLinkedWorktrees(target){
 if(!fs.existsSync(path.join(target,'.git'))||!fs.statSync(path.join(target,'.git')).isDirectory())return;
 const entries=parseWorktrees(await run('/usr/bin/git',['-C',target,'worktree','list','--porcelain','-z']));
 const outside=entries.filter(w=>fs.existsSync(w.path)&&!within(target,fs.realpathSync(w.path)));
 if(outside.length)throw new Error(`此仓库仍被其它 worktree 使用，请先处理这些目录：\n${outside.map(w=>w.path).join('\n')}`);
}
export async function checkExternalCwd(target,ownedPids=[]){
 const [processes,cwds]=await Promise.all([run('/bin/ps',['-axo','pid=,ppid=']),run('/usr/sbin/lsof',['-nP','-a','-u',String(process.getuid()),'-d','cwd','-Fpn'],{timeout:8000,maxBuffer:4*1024*1024})]);
 const owned=new Set(ownedPids.filter(Boolean)),rows=processes.split('\n').map(l=>l.trim().split(/\s+/).map(Number));
 for(let changed=true;changed;){changed=false;for(const [pid,ppid] of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 let pid;const external=[];for(const line of cwds.split('\n')){if(line[0]==='p')pid=Number(line.slice(1));if(line[0]==='n'&&within(target,line.slice(1))&&!owned.has(pid))external.push(pid);}
 if(external.length)throw new Error(`其它程序正在使用此文件夹（PID ${[...new Set(external)].join('、')}），请在原程序中关闭后再删除。`);
}
export class FolderTrash {
 constructor({protectedPaths=[],related,confirm,close,trash,external=checkExternalCwd,linked=checkLinkedWorktrees}){Object.assign(this,{protectedPaths,related,confirm,close,trash,external,linked});this.busy=false;}
 async delete(root,relative=''){
  if(this.busy)throw new Error('正在处理另一个文件夹，请稍后重试');this.busy=true;
  try{
   const original=inspectFolder(root,relative,this.protectedPaths);
   await this.linked(original.path);const related=this.related(original.path);
   await this.external(original.path,related.map(s=>s.pid));
   if(!await this.confirm(original.path,related))return {deleted:false,path:original.path};
   sameFolder(original,inspectFolder(root,relative,this.protectedPaths));await this.linked(original.path);
   const current=this.related(original.path);if(current.some(s=>!related.some(old=>old.id===s.id)))throw new Error('有新的终端进入此目录，请重新确认删除');
   await this.external(original.path,current.map(s=>s.pid));
   for(const item of current)await this.close(item);
   sameFolder(original,inspectFolder(root,relative,this.protectedPaths));await this.external(original.path,[]);
   // Do not fall back to permanent deletion when the OS refuses to trash a directory.
   sameFolder(original,inspectFolder(root,relative,this.protectedPaths));
   await this.trash(original.path);return {deleted:true,path:original.path};
  }finally{this.busy=false;}
 }
}
