import {useEffect,useRef,useState} from 'react';
import {Terminal as XTerm} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {Check,Copy,Maximize2,Minimize2,Terminal,Trash2} from 'lucide-react';
import type {Session,SessionEvent} from './types';
import '@xterm/xterm/css/xterm.css';
const api=window.branchdeck;
const labels:Record<string,string>={starting:'启动中',idle:'空闲',busy:'运行中',running:'运行中',ready:'已就绪',unhealthy:'未就绪',stopping:'停止中',exited:'已退出'};
export function TerminalPanel({session,visible,onError,expanded,onExpand}:{session:Session;visible:boolean;onError:(error:string)=>void;expanded:boolean;onExpand:()=>void}){
 const host=useRef<HTMLDivElement>(null),terminal=useRef<XTerm|null>(null),fitRef=useRef<FitAddon|null>(null),state=useRef(session),[copied,setCopied]=useState(false);state.current=session;
 useEffect(()=>{
  if(!host.current)return;
  const term=new XTerm({fontFamily:'"SFMono-Regular", Menlo, monospace',fontSize:12,lineHeight:1.4,cursorBlink:true,scrollback:10000,screenReaderMode:true,theme:{background:'#17211e',foreground:'#dce6de',cursor:'#c7e5b2',selectionBackground:'#506d5b',black:'#22332b',red:'#ef9e91',green:'#b2d791',yellow:'#e3cb8d',blue:'#91b9e9',magenta:'#c7aae5',cyan:'#8dc8c3',white:'#e1e8df',brightBlack:'#829889',brightRed:'#ffb5a8',brightGreen:'#c9e9ac',brightYellow:'#f5dfab',brightBlue:'#b0d0f4',brightMagenta:'#dec0f4',brightCyan:'#a4e0d7',brightWhite:'#ffffff'}});
  const fit=new FitAddon();term.loadAddon(fit);term.open(host.current);terminal.current=term;fitRef.current=fit;
  let disposed=false,ready=false,sequence=0;const pending:SessionEvent[]=[];
  const accept=(event:SessionEvent)=>{if(event.sessionId!==session.id)return;if(!ready){pending.push(event);return;}if(event.sequence>sequence){sequence=event.sequence;term.write(event.data);}};
  const off=api.onSessionData(accept);
  const resize=()=>{if(disposed||!host.current?.clientHeight||!host.current?.clientWidth)return;fit.fit();api.sessionResize(session.id,term.cols,term.rows).catch(()=>{});};
  const observer=new ResizeObserver(resize);observer.observe(host.current);resize();
  api.sessionSnapshot(session.id).then(snapshot=>{if(disposed)return;term.write(snapshot.data);sequence=snapshot.sequence;ready=true;pending.forEach(accept);resize();if(host.current?.clientWidth)term.focus();}).catch(error=>{if(!disposed)onError(error.message);});
  const input=term.onData(value=>{if(state.current.status!=='exited')api.sessionInput(session.id,value).catch(error=>!disposed&&onError(error.message));});
  return()=>{disposed=true;off();input.dispose();observer.disconnect();term.dispose();terminal.current=null;fitRef.current=null;};
 },[session.id]);
 useEffect(()=>{if(visible){fitRef.current?.fit();terminal.current?.focus();}},[visible]);
 const copy=async()=>{const term=terminal.current;if(!term)return;try{const value=term.getSelection()||Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true)||'').join('\n');await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1200);}catch(error){onError((error as Error).message);}};
 return <section className="terminal-dock" aria-label="交互终端" hidden={!visible} data-session-id={session.id}><div className="terminal-head"><Terminal size={15}/><strong>{session.kind==='shell'?'zsh':'服务'}</strong><span className={`terminal-status ${session.status}`}>{labels[session.status]||session.status}</span><span className="session-cwd" title={session.cwd}>{session.cwd.replace(/^\/Users\/[^/]+/,'~')}</span><div className="terminal-actions"><button disabled={session.status==='exited'} title="发送 Ctrl+C" onClick={()=>api.sessionInput(session.id,'\x03').catch(error=>onError(error.message))}>Ctrl+C</button><button className="icon" title="复制终端输出" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>}</button><button className="icon" title="清空终端显示" onClick={()=>terminal.current?.clear()}><Trash2 size={15}/></button><button className="icon" title={expanded?'还原终端':'放大终端'} onClick={onExpand}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button></div></div><div className="terminal-screen" ref={host}/><div className="terminal-foot"><span>{session.status==='exited'?'Shell 已退出 · 输出保留':session.kind==='service'?'独立服务终端 · 停止后返回 Shell':session.busy?'程序运行中 · Ctrl+C 中断':session.draft?'输入尚未提交 · Enter 执行':'可以直接输入命令 · Tab 补全 · ↑ 查看历史'}</span><span>⌘T 新终端 · ⌘B 收起工具</span></div></section>;
}
