const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {Arch} = require('builder-util');
const exec = promisify(execFile);

exports.default = async context => {
  if (context.electronPlatformName !== 'mas') return;
  const root = context.packager.projectDir;
  const arch = Arch[context.arch];
  const source = path.join(root, 'node_modules/node-pty');
  const version = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).version;
  if (version !== '1.1.0') throw new Error('Review the MAS PTY compatibility patch before updating node-pty.');
  const work = path.join(root, '.local/mas-pty', arch);
  await fs.mkdir(work, {recursive: true});
  await fs.cp(path.join(source, 'src'), path.join(work, 'src'), {recursive: true});
  await fs.copyFile(path.join(source, 'binding.gyp'), path.join(work, 'binding.gyp'));
  const file = path.join(work, 'src/unix/pty.cc');
  let code = await fs.readFile(file, 'utf8');
  for (const [from,to] of [
    ['res = tcsetattr(slave, TCSANOW, termp);', 'res = tcsetattr(*master, TCSANOW, termp);'],
    ['res = ioctl(slave, TIOCSWINSZ, winp);', 'res = ioctl(*master, TIOCSWINSZ, winp);']
  ]) {
    if (code.split(from).length !== 2) throw new Error('Unexpected node-pty source; MAS patch not applied.');
    code = code.replace(from,to);
  }
  // The standard App Sandbox allows PTY management through /dev/ptmx. Do not
  // request /dev path exceptions or disable sandboxing in a helper process.
  await fs.writeFile(file,code);
  const gyp = require.resolve('node-gyp/bin/node-gyp.js');
  const electronVersion = context.packager.config.electronVersion || require('electron/package.json').version;
  await exec(process.execPath, [gyp,'rebuild',`--directory=${work}`,`--arch=${arch}`,`--target=${electronVersion}`,`--devdir=${path.join(root,'.local/mas-pty/headers')}`,'--dist-url=https://electronjs.org/headers'], {cwd:root,maxBuffer:8*1024*1024});
  const unpacked = path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty`);
  // Replace only files already included in ASAR's unpacked manifest.
  const copied = new Set();
  for (const relative of ['build/Release',`prebuilds/darwin-${arch}`]) {
    for (const name of ['pty.node','spawn-helper']) {
      const dest=path.join(unpacked,relative,name);
      try { await fs.access(dest); } catch { continue; }
      await fs.copyFile(path.join(work,'build/Release',name),dest);
      if(name==='spawn-helper')await fs.chmod(dest,0o755);
      copied.add(name);
    }
  }
  if (copied.size !== 2) throw new Error('MAS PTY package is missing the native module or spawn helper.');
  await require('./sanitize-package.cjs').default(context);
  console.log(`MAS PTY: built node-pty ${version} for ${arch} with master-side terminal setup`);
};
