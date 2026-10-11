import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const within = (root, target) => target === root || target.startsWith(root + path.sep);
// Extract explicit scratchpad/output metadata and tool path references, not ordinary prose.
export function temporaryReferences(record) {
 const result=[];
 const add=(value,file=false)=>{if(typeof value==='string'&&path.isAbsolute(value))result.push({path:value,file});};
 add(record?.attachment?.snapshot?.scratchpadDirectory);
 const input=value=>{
  if(!value||typeof value!=='object')return;
  for(const key of ['file_path','filePath','outputFile','output_file'])add(value[key],true);
  for(const key of ['path','directory','cwd'])add(value[key]);
  if(typeof value.command==='string'){
   // Literal absolute paths only. No shell evaluation, variable expansion, or execution.
   const pattern=/["'](\/(?:private\/)?(?:tmp|var\/folders)\/[^"'\n]+)["']|(\/(?:private\/)?(?:tmp|var\/folders)\/[^\s"'`<>|;&()]+)/g;
   for(const match of value.command.matchAll(pattern))add(match[1]||match[2]);
  }
 };
 for(const block of Array.isArray(record?.message?.content)?record.message.content:[]){
  if(block?.type==='tool_use')input(block.input);
 }
 for(const value of Object.values(record?.wireToolInputs||{}))input(value);
 const output=record?.toolUseResult;
 if(output&&typeof output==='object')for(const key of ['outputFile','output_file','filePath','file_path','path'])add(output[key],key!=='path');
 return result;
}
export function temporaryDirectories(references, canAccess=()=>true) {
 const roots=[os.tmpdir(),'/tmp','/private/tmp','/var/folders','/private/var/folders'].map(p=>path.resolve(p));
 const found=new Set();let missing=0;
 for(const ref of references){
  const candidate=path.resolve(ref.path);
  const root=roots.filter(r=>within(r,candidate)).sort((a,b)=>b.length-a.length)[0];
  if(!root||candidate===root||candidate.includes('/bundled-skills/')||/[\0\r\n$`*?{}]/.test(candidate)||!canAccess(candidate))continue;
  try{
   const stat=fs.lstatSync(candidate);if(stat.isSymbolicLink())continue;
   const directory=stat.isDirectory()?candidate:stat.isFile()?path.dirname(candidate):null;
   if(!directory||directory===root||!canAccess(directory))continue;
   // Reject shared temp containers; only concrete session/generated directories qualify.
   const relative=path.relative(root,directory);
   if(/^claude(?:-\d+)?$/.test(relative))continue;
   if(root.endsWith('/var/folders')&&relative.split(path.sep).length<4)continue;
   let cursor=root,valid=true;
   for(const part of relative.split(path.sep)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink()){valid=false;break;}}
   if(!valid)continue;
   const real=fs.realpathSync(directory);
   if(canAccess(real))found.add(real);
  }catch{missing++;}
 }
 // A referenced scratchpad contains its output subfolders; show one navigable root.
 const directories=[...found].sort((a,b)=>a.length-b.length).filter((p,i,all)=>!all.slice(0,i).some(parent=>within(parent,p)));
 return {directories,missing};
}
