import {useEffect,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {marked} from 'marked';
import type {FilePreviewData} from './types';
import {t} from './i18n';

const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const safeDocument=(html:string)=>`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>body{font:15px/1.7 system-ui;padding:24px;color:#263a30;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}pre{overflow:auto;background:#f4f5f3;padding:16px}a{pointer-events:none;color:#526c46}</style></head><body>${DOMPurify.sanitize(html,{FORBID_TAGS:['script','iframe','object','embed','form','base','meta','link'],FORBID_ATTR:['srcset','action','formaction','href','xlink:href'],ADD_TAGS:['style']})}</body></html>`;
function RichPreview({html,workspaceId,relative}:{html:string;workspaceId:string;relative:string}) {
 const [document,setDocument]=useState('');
 useEffect(()=>{let stopped=false;
  (async()=>{const template=window.document.createElement('template');template.innerHTML=DOMPurify.sanitize(html);let bytes=0;
   for(const image of [...template.content.querySelectorAll('img')].slice(0,20)) {
    const src=image.getAttribute('src')||'';if(!src||/^(?:[a-z]+:|\/\/)/i.test(src))continue;
    try{const folder=relative.split('/').slice(0,-1).join('/');const asset=await window.branchdeck.filePreview(workspaceId,(folder?folder+'/':'')+decodeURIComponent(src.split(/[?#]/)[0]));if(stopped)return;
     if(asset.kind==='image'&&asset.base64&&(bytes+=asset.size)<=16*1024*1024)image.setAttribute('src',`data:${asset.mime};base64,${asset.base64}`);
    }catch{image.setAttribute('alt',(image.getAttribute('alt')||'')+' [image unavailable]');}
   }
   if(!stopped)setDocument(safeDocument(template.innerHTML));
  })().catch(()=>{if(!stopped)setDocument(safeDocument(html));});return()=>{stopped=true;};
 },[html,workspaceId,relative]);
 return document?<iframe key={document} title={t('文档阅读视图')} sandbox="" referrerPolicy="no-referrer" srcDoc={document}/>:<p>{t('加载中…')}</p>;
}
function PdfPreview({base64}:{base64:string}) {
 const [document,setDocument]=useState<import('pdfjs-dist').PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[error,setError]=useState(''),[rendering,setRendering]=useState(true);const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let stopped=false;let task:import('pdfjs-dist').PDFDocumentLoadingTask|undefined;
  (async()=>{const pdf=await import('pdfjs-dist');const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdf.GlobalWorkerOptions.workerSrc=worker.default;
   if(stopped)return;task=pdf.getDocument({data:decode(base64),useSystemFonts:true});const doc=await task.promise;if(!stopped)setDocument(doc);
  })().catch(e=>{if(!stopped){setError(String(e.message||e));setRendering(false);}});
  return()=>{stopped=true;void task?.destroy();};
 },[base64]);
 useEffect(()=>{if(!document)return;let stopped=false;let job:import('pdfjs-dist').RenderTask|undefined;setRendering(true);setError('');
  (async()=>{const p=await document.getPage(page);if(stopped||!canvas.current)return;const viewport=p.getViewport({scale:zoom});const scale=Math.min(devicePixelRatio||1,2);const c=canvas.current;c.width=Math.floor(viewport.width*scale);c.height=Math.floor(viewport.height*scale);c.style.width=viewport.width+'px';c.style.height=viewport.height+'px';job=p.render({canvas:c,viewport,transform:scale===1?undefined:[scale,0,0,scale,0,0]});await job.promise;if(!stopped)setRendering(false);})().catch(e=>{if(!stopped){setError(String(e.message||e));setRendering(false);}});
  return()=>{stopped=true;job?.cancel();};
 },[document,page,zoom]);
 return <><div className="preview-controls"><button disabled={!document||page===1} onClick={()=>setPage(p=>p-1)}>{t('上一页')}</button><span>{page} / {document?.numPages||'…'}</span><button disabled={!document||page===document.numPages} onClick={()=>setPage(p=>p+1)}>{t('下一页')}</button><select aria-label={t('缩放')} value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v*100}%</option>)}</select>{rendering&&<span>{t('加载中…')}</span>}</div>{error&&<p role="alert">{error}</p>}<div className="preview-document"><canvas ref={canvas} aria-label={t('PDF 页面')}/></div></>;
}
function ImagePreview({data}:{data:FilePreviewData}) {
 const [zoom,setZoom]=useState('fit'),[error,setError]=useState(false);
 return <><div className="preview-controls"><select aria-label={t('缩放')} value={zoom} onChange={e=>setZoom(e.target.value)}><option value="fit">{t('适应窗口')}</option>{[50,100,150,200].map(n=><option key={n} value={n}>{n}%</option>)}</select></div><div className="preview-image">{error?<p>{t('图片无法解码，请在 Finder 中打开')}</p>:<img alt={data.path.split('/').pop()} src={`data:${data.mime};base64,${data.base64}`} style={zoom==='fit'?{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}:{maxWidth:'none',zoom:Number(zoom)/100}} onError={()=>setError(true)}/>}</div></>;
}
function parseCsv(text:string,delimiter:string) {const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';if(rows.length>=1000)break;}else field+=c;}if((row.length||field)&&rows.length<1000){row.push(field);rows.push(row);}return rows.map(r=>r.slice(0,100));}
function SheetPreview({data}:{data:FilePreviewData}) {
 const [sheets,setSheets]=useState<{name:string;rows:string[][]}[]>([]),[selected,setSelected]=useState(0),[error,setError]=useState('');
 useEffect(()=>{let stopped=false;
  if(data.kind==='csv'){setSheets([{name:'CSV',rows:parseCsv(data.content,data.path.endsWith('.tsv')?'\t':',')}]);return;}
  (async()=>{const Excel=await import('exceljs');const book=new Excel.Workbook();await book.xlsx.load(decode(data.base64!).buffer as never);const loaded=book.worksheets.map(sheet=>{const rows:string[][]=[];for(let r=1;r<=Math.min(sheet.rowCount,1000);r++){const row:string[]=[];for(let c=1;c<=Math.min(sheet.columnCount,100);c++){const cell=sheet.getCell(r,c);let value=cell.value;if(value&&typeof value==='object'&&'formula'in value)value=value.result??('='+value.formula);row.push(value instanceof Date?value.toLocaleString():value&&typeof value==='object'&&'richText'in value?value.richText.map(v=>v.text).join(''):value&&typeof value==='object'&&'text'in value?String(value.text):String(value??''));}rows.push(row);}return {name:sheet.name,rows};});if(!stopped){setSheets(loaded);if(!loaded.length)setError(t('工作簿中没有可预览的工作表'));}})().catch(e=>{if(!stopped)setError(String(e.message||e));});return()=>{stopped=true;};
 },[data]);
 return <><div className="preview-controls"><select aria-label={t('工作表')} value={selected} onChange={e=>setSelected(Number(e.target.value))}>{sheets.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select><span>{t('每张表最多显示 1000 行、100 列；公式显示已保存结果')}</span></div>{error?<p role="alert">{error}</p>:!sheets.length?<p>{t('加载中…')}</p>:<div className="preview-table"><table><tbody>{sheets[selected]?.rows.map((row,i)=><tr key={i}><th>{i+1}</th>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</>;
}
export function FilePreviewPanel({initial,workspaceId,relative}:{initial:FilePreviewData;workspaceId:string;relative:string}) {
 const [data,setData]=useState(initial),[history,setHistory]=useState<number[]>([]),[source,setSource]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const alive=useRef(true);
 useEffect(()=>()=>{alive.current=false;},[]);
 const changePage=async(back=false)=>{setBusy(true);setError('');try{const offset=back?history.at(-1)!:data.nextOffset!;const result=await window.branchdeck.filePreview(workspaceId,relative,offset);if(alive.current){setHistory(h=>back?h.slice(0,-1):[...h,data.offset]);setData(result);}}catch(e){if(alive.current)setError(String(e));}finally{if(alive.current)setBusy(false);}};
 const rich=['markdown','html','json','csv'].includes(data.kind);let content=data.content;
 if(data.kind==='json'&&!source&&!data.nextOffset&&!data.offset){try{content=JSON.stringify(JSON.parse(content),null,2);}catch{}}
 let html='';if(data.kind==='markdown')html=marked.parse(data.content,{async:false}) as string;else if(data.kind==='html')html=data.content;
 return <section className="file-preview" aria-label={t('文件预览')}><div className="preview-path">{data.path}</div><div className="preview-controls"><span>{(data.size/1024).toFixed(1)} KB</span>{rich&&<button onClick={()=>setSource(v=>!v)}>{source?t('阅读视图'):t('源文件')}</button>}<button onClick={()=>window.branchdeck.fileReveal(workspaceId,relative).catch(e=>setError(String(e)))}>{t('在 Finder 中显示')}</button>{(data.nextOffset!==null||history.length>0)&&<><button disabled={busy||!history.length} onClick={()=>void changePage(true)}>{t('上一段')}</button><span>{data.offset}–{data.nextOffset??data.size} / {data.size} bytes</span><button disabled={busy||data.nextOffset===null} onClick={()=>void changePage()}>{t('下一段')}</button></>}</div>{error&&<p role="alert">{error}</p>}
 {data.kind==='unsupported'?<p>{t(data.reason||'无法预览')}</p>:data.kind==='image'?<ImagePreview data={data}/>:data.kind==='pdf'?<PdfPreview base64={data.base64!}/>:data.kind==='spreadsheet'||data.kind==='csv'&&!source&&data.offset===0&&data.nextOffset===null?<SheetPreview data={data}/>:!source&&['html','markdown'].includes(data.kind)?<><div className="preview-notice">{t('只读预览：脚本、外部资源和链接跳转已停用')}{data.nextOffset!==null?' · '+t('当前仅显示文件的一部分'):''}</div><RichPreview html={html} workspaceId={workspaceId} relative={relative}/></>:<pre>{content}</pre>}
 </section>;
}
