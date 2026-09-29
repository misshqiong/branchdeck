import fs from 'node:fs';
import path from 'node:path';
import {atomicJson} from './store.mjs';

// Only hides discovery entries. Never changes directories or running sessions.
export class WorkspaceCatalog {
 constructor(directory){
  this.file=path.join(directory,'removed-workspaces.json');
  try{this.entries=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(this.entries))this.entries=[];}catch{this.entries=[];}
 }
 save(){atomicJson(this.file,this.entries);}
 view(result){return {...result,workspaces:result.workspaces.filter(w=>!this.entries.some(e=>e.scope==='group'?e.groupId===w.groupId:e.path===w.path)),removed:this.entries};}
 remove(workspaces,id,scope='workspace'){
  if(!['workspace','group'].includes(scope))throw new Error('不支持的移除方式');
  const workspace=workspaces.find(w=>w.id===id);if(!workspace)throw new Error('工作区已变化，请重新扫描');
  const key=`${scope}:${scope==='group'?workspace.groupId:workspace.id}`;
  const entry={id:key,scope,path:workspace.path,groupId:workspace.groupId,name:scope==='group'?(workspace.repository||workspace.name):(workspace.displayName||workspace.name)};
  if(!this.entries.some(e=>e.id===key)){this.entries.push(entry);this.save();}return entry;
 }
 restore(id){if(!this.entries.some(e=>e.id===id))throw new Error('此目录已恢复或不存在');this.entries=this.entries.filter(e=>e.id!==id);this.save();}
 revive(root,workspaces){const workspace=workspaces.find(w=>w.path===root);const next=this.entries.filter(e=>e.path!==root&&!(e.scope==='group'&&workspace&&e.groupId===workspace.groupId));if(next.length!==this.entries.length){this.entries=next;this.save();}}
}
