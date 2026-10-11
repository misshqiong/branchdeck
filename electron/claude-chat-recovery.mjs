import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';

const initial = 0xfcfb6d1ba7725c30n, final = 0xf4fa6f45970d41d8n;
const hash = b => createHash('sha256').update(b).digest('hex');
const maxBytes = 128 * 1024 * 1024;
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object?.[k] !== undefined).map(k => [k, object[k]]));
const cleanName = name => {
  let value = path.basename(String(name || 'file').replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f/:]/g, '_').replace(/^\.+/, '_');
  while(Buffer.byteLength(value)>180)value=[...value].slice(0,-1).join('');
  return value || 'file';
};
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for(let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

// Chromium Simple Cache v5: body stream, EOF, HTTP metadata stream, optional key SHA, EOF.
// https://chromium.googlesource.com/chromium/src/+/master/net/disk_cache/simple/simple_entry_format.h
export function parseCache(buffer) {
  if(buffer.length < 72 || buffer.length > maxBytes || buffer.readBigUInt64LE(0) !== initial || buffer.readUInt32LE(8) !== 5) throw Error('Unsupported cache entry');
  const keyLength = buffer.readUInt32LE(12), bodyStart = 24 + keyLength, eof = buffer.length - 24;
  if(keyLength > 65536 || bodyStart > eof || buffer.readBigUInt64LE(eof) !== final) throw Error('Incomplete cache entry');
  const flags = buffer.readUInt32LE(eof+8), headerSize = buffer.readUInt32LE(eof+16);
  const headerEnd = eof - ((flags & 2) ? 32 : 0), headerStart = headerEnd - headerSize, bodyEnd = headerStart - 24;
  if(bodyEnd < bodyStart || buffer.readBigUInt64LE(bodyEnd) !== final) throw Error('Incomplete cache streams');
  const keyBytes = buffer.subarray(24, bodyStart);
  if((flags & 2) && !createHash('sha256').update(keyBytes).digest().equals(buffer.subarray(headerEnd, eof))) throw Error('Cache key checksum mismatch');
  let body = buffer.subarray(bodyStart, bodyEnd);
  if((buffer.readUInt32LE(bodyEnd+8) & 1) && crc32(body) !== buffer.readUInt32LE(bodyEnd+12)) throw Error('Cache body checksum mismatch');
  const headers = buffer.subarray(headerStart, headerEnd);
  if((flags & 1) && crc32(headers) !== buffer.readUInt32LE(eof+12)) throw Error('Cache headers checksum mismatch');
  const headerText = headers.toString('latin1');
  const header = name => headerText.match(new RegExp(`(?:^|[\\0\\r\\n])${name}:\\s*([^\\0\\r\\n]*)`, 'i'))?.[1]?.trim() || '';
  const encoding = header('content-encoding').toLowerCase();
  const options = {maxOutputLength:maxBytes};
  if(encoding === 'gzip') body = zlib.gunzipSync(body, options);
  else if(encoding === 'br') body = zlib.brotliDecompressSync(body, options);
  else if(encoding === 'deflate') body = zlib.inflateSync(body, options);
  else if(encoding === 'zstd') {
    if(!zlib.zstdDecompressSync) throw Error('Zstandard requires a newer Node runtime');
    body = zlib.zstdDecompressSync(body, options);
  } else if(encoding && encoding !== 'identity') throw Error('Unsupported content encoding');
  return {key:keyBytes.toString(), body, mime:header('content-type'), disposition:header('content-disposition'), status:Number(headerText.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1] || 0)};
}

