import {chmodSync,existsSync} from 'node:fs';
for (const directory of ['build/Release','build/Debug',`prebuilds/${process.platform}-${process.arch}`]) {
 const helper=new URL(`../node_modules/node-pty/${directory}/spawn-helper`,import.meta.url);
 if(existsSync(helper))chmodSync(helper,0o755);
}
