import {useEffect,useRef,useState} from 'react';
import type {CSSProperties,PointerEvent} from 'react';
const defaults={sidebar:224,tools:326};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
type Panel=keyof typeof defaults;
export function usePanelLayout(toolsHidden:boolean){
 const [widths,setWidths]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('panel-widths')||'{}');return {sidebar:Number.isFinite(saved.sidebar)?saved.sidebar:defaults.sidebar,tools:Number.isFinite(saved.tools)?saved.tools:defaults.tools};}catch{return defaults;}});
 const [viewport,setViewport]=useState(innerWidth),[dragging,setDragging]=useState<Panel|null>(null);
 const current=useRef(widths);current.current=widths;
 const drag=useRef<{panel:Panel;start:number;width:number}|null>(null);
 useEffect(()=>{const resize=()=>setViewport(innerWidth);window.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);document.body.classList.remove('resizing-panels');};},[]);
 const sidebarMax=Math.min(380,viewport-340-(toolsHidden?6:272));
 const sidebar=clamp(widths.sidebar,180,sidebarMax),toolsMax=Math.min(560,viewport-sidebar-352),tools=clamp(widths.tools,260,toolsMax);
 const update=(panel:Panel,value:number,persist=false)=>{const next={...current.current,[panel]:clamp(Math.round(value),panel==='sidebar'?180:260,panel==='sidebar'?sidebarMax:toolsMax)};current.current=next;setWidths(next);if(persist)localStorage.setItem('panel-widths',JSON.stringify(next));};
 const finish=()=>{if(!drag.current)return;drag.current=null;setDragging(null);document.body.classList.remove('resizing-panels');localStorage.setItem('panel-widths',JSON.stringify(current.current));};
 const splitter=(panel:Panel)=>({
  role:'separator',tabIndex:0,'aria-label':panel==='sidebar'?'调整工作区列宽':'调整工具列宽','aria-orientation':'vertical' as const,'aria-valuenow':panel==='sidebar'?sidebar:tools,'aria-valuemin':panel==='sidebar'?180:260,'aria-valuemax':panel==='sidebar'?sidebarMax:toolsMax,
  title:'拖动调整宽度 · 双击恢复默认',className:`panel-resizer ${dragging===panel?'dragging':''}`,
  onPointerDown:(event:PointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={panel,start:event.clientX,width:panel==='sidebar'?sidebar:tools};setDragging(panel);document.body.classList.add('resizing-panels');},
  onPointerMove:(event:PointerEvent<HTMLDivElement>)=>{if(drag.current?.panel===panel)update(panel,drag.current.width+event.clientX-drag.current.start);},
  onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,
  onDoubleClick:()=>update(panel,defaults[panel],true),
  onKeyDown:(event:React.KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();update(panel,event.key==='Home'?defaults[panel]:(panel==='sidebar'?sidebar:tools)+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?40:10),true);}}
 });
 return {style:{'--sidebar-width':`${sidebar}px`,'--tools-width':`${tools}px`} as CSSProperties,splitter};
}
