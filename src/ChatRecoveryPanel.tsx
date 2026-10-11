import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,CheckCircle2,Download,FileText,FolderOpen,Image,Info,Loader2,MessageSquare,RefreshCw,X} from 'lucide-react';
import type {ChatRecoveryResult} from './types';
import {t} from './i18n';
const categories=[
 {key:'downloads',label:'聊天下载文件',icon:Download},
 {key:'cowork-outputs',label:'Cowork 生成文件',icon:FolderOpen},
 {key:'chat-media',label:'聊天图片与媒体',icon:Image},
 {key:'conversations',label:'聊天正文文件',icon:MessageSquare},
 {key:'local-transcripts',label:'本地会话文件',icon:MessageSquare},
 {key:'attachments',label:'附件预览',icon:FileText},
 {key:'artifact-files',label:'Artifact 文件',icon:FileText},
 {key:'projects',label:'项目资料',icon:FolderOpen},
 {key:'cowork-uploads',label:'Cowork 上传附件',icon:FolderOpen},
];
export const recoveryCategoryName=(key:string)=>t(categories.find(c=>c.key===key)?.label||key);
export function ChatRecoveryPanel({onClose,onComplete,onBrowse}:{onClose:()=>void;onComplete:(result:ChatRecoveryResult)=>Promise<void>;onBrowse:(result:ChatRecoveryResult,category:string)=>void}) {
 const [busy,setBusy]=useState(true),[result,setResult]=useState<ChatRecoveryResult|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);const started=useRef(false),dialog=useRef<HTMLElement>(null),copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const run=async()=>{setBusy(true);setError('');setResult(null);try{const r=await window.branchdeck.recoverClaudeChats();await onComplete(r);setResult(r);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 useEffect(()=>{if(!started.current){started.current=true;void run();}return()=>clearTimeout(copyTimer.current);},[]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const focusable=()=>[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),summary,[tabindex="0"]')||[])].filter(e=>e.getClientRects().length>0);
  dialog.current?.focus();
  const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!busy)onClose();}if(e.key==='Tab'){const items=focusable(),first=items[0],last=items.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}}};
  const focus=(e:FocusEvent)=>{if(dialog.current&&!dialog.current.contains(e.target as Node))dialog.current.focus();};
  document.addEventListener('keydown',keys,true);document.addEventListener('focusin',focus,true);
  return()=>{document.removeEventListener('keydown',keys,true);document.removeEventListener('focusin',focus,true);previous?.focus();};
 },[busy]);
 const browse=(category='')=>{if(result?.workspaceId){onBrowse(result,category);onClose();}};
 const copy=async()=>{try{await window.branchdeck.copyWorkspacePath(result!.workspaceId!);setError('');setCopied(true);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(false),2000);}catch{setError(t('复制失败，请在详情中选择路径复制'));}};
 const count=result?Object.values(result.files).reduce((a,b)=>a+b,0):0;
 return <div className="modal-backdrop chat-recovery-backdrop"><section ref={dialog} tabIndex={-1} className="chat-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-recovery-title" aria-busy={busy}>
 <header className="chat-recovery-header"><div className={'chat-status-icon '+(busy?'working':'')} aria-hidden="true">{busy?<Loader2 className="spin" size={21}/>:result?<CheckCircle2 size={23}/>:<Info size={23}/>}</div><div className="chat-recovery-heading"><h2 id="chat-recovery-title">{t(busy?'正在整理聊天缓存':result?'聊天缓存已整理':'未能完成扫描')}</h2><p>{t(busy?'在本机提取聊天、下载与附件':'Claude · 本地聊天资料')}</p></div><button className="icon" disabled={busy} onClick={onClose} aria-label={t('关闭')} title={t('关闭')}><X size={18}/></button></header>
 <div className="chat-recovery-body">
 {busy&&<div className="chat-recovery-progress" role="status"><div className="chat-progress-track"><span/></div><p>{t('正在读取与去重，完成后自动加入目录列表。')}</p><small>{t('无需保持 Claude 打开，不会修改原始文件。')}</small></div>}
 {error&&<p className="form-error" role="alert">{error}</p>}
 {result&&<><div className="chat-recovery-summary" aria-label={t('扫描结果')}><div><strong>{count}</strong><span>{t('已保存文件')}</span></div><div><strong>{result.conversationsWithMessages}<small> / {result.conversations}</small></strong><span>{t('有正文的会话 / 会话索引')}</span></div></div>
 <div className="chat-category-heading"><h3>{t('按类型浏览')}</h3><span>{t('点击分类直接查看')}</span></div><div className="chat-recovery-counts">{categories.filter(c=>(result.files[c.key]||0)>0).map(({key,label,icon:Icon})=><button key={key} disabled={!result.workspaceId} onClick={()=>browse(key)} aria-label={t('查看 {0}，{1} 个文件',[t(label),result.files[key]])}><span className="chat-category-icon"><Icon size={17}/></span><span className="chat-category-label">{t(label)}</span><strong>{result.files[key]}</strong><ArrowRight className="chat-category-arrow" size={14}/></button>)}</div>
 {!count&&<p className="chat-empty">{t('未找到可恢复的聊天文件。缓存可能为空或已被清理。')}</p>}
 <p className="chat-cache-note"><Info size={14}/><span>{t('仅包含本机留存内容，部分会话只有标题。')}</span></p>
 <details className="chat-recovery-details"><summary>{t('保存位置与扫描详情')}{!!result.warnings.length&&<span className="chat-warning-count">{result.warnings.length}</span>}</summary><div className="chat-location"><code>{result.output.replace(/^\/Users\/[^/]+/,'~')}</code><button disabled={!result.workspaceId} onClick={()=>void copy()}>{copied?<Check size={13}/>:null}{t(copied?'已复制':'复制路径')}</button></div><p>{t('每次扫描保存独立快照，不覆盖旧结果，不拉取云端聊天。')}</p><p>{t('文件数包括 Markdown、JSON 等不同格式及缓存版本，不等于会话数。')}</p>{!!result.warnings.length&&<div role="status"><h4>{t('部分内容未恢复')}</h4>{result.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>}</details></>}
 </div><footer className="chat-recovery-footer"><span><CheckCircle2 size={13}/>{t('仅保存在本机')}</span><div>{error&&!result&&<button className="secondary" onClick={()=>void run()}><RefreshCw size={14}/>{t('重试')}</button>}{result?.workspaceId&&<button className="secondary" onClick={()=>window.branchdeck.openWorkspace(result.workspaceId!).catch(e=>setError(String(e)))}><FolderOpen size={14}/>{t('在 Finder 中打开')}</button>}<button className="primary" disabled={busy} onClick={()=>result?.workspaceId?browse():onClose()}>{t(result?'查看全部文件':'关闭')}{result&&<ArrowRight size={14}/>}</button></div></footer>
 </section></div>;
}
