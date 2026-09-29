import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function validateConfig(input) {
  const c = { id: input.id || randomUUID(), name: String(input.name || '').trim(), cwd: String(input.cwd || '').trim(), command: String(input.command || '').trim(), environment: String(input.environment || 'Local').trim(), kind: input.kind === 'task' ? 'task' : 'service', port: input.port === '' || input.port == null ? null : Number(input.port), env: input.env || {}, timeout: Number(input.timeout || 90), stopCommand: String(input.stopCommand || '').trim(), stopSignal: input.stopSignal === 'SIGINT' ? 'SIGINT' : 'SIGTERM', stopTimeout: Number(input.stopTimeout || 5), requiresConfirm: Boolean(input.requiresConfirm), category: input.category === 'git' ? 'git' : 'custom' };
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id)) throw new Error('配置 ID 无效');
  if (!c.name || c.name.length > 100 || !c.command || c.command.length > 8000) throw new Error('请填写名称和启动命令（名称最多 100 字）');
  if (!path.isAbsolute(c.cwd) || !fs.existsSync(c.cwd) || !fs.statSync(c.cwd).isDirectory()) throw new Error('工作目录不存在，请选择一个本地目录');
  c.cwd = fs.realpathSync(c.cwd);
  if (c.port !== null && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)) throw new Error('端口必须在 1–65535 之间');
  if (c.stopCommand.length > 8000 || !Number.isFinite(c.stopTimeout) || c.stopTimeout < 1 || c.stopTimeout > 60) throw new Error('停止命令过长或停止等待时间不在 1–60 秒内');
  if (!Number.isFinite(c.timeout) || c.timeout < 5 || c.timeout > 3600) throw new Error('就绪超时必须在 5–3600 秒之间');
  if (typeof c.env !== 'object' || Array.isArray(c.env)) throw new Error('环境变量格式无效');
  for (const [key, value] of Object.entries(c.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) throw new Error('环境变量名称或值无效');
  }
  return c;
}
export class Store {
  constructor(directory) {
    this.directory = directory; this.file = path.join(directory, 'configs.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      this.configs = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.configs)) throw new Error('配置文件格式错误，请检查 configs.json');
    } else {
      this.configs = [];
      this.persist();
    }
  }
  persist() { atomicJson(this.file, this.configs); }
  save(input) { const c = validateConfig(input); const next = this.configs.filter(x => x.id !== c.id); next.push(c); atomicJson(this.file, next); this.configs = next; return c; }
  importConfigs(inputs) {
    const configs=inputs.map(validateConfig);
    if(!configs.length)return;
    const ids=new Set(this.configs.map(c=>c.id));
    for(const c of configs){if(ids.has(c.id))throw new Error('导入配置 ID 重复');ids.add(c.id);}
    const next=[...this.configs,...configs];atomicJson(this.file,next);this.configs=next;
  }
  delete(id) { const next = this.configs.filter(x => x.id !== id); atomicJson(this.file, next); this.configs = next; }
}
