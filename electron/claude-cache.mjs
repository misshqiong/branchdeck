import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {temporaryReferences, temporaryDirectories} from './claude-temporary.mjs';

const within = (root, target) => target === root || target.startsWith(root + path.sep);
const idFor = file => createHash('sha256').update(file).digest('hex').slice(0, 24);
const entries = dir => { try { return fs.readdirSync(dir, {withFileTypes:true}); } catch { return []; } };
const realDirectory = value => { try { return typeof value === 'string' && path.isAbsolute(value) && fs.statSync(value).isDirectory() ? fs.realpathSync(value) : null; } catch { return null; } };

// This catalog contains paths and timestamps only. Contents are read on explicit preview.
export class ClaudeCache {
  constructor({home, canAccess = () => true}) {
    this.home = home; this.canAccess = canAccess; this.files = new Map(); this.warnings = [];
  }
  safe(file) {
    if (!this.canAccess(file)) return false;
    try {
      // Do not follow cache symlinks, including symlinked parents.
      const relative = path.relative(this.home, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
      let current = this.home;
      for (const part of ['', ...relative.split(path.sep)]) {
        current = part ? path.join(current, part) : current;
        if (fs.lstatSync(current).isSymbolicLink()) return false;
      }
      return this.canAccess(fs.realpathSync(file));
    } catch { return false; }
  }
  prefix(file, size, offset = 0) {
    if (!this.safe(file)) return Buffer.alloc(0);
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fd).isFile()) return Buffer.alloc(0);
      const buffer = Buffer.alloc(size);
      return buffer.subarray(0, fs.readSync(fd, buffer, 0, size, offset));
    } catch { return Buffer.alloc(0); } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  async scan() {
    const files = new Map(), projects = [], warnings = new Set();
    let remaining = 32 * 1024 * 1024, visited = 0;
    const root = path.join(this.home, 'projects');
    if (!this.safe(root)) { this.files = files; this.warnings = []; return []; }
    const read = (file, limit, offset = 0) => {
      if (remaining <= 0) { warnings.add('Claude 缓存扫描达到读取上限，部分会话可能未显示。'); return ''; }
      const data = this.prefix(file, Math.min(limit, remaining), offset); remaining -= data.length;
      return data.toString('utf8');
    };
    const parse = value => { try { return JSON.parse(value); } catch { return null; } };
    for (const project of entries(root).filter(e => e.isDirectory()).sort((a,b)=>{try{return fs.statSync(path.join(root,b.name)).mtimeMs-fs.statSync(path.join(root,a.name)).mtimeMs;}catch{return 0;}}).slice(0, 500)) {
      const directory = path.join(root, project.name);
      if (!this.safe(directory)) continue;
      const index = parse(read(path.join(directory, 'sessions-index.json'), 1024 * 1024));
      const indexed = new Map(); const projectPaths = new Set();
      const remember = value => { const cwd = realDirectory(value); if (cwd && this.canAccess(cwd)) projectPaths.add(cwd); return cwd; };
      remember(index?.originalPath);
      for (const entry of Array.isArray(index?.entries) ? index.entries : []) {
        const cwd = remember(entry?.projectPath);
        if (typeof entry?.sessionId === 'string' && cwd) indexed.set(entry.sessionId, cwd);
      }
      const queue = [{directory, depth:0}], pending = [];
      while (queue.length && visited < 5000) {
        const current = queue.shift();
        if (!this.safe(current.directory)) continue;
        for (const entry of entries(current.directory)) {
          if (++visited > 5000) break;
          const file = path.join(current.directory, entry.name);
          if (entry.isDirectory() && current.depth < 4) { queue.push({directory:file,depth:current.depth+1}); continue; }
          if (!entry.isFile() || !/\.(jsonl|json|md|txt|log)$/i.test(entry.name) || !this.safe(file)) continue;
          let stat; try { stat = fs.statSync(file); } catch { continue; }
          const relative = path.relative(directory, file);
          const transcript = current.depth === 0 && entry.name.endsWith('.jsonl');
          let cwd = indexed.get(path.basename(entry.name, '.jsonl'));
          let temporary = [];
          if (entry.name.endsWith('.jsonl')) {
            // Scan bounded head + tail, including tool records after the first cwd.
            const cap = 4 * 1024 * 1024;
            const head = read(file, cap);
            const texts = [head];
            if (stat.size > Buffer.byteLength(head) && remaining > 0) {
              const offset = Math.max(Buffer.byteLength(head), stat.size - cap);
              const tail = read(file, cap, offset);
              texts.push(tail.slice(tail.indexOf('\n') + 1));
              if (offset > Buffer.byteLength(head)) warnings.add('部分 Claude 大会话仅扫描开头和结尾，中间的临时目录可能未发现。');
            }
            const references = [];
            for (const text of texts) for (const line of text.split('\n')) {
              const record = parse(line);
              if (!cwd) cwd = remember(record?.cwd);
              references.push(...temporaryReferences(record));
            }
            const result = temporaryDirectories(references, this.canAccess);
            temporary = result.directories;
            if (result.missing) warnings.add('部分会话引用的临时路径已不存在，未加入目录列表。');
            if (!cwd && stat.size > Buffer.byteLength(head)) warnings.add('部分 Claude 会话的目录信息超出扫描范围，未自动关联。');
            if (cwd) projects.push({path:cwd, updatedAt:stat.mtimeMs});
            for (const directory of temporary) projects.push({path:directory,updatedAt:stat.mtimeMs,temporary:true});
          }
          pending.push({id:idFor(file), file, name:relative, kind:transcript?'session':relative.startsWith('memory'+path.sep)?'memory':'file', size:stat.size, updatedAt:stat.mtimeMs, paths:cwd||temporary.length?[...(cwd?[cwd]:[]),...temporary]:null});
        }
      }
      for (const item of pending) {
        // Session sidecars belong to that session's directory, not every worktree in an index.
        const parentSession = pending.find(p => p.kind === 'session' && item.name.startsWith(path.basename(p.name,'.jsonl') + path.sep));
        item.paths ||= parentSession ? (parentSession.paths || []) : item.kind === 'session' && projectPaths.size !== 1 ? [] : [...projectPaths];
        if (item.paths.length) files.set(item.id, item);
      }
      for (const cwd of projectPaths) projects.push({path:cwd,updatedAt:0});
      await new Promise(resolve => setImmediate(resolve));
      if (visited >= 5000) break;
    }
    if (visited >= 5000 || entries(root).filter(e=>e.isDirectory()).length > 500) warnings.add('Claude 缓存扫描达到文件数量上限，部分文件可能未显示。');
    this.files = files; this.warnings = [...warnings]; return projects;
  }
  belongs(item, workspace, workspaces) {
    return item.paths.some(cwd => {
      const owner = workspaces.filter(w => within(w.path, cwd)).sort((a,b)=>b.path.length-a.path.length)[0];
      return owner?.id === workspace.id;
    });
  }
  list(workspace, workspaces) {
    if (!this.canAccess(workspace.path)) return {files:[], warnings:['项目目录不可访问，请重新授权。']};
    return {files:[...this.files.values()].filter(item => this.belongs(item, workspace, workspaces) && this.safe(item.file)).map(({id,name,kind,size,updatedAt})=>({id,name,kind,size,updatedAt})).sort((a,b)=>b.updatedAt-a.updatedAt || a.name.localeCompare(b.name)), warnings:this.warnings};
  }
  preview(workspace, workspaces, id, offset = 0) {
    const item = this.files.get(id);
    if (!item || !this.belongs(item, workspace, workspaces) || !this.canAccess(workspace.path) || !this.safe(item.file)) throw new Error('Claude 缓存文件不可访问，请刷新或重新授权。');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的文件读取位置');
    const fd = fs.openSync(item.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || offset > stat.size) throw new Error('缓存文件已变化，请重新打开。');
      const buffer = Buffer.alloc(128 * 1024 + 4);
      const length = fs.readSync(fd, buffer, 0, buffer.length, offset);
      let end = Math.min(length, 128 * 1024);
      // End at a UTF-8 boundary so concatenated pages do not corrupt multibyte text.
      if (end < length) while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
      const content = buffer.subarray(0,end);
      if (content.includes(0)) throw new Error('暂不支持二进制文件预览');
      return {name:item.name, content:content.toString('utf8'), offset, nextOffset:offset+end < stat.size?offset+end:null, size:stat.size};
    } finally { fs.closeSync(fd); }
  }
}
