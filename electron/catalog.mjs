import fs from 'node:fs';
import path from 'node:path';
import {commandKey} from './history.mjs';
import {atomicJson} from './store.mjs';

// Discovery never executes commands. This file only remembers a user's shortlist.
export class CommandCatalog {
 constructor(directory) {
  this.revision=0;
  this.file=path.join(directory,'command-catalog.json');
  try { this.state=JSON.parse(fs.readFileSync(this.file,'utf8')); } catch { this.state={}; }
 }
 save(){atomicJson(this.file,this.state);this.revision++;}
 reconcile(workspace,items,savedConfigs=[]) {
  let entry=this.state[workspace.id];
  if(!entry){
   const history=items.filter(l=>l.history).sort((a,b)=>b.history.count-a.history.count);
   const fallback=items.filter(l=>l.detected&&l.category!=='git'&&!l.history);
   const git=items.filter(l=>l.category==='git'&&/^git (?:--no-pager )?(status|diff)(\s|$)/.test(l.command));
   const initial=[...items.filter(l=>!l.detected),...history.slice(0,8),...fallback.slice(0,history.length?1:4),...git];
   entry=this.state[workspace.id]={accepted:Object.fromEntries(initial.map(l=>[l.id,l])),dismissed:[]};this.save();
  }
  let changed=false;
  if(!entry.order){entry.order=Object.keys(entry.accepted);changed=true;}
  if(!entry.removed){entry.removed={};changed=true;}
  const removedKeys=new Set(Object.values(entry.removed).map(r=>commandKey(r.item.cwd,r.item.command)));
  const hidden=l=>!!entry.removed[l.id]||removedKeys.has(commandKey(l.cwd,l.command));
  const ids=new Set(items.map(l=>l.id)),savedIds=new Set(savedConfigs.map(l=>l.id));
  for(const [id,old] of Object.entries(entry.accepted))if(!ids.has(id)&&(old.detected===false||savedIds.has(id))){delete entry.accepted[id];changed=true;}
  for(const l of items)if(!hidden(l)&&(!l.detected||entry.accepted[l.id])){
   if(JSON.stringify(entry.accepted[l.id])!==JSON.stringify(l)){entry.accepted[l.id]=l;changed=true;}
  }
  // A manually imported/edited version replaces a discovered copy with the same command.
  for(const saved of items.filter(l=>!l.detected))for(const [id,old] of Object.entries(entry.accepted))if(id!==saved.id&&commandKey(old.cwd,old.command)===commandKey(saved.cwd,saved.command)){delete entry.accepted[id];entry.order=entry.order.map(value=>value===id?saved.id:value);changed=true;}
  const ordered=[...new Set([...entry.order,...Object.keys(entry.accepted)])].filter(id=>entry.accepted[id]&&!hidden(entry.accepted[id]));
  if(JSON.stringify(ordered)!==JSON.stringify(entry.order)){entry.order=ordered;changed=true;}
  if(changed)this.save();
  const current=new Map(items.map(l=>[l.id,l]));
  const commands=entry.order.map(id=>entry.accepted[id]).filter(l=>fs.existsSync(l.cwd)).map(l=>current.get(l.id)||l);
  return {commands,removed:Object.values(entry.removed).map(r=>r.item),suggestions:items.filter(l=>!hidden(l)&&!entry.accepted[l.id]&&!entry.dismissed.includes(l.id)&&!commands.some(c=>commandKey(c.cwd,c.command)===commandKey(l.cwd,l.command)))};
 }
 decide(workspace,items,id,decision,savedConfigs=[]){
  const view=this.reconcile(workspace,items,savedConfigs),item=view.suggestions.find(l=>l.id===id);
  if(!item||!['accept','dismiss'].includes(decision))throw new Error('建议已更新，请刷新后重试');
  const entry=this.state[workspace.id];
  if(decision==='accept')entry.accepted[id]=item;else entry.dismissed.push(id);
  this.save();return this.reconcile(workspace,items,savedConfigs);
 }
 move(workspace,items,id,targetId,after=false,savedConfigs=[]){
  const view=this.reconcile(workspace,items,savedConfigs);
  if(!view.commands.some(l=>l.id===id)||!view.commands.some(l=>l.id===targetId))throw new Error('命令列表已变化，请重新拖动');
  if(id!==targetId){const entry=this.state[workspace.id],order=entry.order.filter(value=>value!==id);order.splice(order.indexOf(targetId)+(after?1:0),0,id);entry.order=order;this.save();}
  return this.reconcile(workspace,items,savedConfigs);
 }
 remove(workspace,items,id,savedConfigs=[]){
  const view=this.reconcile(workspace,items,savedConfigs),item=view.commands.find(l=>l.id===id);
  if(!item)throw new Error('命令已移除或不属于当前工作区');
  const entry=this.state[workspace.id];entry.removed[id]={item,index:entry.order.indexOf(id)};delete entry.accepted[id];entry.order=entry.order.filter(value=>value!==id);this.save();
  return this.reconcile(workspace,items,savedConfigs);
 }
 restore(workspace,items,id,savedConfigs=[]){
  this.reconcile(workspace,items,savedConfigs);const entry=this.state[workspace.id],removed=entry.removed[id];
  if(!removed)throw new Error('此命令已恢复或不存在');
  delete entry.removed[id];entry.accepted[id]=removed.item;entry.order.splice(Math.min(removed.index,entry.order.length),0,id);this.save();return this.reconcile(workspace,items,savedConfigs);
 }
 revive(config){let changed=false;for(const entry of Object.values(this.state))for(const [id,removed] of Object.entries(entry.removed||{}))if(id===config.id||commandKey(removed.item.cwd,removed.item.command)===commandKey(config.cwd,config.command)){delete entry.removed[id];changed=true;}if(changed)this.save();}
 forget(id){for(const entry of Object.values(this.state))delete entry.accepted[id];this.save();}
}
