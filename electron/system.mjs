import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const exec = promisify(execFile);
export async function run(file, args, options = {}) {
  return (await exec(file, args, { timeout: 4000, maxBuffer: 1024 * 1024, ...options })).stdout.trim();
}
export async function branchInfo(cwd) {
  try {
    const root = await run('/usr/bin/git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
    const [branch, commit] = await Promise.all([
      run('/usr/bin/git', ['-C', cwd, 'branch', '--show-current']),
      run('/usr/bin/git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'])
    ]);
    return { root, branch: branch || 'detached HEAD', commit };
  } catch { return { root: cwd, branch: '非 Git 目录', commit: '' }; }
}
export async function listeners(port) {
  try {
    const result = await run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn']);
    let current; const found = [];
    for (const line of result.split('\n')) {
      if (line[0] === 'p') { current = { pid: Number(line.slice(1)), command: '' }; found.push(current); }
      if (line[0] === 'c' && current) current.command = line.slice(1);
    }
    return found;
  } catch (error) { if (error.code === 1 && !error.stdout) return []; throw new Error(`无法检查端口 ${port}：${error.message}`); }
}
export async function groupOf(pid) {
  try { return Number(await run('/bin/ps', ['-p', String(pid), '-o', 'pgid='])); } catch { return null; }
}
export async function loginEnvironment(overrides = {}) {
  const fallback = { ...process.env, ...overrides, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}` };
  try {
    const output = await run('/bin/zsh', ['-lc', '/usr/bin/env -0'], { timeout: 7000, env: fallback });
    const env = {};
    for (const pair of output.split('\0')) {
      const at = pair.indexOf('='); const key = pair.slice(0, at);
      if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = pair.slice(at + 1);
    }
    delete env.ELECTRON_RUN_AS_NODE;
    return { ...fallback, ...env };
  } catch { return fallback; }
}
export async function externalRuntime(cwd, base) {
  if (!base || !path.isAbsolute(base) || !fs.existsSync(base)) return null;
  const git = await branchInfo(cwd);
  const root = fs.realpathSync(git.root);
  for (const entry of fs.readdirSync(base)) {
    try {
      const desc = JSON.parse(fs.readFileSync(path.join(base, entry, 'runtime.json'), 'utf8'));
      if (desc.repoRoot && fs.realpathSync(desc.repoRoot) === root && Number.isInteger(desc.ownerPid) && desc.ownerPid > 1) {
        process.kill(desc.ownerPid, 0);
        return { pid: desc.ownerPid };
      }
    } catch { /* Inactive or stale descriptor. Never signal these processes. */ }
  }
  return null;
}
