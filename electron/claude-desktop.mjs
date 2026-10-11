import fs from 'node:fs';
import path from 'node:path';

// Inspect only the known Cowork output layout; never read session bodies or app databases.
export function desktopOutputs(home, canAccess = () => true) {
  const base = path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
  let remaining = 5000;
  const safe = directory => {
    try { return canAccess(directory) && fs.lstatSync(directory).isDirectory() && fs.realpathSync(directory) === directory; }
    catch { return false; }
  };
  const entries = directory => {
    if (remaining <= 0 || !safe(directory)) return [];
    try {
      const result = [];
      const dir = fs.opendirSync(directory);
      try { let item; while (remaining > 0 && (item = dir.readSync())) { remaining--; result.push(item); } }
      finally { dir.closeSync(); }
      return result;
    } catch { return []; }
  };
  const result = [];
  for (const account of entries(base).filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
    const accountPath = path.join(base, account.name);
    for (const scope of entries(accountPath).filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
      const scopePath = path.join(accountPath, scope.name);
      for (const session of entries(scopePath).filter(e => e.isDirectory() && e.name.startsWith('local_'))) {
        const output = path.join(scopePath, session.name, 'outputs');
        if (!safe(path.dirname(output))) continue;
        const files = entries(output).filter(e => !e.name.startsWith('.') && !e.isSymbolicLink());
        if (!files.length) continue;
        try { result.push({path: output, updatedAt: fs.statSync(output).mtimeMs}); }
        catch { /* Claude may remove a session while discovery is running. */ }
      }
    }
  }
  return result;
}
