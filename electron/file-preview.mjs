import fs from 'node:fs';
import path from 'node:path';
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.bmp':'image/bmp','.avif':'image/avif','.ico':'image/x-icon'};
export function filePreview(target, offset=0) {
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid preview offset');
  const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('请选择文件');
    const ext=path.extname(target).toLowerCase();const mime=imageTypes[ext];
    const kind=mime?'image':ext==='.pdf'?'pdf':ext==='.xlsx'?'spreadsheet':ext==='.md'||ext==='.markdown'?'markdown':ext==='.html'||ext==='.htm'?'html':ext==='.csv'||ext==='.tsv'?'csv':ext==='.json'?'json':'text';
    const base={path:target,kind,size:stat.size,offset,content:'',nextOffset:null,mime:mime||''};
    if(['image','pdf','spreadsheet'].includes(kind)){
      if(stat.size>32*1024*1024)return {...base,kind:'unsupported',reason:'文件超过 32 MB，请在 Finder 中用对应应用打开'};
      return {...base,base64:fs.readFileSync(fd).toString('base64')};
    }
    if(offset>stat.size)throw Error('文件已变化，请重新打开');
    const limit=kind==='html'?2*1024*1024:256*1024;
    const b=Buffer.alloc(Math.min(limit,stat.size-offset));let bytes=fs.readSync(fd,b,0,b.length,offset);
    if(b.subarray(0,bytes).includes(0))return {...base,kind:'unsupported',reason:'此二进制格式尚不支持内置预览，请在 Finder 中打开'};
    // Keep multibyte UTF-8 characters whole across page boundaries.
    if(offset+bytes<stat.size&&bytes){let last=bytes-1;while(last>0&&(b[last]&0xc0)===0x80)last--;const lead=b[last];const length=lead>=0xf0?4:lead>=0xe0?3:lead>=0xc0?2:1;if(bytes-last<length)bytes=last;}
    return {...base,content:b.subarray(0,bytes).toString('utf8'),nextOffset:offset+bytes<stat.size?offset+bytes:null};
  } finally{fs.closeSync(fd);}
}
