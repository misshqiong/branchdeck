import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { run, branchInfo } from './system.mjs';
const ignored = new Set(['node_modules', '.git', '.claude', '.codex', 'dist', 'build', 'target', 'coverage', 'release', '.next', '.venv', 'venv', 'vendor', 'Pods', '.gradle', '.cache']);
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const entries = directory => { try { return fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; } };
function json(file, fallback = {}) { try { if (fs.statSync(file).size > 8 * 1024 * 1024) return fallback; return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function canonical(directory) { try { return typeof directory === 'string' && path.isAbsolute(directory) && fs.statSync(directory).isDirectory() ? fs.realpathSync(directory) : null; } catch { return null; } }
function projectMarker(directory) { return ['.git', 'package.json', 'pom.xml', 'Makefile', 'pyproject.toml', 'Cargo.toml', 'go.mod'].some(f => fs.existsSync(path.join(directory, f))); }
async function limited(items, fn, concurrency = 5) { let i = 0; const result = new Array(items.length); await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (i < items.length) { const index = i++; result[index] = await fn(items[index]); } })); return result; }
export function parseWorktrees(output) {
  const result = []; let current;
  for (const token of output.split('\0')) {
    if (token.startsWith('worktree ')) { current = { path: token.slice(9), branch: '' }; result.push(current); }
    else if (token.startsWith('branch ') && current) current.branch = token.slice(7).replace(/^refs\/heads\//, '');
    else if (token === 'detached' && current) current.branch = 'detached HEAD';
  }
  return result;
}
export class Discovery {
  constructor({ home = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex'), claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), roots = [], metadata = true } = {}) {
    this.home = home; this.codexHome = codexHome; this.claudeHome = claudeHome; this.roots = roots; this.metadata = metadata; this.historyRoots=[];
    this.result = { workspaces: [], scannedAt: null, warnings: [], scanning: false }; this.pending = null;
  }
  async scan(configs = []) {
    if (this.pending) return this.pending;
    this.result.scanning = true;
    this.pending = this.collect(configs).then(result => (this.result = { ...result, scannedAt: Date.now(), scanning: false })).finally(() => { this.pending = null; this.result.scanning = false; });
    return this.pending;
  }
  async collect(configs) {
    const candidates = new Map(), warnings = []; let rootLabels = {};
    const add = (directory, source, updated = 0, explicit = false) => {
      const cwd = canonical(directory); if (!cwd || cwd === this.home || cwd === '/') return;
      if (!explicit && !projectMarker(cwd)) return;
      const existing = candidates.get(cwd) || { path: cwd, sources: new Set(), updatedAt: 0 };
      existing.sources.add(source); existing.updatedAt = Math.max(existing.updatedAt, updated); candidates.set(cwd, existing);
    };
    if (this.metadata) {
      const global = json(path.join(this.codexHome, '.codex-global-state.json'));
      rootLabels = global['electron-workspace-root-labels'] || {};
      for (const p of global['electron-saved-workspace-roots'] || []) add(p, 'Codex', 0, true);
      for (const p of Object.values(global['thread-workspace-root-hints'] || {})) add(p, 'Codex');
      for (const project of Object.values(global['local-projects'] || {})) for (const p of project.rootPaths || []) add(p, 'Codex', project.updatedAt, true);
      const databases = entries(this.codexHome).filter(e => /^state_\d+\.sqlite$/.test(e.name)).sort((a,b) => Number(b.name.match(/\d+/)[0]) - Number(a.name.match(/\d+/)[0]));
      if (databases[0]) {
        const database = path.join(this.codexHome, databases[0].name);
        for (const [query, explicit] of [["SELECT cwd AS path, MAX(updated_at)*1000 AS updatedAt FROM threads WHERE archived=0 GROUP BY cwd ORDER BY updatedAt DESC LIMIT 300", false], ['SELECT path FROM project_roots', true]]) {
          try { const rows = JSON.parse(await run('/usr/bin/sqlite3', ['-readonly', '-json', database, query], { timeout: 5000 }) || '[]'); for (const row of rows) add(row.path, 'Codex', row.updatedAt || 0, explicit); }
          catch { warnings.push('Codex 数据库部分索引不可读，已使用项目目录和 worktree 补充发现。'); }
        }
      }
      const claudeFiles = [path.join(this.home, '.claude.json'), path.join(this.claudeHome, '.claude.json')];
      for (const file of claudeFiles) for (const [p, project] of Object.entries(json(file).projects || {})) add(p, 'Claude Code', Number(project?.lastSessionDate) || 0, true);
      for (const project of entries(path.join(this.claudeHome, 'projects'))) {
        if (!project.isDirectory()) continue;
        const index = json(path.join(this.claudeHome, 'projects', project.name, 'sessions-index.json'));
        if (index.originalPath) add(index.originalPath, 'Claude Code');
        for (const entry of index.entries || []) if (entry.projectPath) add(entry.projectPath, 'Claude Code', Date.parse(entry.modified) || 0);
      }
      for (const outer of entries(path.join(this.codexHome, 'worktrees'))) if (outer.isDirectory()) {
        const directory = path.join(this.codexHome, 'worktrees', outer.name); add(directory, 'Codex');
        for (const inner of entries(directory)) if (inner.isDirectory()) add(path.join(directory, inner.name), 'Codex');
      }
    }
    if(this.metadata){
      // Tool-independent discovery: bounded common containers, not a home-directory crawl.
      const containers=entries(this.home).filter(e=>e.isDirectory()&&['code','projects','developer'].includes(e.name.toLowerCase())).map(e=>path.join(this.home,e.name));
      for(const doc of entries(this.home).filter(e=>e.isDirectory()&&e.name.toLowerCase()==='documents'))for(const child of entries(path.join(this.home,doc.name)))if(child.isDirectory()&&['code','projects'].includes(child.name.toLowerCase()))containers.push(path.join(this.home,doc.name,child.name));
      const queue=containers.map(directory=>({directory,depth:0}));
      let visited=0;
      while(queue.length&&visited++<300){
        const {directory,depth}=queue.shift();
        if(projectMarker(directory)){add(directory,'本地目录');continue;}
        if(depth<2)for(const child of entries(directory))if(child.isDirectory()&&!child.name.startsWith('.')&&!ignored.has(child.name))queue.push({directory:path.join(directory,child.name),depth:depth+1});
      }
      for(const root of this.historyRoots){
        let directory=canonical(root);
        for(let depth=0;directory&&directory!==this.home&&directory!=='/'&&depth<8;depth++,directory=path.dirname(directory)){
          if(projectMarker(directory)){add(directory,'终端历史');break;}
        }
      }
    }
    for (const p of this.roots) {
      add(p, '本地', 0, true);
      for (const child of entries(p)) if (child.isDirectory() && !child.name.startsWith('.') && !ignored.has(child.name)) add(path.join(p, child.name), '本地');
    }
    for (const config of configs) add(config.cwd, '已保存', 0, true);
    // Claude worktrees may be missing from its project registry until a first session is written.
    for (const c of [...candidates.values()]) for (const child of entries(path.join(c.path, '.claude/worktrees'))) if (child.isDirectory()) add(path.join(c.path, '.claude/worktrees', child.name), 'Claude Code');
    if (candidates.size > 350) warnings.push('目录数量超过单次 350 个上限；可添加具体目录缩小范围。');
    const workspaces = new Map();
    const inspect = async c => {
      const git = await branchInfo(c.path); const root = canonical(git.root) || c.path;
      let common = root;
      if (git.commit) { try { common = canonical(path.resolve(c.path, await run('/usr/bin/git', ['-C', c.path, 'rev-parse', '--git-common-dir']))) || root; } catch {} }
      const old = workspaces.get(root);
      if (old) { old.sources = [...new Set([...old.sources, ...c.sources])]; old.updatedAt = Math.max(old.updatedAt, c.updatedAt); return; }
      workspaces.set(root, { id: idFor(root), path: root, name: path.basename(root), displayName: typeof rootLabels[root] === 'string' ? rootLabels[root] : path.basename(root), branch: git.branch, commit: git.commit, groupId: idFor(common), repository: path.basename(common === root ? root : path.dirname(common)), sources: [...c.sources], updatedAt: c.updatedAt, isWorktree: git.commit ? common !== path.join(root, '.git') : false });
    };
    await limited([...candidates.values()].slice(0,350), inspect);
    const groups = new Map(); for (const w of workspaces.values()) if (w.commit && !groups.has(w.groupId)) groups.set(w.groupId, w);
    for (const parent of groups.values()) {
      try {
        const children = parseWorktrees(await run('/usr/bin/git', ['-C', parent.path, 'worktree', 'list', '--porcelain', '-z']));
        await limited(children, async child => {
          const root = canonical(child.path); if (!root) return;
          const source = root.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`) ? 'Claude Code' : root.startsWith(path.join(this.codexHome, 'worktrees') + path.sep) ? 'Codex' : 'Git worktree';
          if (!workspaces.has(root)) await inspect({ path: root, sources: new Set([source]), updatedAt: 0 });
          else if (source !== 'Git worktree') { const w = workspaces.get(root); w.sources = [...new Set([...w.sources, source])]; }
        });
      } catch { warnings.push(`无法完整读取 ${parent.name} 的 worktree 列表。`); }
    }
    const sorted = [...workspaces.values()].sort((a,b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
    return { workspaces: sorted, warnings: [...new Set(warnings)] };
  }
  get(id) { const workspace = this.result.workspaces.find(w => w.id === id); if (!workspace) throw new Error('工作区已变化，请重新扫描'); return workspace; }
  folders(id, relative = '') {
    const workspace = this.get(id), absolute = path.resolve(workspace.path, relative);
    const root = canonical(absolute);
    if (!root || (root !== workspace.path && !root.startsWith(workspace.path + path.sep))) throw new Error('目录不在此工作区内');
    return entries(root).filter(e => !e.name.startsWith('.') && !ignored.has(e.name) && !e.isSymbolicLink()).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0,150).map(e => ({ name:e.name, relative:path.relative(workspace.path,path.join(root,e.name)), directory:e.isDirectory(), manifest:['package.json','pom.xml','Makefile','pyproject.toml'].includes(e.name) }));
  }
}
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function detectLaunchers(root) {
  const found = [], queue = [{ directory: root, depth: 0 }]; let inspected = 0;
  function manager(directory) {
    let current = directory;
    while (current === root || current.startsWith(root + path.sep)) {
      const p = json(path.join(current,'package.json')); const declared = typeof p.packageManager === 'string' ? p.packageManager.split('@')[0] : '';
      if (['pnpm','yarn','npm','bun'].includes(declared)) return declared;
      for (const [file, tool] of [['pnpm-lock.yaml','pnpm'],['yarn.lock','yarn'],['bun.lockb','bun'],['bun.lock','bun'],['package-lock.json','npm']]) if (fs.existsSync(path.join(current,file))) return tool;
      current=path.dirname(current);
    }
    return 'npm';
  }
  const add = (directory, label, command, kind, evidence, priority) => {
    const relative = path.relative(root,directory) || '.';
    found.push({ id:`auto-${idFor(directory+'\0'+command)}`, name:label, cwd:directory, command, kind, environment: /(?:^|:)test$/.test(label) && kind==='service' ? 'Test' : /(?:^|:)st$/.test(label) ? 'ST' : /online|prod/.test(label) ? 'Online' : 'Local', port:null, env:{}, timeout:90, stopCommand:'', stopSignal:'SIGTERM', stopTimeout:5, relative, evidence, priority, detected:true });
  };
  while(queue.length && inspected++ < 200) {
    const {directory,depth}=queue.shift();
    if (directory !== root && fs.existsSync(path.join(directory,'.git'))) continue;
    const p = json(path.join(directory,'package.json'));
    for (const [script, body] of Object.entries(p.scripts || {})) {
      if (typeof body !== 'string' || !/^(dev(?::[\w-]+)?|start(?::[\w-]+)?|serve|test(?::(?:unit|watch))?|build)$/.test(script)) continue;
      const kind = /^(test|build)(:|$)/.test(script) ? 'task' : 'service';
      let priority = script==='dev:test' ? -5 : script==='dev' ? 1 : script==='start' ? 3 : kind==='task' ? 30 : 10;
      if (depth>0) priority+=2;
      if (/online|prod/.test(script)) priority+=20;
      add(directory,script,`${manager(directory)} run ${shellQuote(script)}`,kind,`${path.relative(root,path.join(directory,'package.json'))} → ${script}`,priority);
    }
    const make = path.join(directory,'Makefile');
    if(fs.existsSync(make)) for(const match of fs.readFileSync(make,'utf8').matchAll(/^(dev|start|run|serve|test|build):[^=]/gm)) add(directory,match[1],`make ${match[1]}`,/test|build/.test(match[1])?'task':'service',`${path.relative(root,make)} → ${match[1]}`,15+depth);
    const pom = path.join(directory,'pom.xml');
    if(fs.existsSync(pom) && fs.statSync(pom).size<1000000 && /<artifactId>spring-boot-maven-plugin<\/artifactId>/.test(fs.readFileSync(pom,'utf8'))) add(directory,'Spring Boot',`${fs.existsSync(path.join(directory,'mvnw'))?'./mvnw':'mvn'} spring-boot:run`,'service',path.relative(root,pom),12+depth);
    if(depth<3) for(const entry of entries(directory)) if(entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name)) queue.push({directory:path.join(directory,entry.name),depth:depth+1});
  }
  return found.sort((a,b)=>a.priority-b.priority || a.relative.localeCompare(b.relative) || a.name.localeCompare(b.name)).slice(0,100);
}
export async function launchersFor(workspace, configs) {
  const saved = [];
  for (const config of configs) if(config.cwd===workspace.path || config.cwd.startsWith(workspace.path+path.sep)) {
    const git=await branchInfo(config.cwd);
    if(git.commit && git.root!==workspace.path) continue;
    saved.push({...config,relative:path.relative(workspace.path,config.cwd)||'.',evidence:'已保存的启动方式',detected:false});
  }
  const normalize = command => command.replace(/['"]/g,'').trim();
  const detected=detectLaunchers(workspace.path).filter(d=>!saved.some(s=>s.cwd===d.cwd && normalize(s.command)===normalize(d.command)));
  return [...saved,...detected];
}
export function gitLaunchers(workspace) {
  if (!workspace.commit) return [];
  return [
    ['Git 状态', 'git --no-pager status --short --branch', '查看工作区与暂存区的改动'],
    ['查看差异', 'git --no-pager diff --stat && git --no-pager diff --color=never', '查看未暂存的代码改动'],
    ['提交日志', 'git --no-pager log -15 --oneline --decorate', '最近 15 次提交'],
    ['分支列表', 'git --no-pager branch -avv', '本地和远端分支'],
    ['获取远端更新', 'git fetch --all', '更新远端引用，不修改工作文件'],
    ['快进拉取', 'git pull --ff-only', '更新当前分支及工作文件；有分歧时拒绝合并', true]
  ].map(([name,command,description,requiresConfirm]) => ({ id:`git-${idFor(workspace.path+'\0'+command)}`, name, cwd:workspace.path, command, description, kind:'task', environment:'Local', env:{GIT_TERMINAL_PROMPT:'0'}, port:null, timeout:90, stopCommand:'', stopSignal:'SIGTERM', stopTimeout:5, relative:'.', evidence:'Git 常用命令', detected:true, category:'git', requiresConfirm:Boolean(requiresConfirm) }));
}