export function cacheCategory(key) {
  let url;try { url = new URL(key.match(/https?:\/\/[^\s]+/)?.[0]); } catch { return null; }
  const p = url.pathname;
  let kind;
  if(url.hostname === 'claude.ai') {
    if(/\/conversations\/[^/]+\/wiggle\/download-file$/.test(p)) kind='downloads';
    else if(/\/chat_conversations\/[^/]+$/.test(p)) kind='conversations';
    else if(/\/chat_conversations(?:_v2)?$/.test(p)) kind='indexes';
    else if(/\/artifacts\/[^/]+\/versions$/.test(p)) kind='artifacts';
    else if(/\/files\/[^/]+\/(?:preview|download)$/.test(p)) kind='attachments';
    else if(/\/projects\/[^/]+(?:\/files)?$/.test(p)) kind='projects';
  } else if(url.hostname.endsWith('.claudeusercontent.com') && /\/(?:project|files)\//.test(p)) kind='artifact-files';
  return kind ? {kind,url} : null;
}
function filename(entry, url) {
  let name = entry.disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if(name) {try {name=decodeURIComponent(name);} catch {}}
  name ||= entry.disposition.match(/filename="([^"]+)"/i)?.[1] || entry.disposition.match(/filename=([^;]+)/i)?.[1];
  name ||= url.searchParams.get('filename') || url.searchParams.get('file_name') || url.searchParams.get('path') || url.searchParams.get('file_path');
  if(!name && /\/(?:project|files)\//.test(url.pathname)) name = decodeURIComponent(url.pathname.split('/').at(-1));
  if(!name) {
    const b=entry.body, text=b.subarray(0,128).toString();
    const ext=b.subarray(0,4).toString()==='%PDF'?'.pdf':b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'.png':b[0]===255&&b[1]===216?'.jpg':b[0]===80&&b[1]===75?'.zip':/^\s*<svg/i.test(text)?'.svg':/^\s*(?:<!doctype html|<html)/i.test(text)?'.html':/json/i.test(entry.mime)?'.json':b.includes(0)?'.bin':'.txt';
    name='cached-file'+ext;
  }
  return cleanName(name);
}
function markdownChat(chat) {
  const sections=[`# ${chat.name || 'Claude conversation'}`, chat.summary || '', '> Recovered local cache snapshot. Missing messages and branches may not be cached.'];
  for(const message of chat.chat_messages || []) {
    sections.push(`## ${message.sender || 'message'} · ${message.created_at || ''}`);
    if(message.text) sections.push(message.text);
    for(const block of message.content || []) {
      if(block.type==='text' && block.text) {if(block.text!==message.text) sections.push(block.text);}
      else sections.push('```json\n'+JSON.stringify(block,null,2)+'\n```');
    }
    if(message.truncated) sections.push('> This message was marked truncated by Claude.');
    for(const field of ['attachments','files']) if(message[field]?.length) sections.push(`### ${field}\n\n\`\`\`json\n${JSON.stringify(message[field],null,2)}\n\`\`\``);
  }
  return sections.join('\n\n')+'\n';
}
export async function recoverClaudeChats({home=os.homedir(), destination=path.join(home,'Library','Application Support','BranchDeck','Claude Chat Archive'), canAccess=()=>true}={}) {
  const source=path.join(home,'Library','Application Support','Claude');
  // A fresh private snapshot avoids replacing prior recovery results or following destination symlinks.
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  if(fs.realpathSync(destination)!==path.resolve(destination)) throw Error('Recovery destination must not contain symlinks');
  const output=fs.mkdtempSync(path.join(destination,'Claude Chats '+new Date().toISOString().slice(0,10)+'-'));fs.chmodSync(output,0o700);
  const records=[], warnings=new Set(), counts={cacheEntries:0,relevantEntries:0,failedEntries:0,ignoredErrors:0,emptyArtifacts:0};
  const known=new Map(), conversations=new Map();
  const safe=p=>{try{return canAccess(p)&&!fs.lstatSync(p).isSymbolicLink()&&fs.realpathSync(p)===p;}catch{return false;}};
  const save=(category,name,body,provenance)=>{
    const digest=hash(body), duplicate=known.get(category+digest);
    if(duplicate){duplicate.sources.push(provenance);return duplicate.file;}
    const relative=path.join(category,digest.slice(0,12)+'-'+cleanName(name));
    fs.mkdirSync(path.join(output,category),{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(output,relative),body,{flag:'wx',mode:0o600});
    const record={file:relative,sha256:digest,bytes:body.length,sources:[provenance]};records.push(record);known.set(category+digest,record);return relative;
  };
  const media=(value,provenance)=>{
    if(Array.isArray(value))return value.map(v=>media(v,provenance));
    if(!value||typeof value!=='object')return value;
    if(typeof value.base64==='string'&&/^[A-Za-z0-9+/=\s]+$/.test(value.base64)){
      const bytes=Buffer.from(value.base64,'base64');
      const ext=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'.png':bytes[0]===255&&bytes[1]===216?'.jpg':'.bin';
      const {base64,...metadata}=value;
      return {...metadata,localFile:save('chat-media','attachment'+ext,bytes,provenance)};
    }
    if(value.type==='thinking'&&value.signature){const {signature,...rest}=value;return media(rest,provenance);}
    const mime=value.media_type||value.mimeType;
    if((value.type==='base64'||value.type==='image')&&typeof value.data==='string'&&typeof mime==='string'&&/^[A-Za-z0-9+/=\s]+$/.test(value.data)){
      const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf'}[mime]||'.bin';
      const file=save('chat-media','attachment'+ext,Buffer.from(value.data,'base64'),provenance);
      return {type:'local_file',media_type:mime,file};
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,media(v,provenance)]));
  };
  const cache=path.join(source,'Cache','Cache_Data');
  if(safe(cache)) for(const item of fs.readdirSync(cache,{withFileTypes:true})) {
    if(!item.isFile()||!item.name.endsWith('_0'))continue;
    counts.cacheEntries++;
    const file=path.join(cache,item.name);let descriptor;
    try {
      if(!safe(file)) continue;
      descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const header=Buffer.alloc(24);if(fs.readSync(descriptor,header,0,24,0)!==24||header.readBigUInt64LE()!==initial)continue;
      const size=header.readUInt32LE(12);if(size>65536)continue;
      const key=Buffer.alloc(size);if(fs.readSync(descriptor,key,0,size,24)!==size)continue;
      const category=cacheCategory(key.toString());if(!category)continue;counts.relevantEntries++;
      if(fs.fstatSync(descriptor).size>maxBytes)throw Error('Cache entry exceeds 128 MiB');
      const entry=parseCache(fs.readFileSync(descriptor));
      if(entry.key!==key.toString())throw Error('Cache entry changed during recovery');
      if(entry.status && (entry.status<200||entry.status>=300)){counts.ignoredErrors++;continue;}
      const {kind,url}=category;
      const provenance={kind,cacheFile:item.name,conversationId:url.pathname.match(/\/(?:chat_conversations|conversations)\/([^/]+)/)?.[1]};
      let json;try{json=JSON.parse(entry.body.toString());}catch{}
      if(json?.error || json?.type==='error'){counts.ignoredErrors++;continue;}
      if(kind==='conversations') {
        if(!Array.isArray(json?.chat_messages))throw Error('Conversation body unavailable');
        const chat=pick(json,['uuid','name','summary','model','created_at','updated_at','current_leaf_message_uuid']);
        chat.chat_messages=media(json.chat_messages.map(m=>pick(m,['uuid','sender','text','content','created_at','updated_at','truncated','parent_message_uuid','attachments','files','sync_sources'])),provenance);
        const jsonPath=save(kind,cleanName(chat.name)+'.json',Buffer.from(JSON.stringify(chat,null,2)),provenance);
        save(kind,cleanName(chat.name)+'.md',Buffer.from(markdownChat(chat)),provenance);
        if(!conversations.get(chat.uuid)?.file || String(chat.updated_at||'') >= String(conversations.get(chat.uuid)?.updated_at||''))conversations.set(chat.uuid,{...pick(chat,['uuid','name','summary','created_at','updated_at']),messages:chat.chat_messages.length,file:jsonPath});
      } else if(kind==='indexes') {
        const rows=Array.isArray(json)?json:json?.data;if(!Array.isArray(rows))throw Error('Conversation index unavailable');
        for(const row of rows) if(!conversations.has(row.uuid))conversations.set(row.uuid,{...pick(row,['uuid','name','summary','created_at','updated_at']),messages:null});
      } else if(kind==='artifacts') {
        if(!json?.artifact_versions?.length){counts.emptyArtifacts++;continue;}
        save(kind,'versions.json',Buffer.from(JSON.stringify(json.artifact_versions,null,2)),provenance);
      } else if(kind==='projects') {
        if(!json)throw Error('Project metadata unavailable');
        const project=Array.isArray(json)?json.map(row=>pick(row,['uuid','name','file_name','content','extracted_content'])):pick(json,['uuid','name','description','prompt_template','docs','files']);
        if(Object.keys(project).length)save(kind,'project.json',Buffer.from(JSON.stringify(project,null,2)),provenance);
      } else save(kind,filename(entry,url),entry.body,provenance);
    } catch(error){counts.failedEntries++;warnings.add(error.message);}
    finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
  }
  // Preserve Cowork inputs, outputs, and transcript files, excluding app/plugin/runtime data.
  const saveTranscript=(file,session)=>{
    const messages=[];
    const provenance={kind:'local-transcripts',session:path.basename(session),relative:path.relative(session,file)};
    for(const line of fs.readFileSync(file,'utf8').split('\n')) {
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(!row.message && row.tool_use_result===undefined && row.toolUseResult===undefined)continue;
      messages.push(media(pick(row,['uuid','type','timestamp','message','parentUuid','parent_tool_use_id','tool_use_result','toolUseResult']),provenance));
    }
    if(!messages.length)return;
    const name=path.basename(file,'.jsonl');
    save('local-transcripts',name+'.json',Buffer.from(JSON.stringify(messages,null,2)),provenance);
    const chat={name:'Claude local session',chat_messages:messages.map(row=>({sender:row.message?.role||row.type,created_at:row.timestamp,text:typeof row.message?.content==='string'?row.message.content:undefined,content:Array.isArray(row.message?.content)?row.message.content:[],files:row.tool_use_result!==undefined||row.toolUseResult!==undefined?[{tool_result:row.tool_use_result??row.toolUseResult}]:[]}))};
    save('local-transcripts',name+'.md',Buffer.from(markdownChat(chat)),provenance);
  };
  const sessions=path.join(source,'local-agent-mode-sessions');let visited=0;
  const dirs=p=>safe(p)?fs.readdirSync(p,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>path.join(p,e.name)):[];
  const walk=(folder,session,category,depth=0)=>{
    if(!safe(folder)||depth>12)return;
    for(const e of fs.readdirSync(folder,{withFileTypes:true})) {
      if(++visited>30000){warnings.add('Local session file limit reached');return;}
      const p=path.join(folder,e.name);if(!safe(p))continue;
      if(e.isDirectory())walk(p,session,category,depth+1);
      else if(e.isFile() && (category!=='local-transcripts'||/\.jsonl$/.test(e.name))){
        try {if(fs.statSync(p).size>maxBytes){warnings.add('Local file exceeds 128 MiB');continue;}
          if(category==='local-transcripts')saveTranscript(p,session);
          else save(category,e.name,fs.readFileSync(p),{kind:category,session:path.basename(session),relative:path.relative(session,p)});
        }catch{warnings.add('A local session file changed or could not be read');}
      }
    }
  };
  for(const account of dirs(sessions))for(const scope of dirs(account))for(const session of dirs(scope).filter(p=>path.basename(p).startsWith('local_'))) {
    for(const kind of ['outputs','uploads'])walk(path.join(session,kind),session,'cowork-'+kind);
    walk(path.join(session,'.claude','projects'),session,'local-transcripts');
    for(const item of fs.readdirSync(session,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.jsonl'))) {
      const p=path.join(session,item.name);if(safe(p)&&fs.statSync(p).size<=maxBytes)saveTranscript(p,session);
    }
  }
  const index=[...conversations.values()];
  fs.writeFileSync(path.join(output,'conversation-index.json'),JSON.stringify(index,null,2),{mode:0o600});
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),counts,warnings:[...warnings],records},null,2),{mode:0o600});
  const grouped=Object.fromEntries([...new Set(records.map(r=>r.file.split(path.sep)[0]))].map(k=>[k,records.filter(r=>r.file.startsWith(k+path.sep)).length]));
  fs.writeFileSync(path.join(output,'README.txt'),`Claude 本地聊天缓存恢复\n\n仅保存在本机，不上传；不修改 Claude 原始文件。\n\n${JSON.stringify(grouped,null,2)}\n\n会话索引：${index.length} 条；有正文的会话：${index.filter(x=>x.messages!==null).length} 条。\nconversations：聊天正文 Markdown 和结构化 JSON（附件信息、工具记录、分支关系）。\ndownloads / attachments / artifact-files：恢复的下载文件、附件预览、Artifact 项目文件。\ncowork-outputs / cowork-uploads / local-transcripts：Cowork 产物、输入附件和本地会话记录。\nmanifest.json：文件哈希和来源；同内容文件合并，所有来源保留。\n\n这是本机缓存快照，不代表完整云端记录。只有标题的会话未恢复到正文；附件预览不代表原始附件；缺失的内容无法凭空恢复。\n未执行 HTML、脚本或程序。未读取 Cookie 或令牌存储，未导出账号设置、HTTP 请求头或缓存请求 URL。聊天本身可能包含用户的私人内容。\n\n警告：${[...warnings].join('\n')}\n`,{mode:0o600});
  const readable=['# Claude 聊天恢复索引','本机缓存快照；只有标题的会话未恢复到正文。','## 会话'];
  for(const row of index)readable.push(`- ${String(row.name||'未命名').replaceAll('\n',' ')} — ${row.messages===null?'仅索引，无正文':row.messages+' 条消息'}${row.file?' · '+row.file:''}`);
  readable.push('## 文件');for(const record of records)readable.push(`- ${record.file} (${record.bytes} bytes)`);
  fs.writeFileSync(path.join(output,'INDEX.md'),readable.join('\n\n')+'\n',{mode:0o600});
  return {output,counts,files:grouped,conversations:index.length,conversationsWithMessages:index.filter(x=>x.messages!==null).length,warnings:[...warnings]};
}
