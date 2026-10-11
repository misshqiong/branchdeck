import {useEffect, useRef, useState} from 'react';
import {FileText, RefreshCw, Search} from 'lucide-react';
import {t} from './i18n';
import type {ClaudeCacheFile, ClaudeCachePage} from './types';
const api = window.branchdeck;
export function ClaudeCachePanel({workspaceId}:{workspaceId:string}) {
 const [files,setFiles]=useState<ClaudeCacheFile[]>([]), [warnings,setWarnings]=useState<string[]>([]);
 const [query,setQuery]=useState(''), [kind,setKind]=useState('all'), [selected,setSelected]=useState('');
 const [page,setPage]=useState<ClaudeCachePage|null>(null), [offsets,setOffsets]=useState<number[]>([]);
 const [error,setError]=useState(''), [loading,setLoading]=useState(false), [reading,setReading]=useState(false);
 const generation=useRef(0), active=useRef(true);
 useEffect(()=>{active.current=true;void load(false);return()=>{active.current=false;generation.current++;};},[workspaceId]);
 async function load(rescan:boolean) {
  const version=++generation.current;setLoading(true);setError('');setPage(null);setSelected('');setReading(false);
  try {if(rescan)await api.discover();const result=await api.claudeCacheList(workspaceId);if(active.current&&version===generation.current){setFiles(result.files);setWarnings(result.warnings);}}
  catch(e){if(active.current&&version===generation.current)setError((e as Error).message);}
  finally{if(active.current&&version===generation.current)setLoading(false);}
 }
 async function open(fileId:string, offset=0, history:number[]=[]){
  const version=++generation.current;setSelected(fileId);setReading(true);setError('');setPage(null);
  try{const result=await api.claudeCachePreview(workspaceId,fileId,offset);if(active.current&&version===generation.current){setPage(result);setOffsets(history);}}
  catch(e){if(active.current&&version===generation.current)setError((e as Error).message);}
  finally{if(active.current&&version===generation.current)setReading(false);}
 }
 const visible=files.filter(f=>(kind==='all'||f.kind===kind)&&f.name.toLowerCase().includes(query.toLowerCase()));
 return <section className="claude-cache" aria-label={t('Claude 本地会话与文件')}>
  <header className="claude-cache-header"><div><strong>{t('Claude 本地会话与文件')}</strong><p>{t('只读 · 内容仅在打开时读取 · 不上传、不执行。分享截图前请检查个人信息。')}</p></div><button className="secondary" disabled={loading} onClick={()=>load(true)}><RefreshCw size={14}/>{t('刷新')}</button></header>
  <div className="claude-cache-filters"><Search size={14}/><input aria-label={t('搜索缓存文件')} placeholder={t('搜索缓存文件')} value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={t('文件类型')} value={kind} onChange={e=>setKind(e.target.value)}><option value="all">{t('全部文件')}</option><option value="session">{t('会话记录')}</option><option value="memory">{t('记忆文档')}</option><option value="file">{t('其他缓存文件')}</option></select><span>{visible.length}</span></div>
  {error&&<p className="form-error" role="alert">{error}</p>}{warnings.map(w=><p className="form-error" key={w}>{w}</p>)}
  <div className="claude-cache-body"><div className="claude-cache-list">{loading?<p>{t('正在扫描…')}</p>:visible.length===0?<p>{t('未找到关联文件。确认 Claude 缓存和项目目录可访问，然后刷新。')}</p>:visible.map(f=><button key={f.id} className={selected===f.id?'selected':''} onClick={()=>open(f.id)} title={f.name}><FileText size={14}/><span><b>{f.name}</b><small>{new Date(f.updatedAt).toLocaleString()} · {Math.ceil(f.size/1024)} KB</small></span></button>)}</div>
   <div className="claude-cache-reader">{reading?<p>{t('正在读取…')}</p>:page?<><div className="claude-cache-page"><span title={page.name}>{page.name}</span><small>{page.offset}–{page.nextOffset??page.size} / {page.size} B</small><button disabled={!offsets.length} onClick={()=>open(selected,offsets[offsets.length-1],offsets.slice(0,-1))}>{t('上一页')}</button><button disabled={page.nextOffset===null} onClick={()=>open(selected,page.nextOffset!,[...offsets,page.offset])}>{t('下一页')}</button></div><pre key={`${selected}:${page.offset}`}>{page.content||t('空文件')}</pre></>:<p>{t('选择会话或文档查看原始文本。JSONL 按原始记录展示，大文件分页读取。')}</p>}</div>
  </div>
 </section>;
}
