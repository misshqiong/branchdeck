const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');

// Runs before code signing. Removing debug symbols from signed output would
// invalidate its signature and notarization, so never patch release downloads.
exports.default = async context => {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;
  const root = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const native = path.join(root, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty');
  const privatePath = Buffer.from(os.homedir() + '/');
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(file); continue; }
      if (entry.name === 'pty.node' || entry.name === 'spawn-helper') {
        execFileSync('/usr/bin/strip', ['-S', file], {stdio:'pipe'});
        if ((await fs.readFile(file)).includes(privatePath)) {
          throw new Error('Native package still contains a personal build path.');
        }
      }
    }
  }
  await walk(native);
  const archive = path.join(root, 'Contents/Resources/app.asar');
  if ((await fs.readFile(archive)).includes(privatePath)) {
    throw new Error('Application archive contains a personal build path.');
  }
};
