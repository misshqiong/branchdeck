import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {FolderTrash,within,checkLinkedWorktrees} from './folder-trash.mjs';
import {WorkspaceCatalog} from './workspace-catalog.mjs';
import {CommandCatalog} from './catalog.mjs';
import {matchHistory} from './history-workspace.mjs';
import {HistoryDiscovery} from './history.mjs';
import { Discovery, launchersFor, gitLaunchers } from './discovery.mjs';
import { atomicJson } from './store.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import {TerminalSessions} from './sessions.mjs';
import { Manager } from './manager.mjs';
import { branchInfo, loginEnvironment, run } from './system.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
app.setName('BranchDeck');
if (process.env.BRANCHDECK_DATA_DIR) app.setPath('userData', process.env.BRANCHDECK_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else bootstrap().catch(error => { dialog.showErrorBox('BranchDeck 启动失败', error.message); app.exit(1); });
async function bootstrap() {
  await app.whenReady();
  const dataDirectory = app.getPath('userData');
  const store = new Store(dataDirectory);
  const environment = await loginEnvironment();
  const manager = new Manager(dataDirectory, environment);
  const shellEnvironment=process.env.BRANCHDECK_DISCOVERY_HOME?{...environment,HOME:process.env.BRANCHDECK_DISCOVERY_HOME,ZDOTDIR:process.env.BRANCHDECK_DISCOVERY_HOME,HISTFILE:path.join(process.env.BRANCHDECK_DISCOVERY_HOME,'.zsh_history')}:environment;
  const sessions=new TerminalSessions(dataDirectory,shellEnvironment,manager);
  const rootsFile = path.join(dataDirectory, 'scan-roots.json');
  let roots = []; try { roots = JSON.parse(fs.readFileSync(rootsFile, 'utf8')); } catch {}
  const discoveryHome = process.env.BRANCHDECK_DISCOVERY_HOME || os.homedir();
  const history = new HistoryDiscovery({home:discoveryHome,environment:process.env.BRANCHDECK_DISCOVERY_HOME?{}:environment});
  const automaticHistory = new HistoryDiscovery({home:discoveryHome,environment:process.env.BRANCHDECK_DISCOVERY_HOME?{}:environment});
  const catalog=new CommandCatalog(dataDirectory);
  const workspaceCatalog=new WorkspaceCatalog(dataDirectory);
  let automaticCandidates=[],historyScannedAt=0,historyWarnings=[];
  const refreshHistory=()=>{const result=automaticHistory.scan({limit:2000});automaticCandidates=result.candidates;discovery.historyRoots=result.workspaceRoots;historyWarnings=result.warnings;historyScannedAt=Date.now();};
  const discovery = new Discovery({ home: discoveryHome, codexHome: process.env.BRANCHDECK_DISCOVERY_HOME ? path.join(discoveryHome, '.codex') : process.env.CODEX_HOME || path.join(discoveryHome, '.codex'), claudeHome: process.env.BRANCHDECK_DISCOVERY_HOME ? path.join(discoveryHome, '.claude') : process.env.CLAUDE_CONFIG_DIR || path.join(discoveryHome, '.claude'), roots, metadata: process.env.BRANCHDECK_NO_DISCOVERY !== '1' });
  const allLaunchers = async id => { const w = discovery.get(id); const list = await launchersFor(w, store.configs); return matchHistory(w,automaticCandidates,[...list,...gitLaunchers(w).filter(g=>!list.some(c=>c.id===g.id))]).filter(l=>!l.detected||!store.configs.some(c=>c.id===l.id&&c.cwd!==l.cwd)); };
  const commandView=async id=>catalog.reconcile(discovery.get(id),await allLaunchers(id),store.configs);
  let scanning;
  const scan = () => folderTrash.busy?Promise.resolve(discovery.result):(scanning ||= (async()=>{refreshHistory();const promise=discovery.scan(store.configs);broadcast();const result=await promise;broadcast();return result;})().finally(()=>{scanning=null;}));
  let window, tray, quitting = false, quitDialog = false;
  const rendererURL = process.env.BRANCHDECK_DEV_URL || pathToFileURL(path.join(directory, '../dist/index.html')).href;
  function show() { if (window) { window.show(); window.focus(); } }
  function validSender(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url.split('#')[0] === rendererURL.split('#')[0]; }
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!validSender(event)) return { ok: false, error: '请求来源不受信任' };
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  function awaitScan() { scan().catch(error => { discovery.result.warnings = [error.message]; broadcast(); }); }
  const configFor = id => { const config = store.configs.find(c => c.id === id); if (!config) throw new Error('配置不存在'); return config; };
  handle('snapshot', async () => ({ configs: await Promise.all(store.configs.map(async c => ({ ...c, git: await branchInfo(c.cwd), exists: fs.existsSync(c.cwd) }))), runs: manager.list(), sessions:sessions.list(), commandRevision:catalog.revision, dataDirectory, historyScannedAt, historyWarnings, scanIntervalMinutes:5, discovery: workspaceCatalog.view(discovery.result) }));
  handle('discover', async () => {await scan();return workspaceCatalog.view(discovery.result);});
  handle('workspace-remove',(id,scope)=>{const entry=workspaceCatalog.remove(discovery.result.workspaces,id,scope);broadcast();return entry;});
  handle('workspace-restore',id=>{workspaceCatalog.restore(id);broadcast();});
  handle('launchers', async id => {const view=await commandView(id);return [...view.commands,...view.suggestions];});
  handle('command-view', id=>commandView(id));
  handle('command-move',async(id,commandId,targetId,after)=>{const view=catalog.move(discovery.get(id),await allLaunchers(id),commandId,targetId,!!after,store.configs);broadcast();return view;});
  handle('command-remove',async(id,commandId)=>{const view=catalog.remove(discovery.get(id),await allLaunchers(id),commandId,store.configs);broadcast();return view;});
  handle('command-restore',async(id,commandId)=>{const view=catalog.restore(discovery.get(id),await allLaunchers(id),commandId,store.configs);broadcast();return view;});
  handle('command-decide', async(id,commandId,decision)=>{const view=catalog.decide(discovery.get(id),await allLaunchers(id),commandId,decision,store.configs);broadcast();return view;});
  handle('history-scan', () => {refreshHistory();broadcast();return history.scan();});
  handle('history-file', async () => {
    const result=await dialog.showOpenDialog(window,{properties:['openFile','showHiddenFiles'],title:'选择 Shell 历史文件'});
    if(result.canceled)return null;
    history.extraFiles=[result.filePaths[0]];automaticHistory.extraFiles=[result.filePaths[0]];refreshHistory();broadcast();return history.scan();
  });
  handle('history-import', async (scanId,selections) => {
    if(quitDialog||quitting)throw new Error('正在退出，请稍后导入');
    const {configs,skipped}=history.prepare(scanId,selections,store.configs);
    store.importConfigs(configs);configs.forEach(c=>catalog.revive(c));broadcast();
    if(configs.some(c=>!discovery.result.workspaces.some(w=>c.cwd===w.path||c.cwd.startsWith(w.path+path.sep))))awaitScan();
    return {imported:configs.length,skipped};
  });
  handle('folders', (id, relative) => discovery.folders(id, relative));
  handle('add-root', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: '添加工作区或包含多个项目的目录' }); if (result.canceled) return null; const root = fs.realpathSync(result.filePaths[0]); if (!discovery.roots.includes(root)) discovery.roots.push(root); atomicJson(rootsFile, discovery.roots); await scan(); workspaceCatalog.revive(root,discovery.result.workspaces); broadcast(); return root; });
  handle('workspace-open', id => openPath(discovery.get(id).path));
  const folderTrash=new FolderTrash({
    protectedPaths:[os.homedir(),discoveryHome,dataDirectory,app.getAppPath()],
    linked:async target=>{for(const directory of new Set([target,...discovery.result.workspaces.filter(w=>within(target,w.path)).map(w=>w.path)]))await checkLinkedWorktrees(directory);},
    related:target=>{
      const matches=sessions.list().filter(s=>within(target,s.cwd)||discovery.result.workspaces.some(w=>w.id===s.workspaceId&&within(target,w.path))).map(s=>({...s,type:'session'}));
      for(const r of manager.list())if(manager.isActive(r.configId)&&within(target,r.cwd)&&!matches.some(s=>s.configId===r.configId))matches.push({id:r.configId,pid:r.pid,name:configFor(r.configId).name,type:'run'});
      return matches;
    },
    confirm:async(target,related)=>{const answer=await dialog.showMessageBox(window,{type:'warning',buttons:['取消',related.length?'关闭相关终端并移到废纸篓':'移到废纸篓'],defaultId:0,cancelId:0,message:`删除文件夹「${path.basename(target)}」？`,detail:`将把下面的文件夹及其全部内容移到系统废纸篓：\n${target}\n\n${related.length?`将关闭 ${related.length} 个相关终端或服务：${related.map(s=>s.name).join('、')}。未保存的终端输入将丢失。\n`:''}需要恢复时，请在 Finder 的废纸篓中放回原位置。`});return answer.response===1;},
    close:item=>item.type==='session'?sessions.close(item.id):manager.stop(item.id),
    trash:target=>shell.trashItem(target)
  });
  handle('folder-trash',async(id,relative='')=>{
    if(quitting||quitDialog||manager.pending.size||sessions.initializing.size)throw new Error('有程序正在启动或退出，请稍后删除');
    if(scanning)await scanning;
    const result=await folderTrash.delete(discovery.get(id).path,relative);
    if(result.deleted){if(scanning)await scanning;await scan();broadcast();}
    return result;
  });
  handle('launch', async (workspaceId, launcherId) => {
    if (folderTrash.busy) throw new Error('正在删除文件夹，请稍后操作');
    if (quitDialog || quitting) throw new Error('正在退出，请先取消退出再操作');
    const launcher = (await commandView(workspaceId)).commands.find(l => l.id === launcherId);
    if(folderTrash.busy)throw new Error('正在删除文件夹，请稍后操作');
    if (!launcher) throw new Error('启动项已变化，请重新选择');
    const config = store.configs.find(c => c.id === launcherId) || store.save(launcher);
    return manager.start(config);
  });
  handle('save', config => { if (manager.isActive(config.id)) throw new Error('请先停止此配置再编辑'); const saved = store.save(config); catalog.revive(saved); broadcast(); if (!discovery.result.workspaces.some(w => saved.cwd === w.path || saved.cwd.startsWith(w.path + path.sep))) awaitScan(); return saved; });
  handle('remove', id => { configFor(id); if (manager.isActive(id)) throw new Error('请先停止此配置再删除'); store.delete(id); catalog.forget(id); broadcast(); });
  handle('action', async (id, action) => {
    const config = configFor(id);
    if (folderTrash.busy) throw new Error('正在删除文件夹，请稍后操作');
    if (quitDialog || quitting) throw new Error('正在处理退出，请先取消退出再操作');
    if (action === 'start') return manager.start(config);
    if (action === 'stop') return manager.stop(id);
    if (action === 'force') return manager.stop(id, true);
    if (action === 'restart') { await manager.stop(id); return manager.start(config); }
    throw new Error('不支持的操作');
  });
  const sessionWorkspace=(id,relative='')=>{
    const w=discovery.get(id),target=fs.realpathSync(path.resolve(w.path,relative));
    if(target!==w.path&&!target.startsWith(w.path+path.sep))throw new Error('路径不在此工作区内');
    return {w,target};
  };
  const canOpen=()=>{if(folderTrash.busy)throw new Error('正在删除文件夹，请稍后操作');if(quitDialog||quitting)throw new Error('正在退出，请稍后操作');};
  handle('session-ensure',id=>{canOpen();return sessions.ensure(discovery.get(id));});
  handle('session-create',(id,relative='')=>{canOpen();const {w,target}=sessionWorkspace(id,relative);if(!fs.statSync(target).isDirectory())throw new Error('请选择目录');return sessions.create(w,target);});
  handle('session-send',async(id,launcherId,sessionId,fillOnly=false)=>{
    canOpen();const launcher=(await commandView(id)).commands.find(l=>l.id===launcherId);canOpen();if(!launcher)throw new Error('命令已变化，请重新选择');
    const config=store.configs.find(c=>c.id===launcherId)||store.save(launcher);
    return sessions.send(discovery.get(id),config,sessionId,!!fillOnly);
  });
  handle('session-snapshot',id=>sessions.snapshot(id));
  handle('session-input',(id,data)=>sessions.input(id,data));
  handle('session-resize',(id,cols,rows)=>sessions.resize(id,cols,rows));
  handle('session-interrupt',id=>sessions.interrupt(id));
  handle('session-close',async(id,confirmed=false)=>{const s=sessions.get(id);if((s.busy||s.draft)&&!confirmed)return {requiresConfirm:true};await sessions.close(id);return {requiresConfirm:false};});
  handle('file-preview',(id,relative)=>{
    const {target}=sessionWorkspace(id,relative),stat=fs.statSync(target);
    if(!stat.isFile())throw new Error('请选择文件');if(stat.size>1024*1024)throw new Error('文件超过 1 MB，请在编辑器中打开');
    const content=fs.readFileSync(target);if(content.includes(0))throw new Error('暂不支持二进制文件预览');
    return {path:target,content:content.toString('utf8')};
  });
  handle('terminal-snapshot', id => manager.terminalSnapshot(id));
  handle('terminal-input', (id, runId, data) => manager.input(id, runId, data));
  handle('terminal-resize', (id, runId, cols, rows) => manager.resize(id, runId, cols, rows));
  handle('logs', id => { configFor(id); return manager.tail(id); });
  handle('pick-directory', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择代码工作目录' }); return result.canceled ? null : result.filePaths[0]; });
  const openPath = async target => { const error = await shell.openPath(target); if (error) throw new Error(error); };
  handle('open-directory', id => openPath(configFor(id).cwd));
  handle('open-log', id => { configFor(id); const current = manager.get(id); if (current && fs.existsSync(current.logPath)) shell.showItemInFolder(current.logPath); else throw new Error('尚无运行日志'); });
  handle('open-data', () => openPath(dataDirectory));
  handle('tools', () => Promise.all(['node', 'pnpm', 'npm', 'java', 'git'].map(async name => {
    try { const executable = await run('/bin/zsh', ['-c', `command -v ${name}`], { env: environment }); return { name, path: executable || '未找到' }; }
    catch { return { name, path: '未找到' }; }
  })));
  function updateTray() {
    if (!tray) return;
    const count = sessions.list().filter(s=>s.busy).length;
    tray.setToolTip(`BranchDeck · ${count} 个运行实例`);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 BranchDeck', click: show }, { label: `${count} 个实例运行中`, enabled: false }, { type: 'separator' }, ...store.configs.map(c => ({ label: `${manager.isActive(c.id) ? '●' : '○'} ${c.name}`, click: () => { show(); } })), { type: 'separator' }, { label: '退出 BranchDeck…', click: () => app.quit() }]));
  }
  let changeTimer;
  function broadcast() { clearTimeout(changeTimer); changeTimer = setTimeout(() => { if (window && !window.isDestroyed()) window.webContents.send('change'); updateTray(); }, 60); }
  sessions.on('change',broadcast);
  sessions.on('data',value=>{if(window&&!window.isDestroyed())window.webContents.send('session-data',value);});
  manager.on('change', broadcast);
  manager.on('terminal', value => { if(window&&!window.isDestroyed())window.webContents.send('terminal',value); });
  manager.on('log', value => { if (window && !window.isDestroyed()) window.webContents.send('log', value); });
  window = new BrowserWindow({ width: 1440, height: 900, minWidth: 980, minHeight: 640, title: 'BranchDeck', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 21 }, backgroundColor: '#fafbf9', webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  await window.loadURL(rendererURL);
  awaitScan();
  const scanInterval=process.env.BRANCHDECK_DISCOVERY_HOME&&Number(process.env.BRANCHDECK_TEST_SCAN_MS)>=1000?Number(process.env.BRANCHDECK_TEST_SCAN_MS):5*60000;
  const discoveryTimer = setInterval(awaitScan, scanInterval);
  app.on('will-quit', () => clearInterval(discoveryTimer));
  const icon = nativeImage.createFromPath(path.join(directory, '../assets/tray.png')); icon.setTemplateImage(true);
  tray = new Tray(icon); tray.on('click', show); updateTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BranchDeck', submenu: [{ role: 'about' }, { type: 'separator' }, { label: '显示主窗口', accelerator: 'CmdOrCtrl+Shift+B', click: show }, { role: 'hide' }, { type: 'separator' }, { label: '退出…', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: '显示主窗口', click: show }] }
  ]));
  app.on('activate', show); app.on('second-instance', show);
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (quitDialog||folderTrash.busy) return;
    if (manager.pending.size||sessions.initializing.size) { show(); dialog.showMessageBox(window, { message: '正在检查启动配置，请稍后退出。' }); return; }
    quitDialog = true;
    (async () => {
      if (manager.children.size||sessions.list().some(s=>s.busy||s.draft)) {
        const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '停止全部并退出'], defaultId: 0, cancelId: 0, message: '仍有终端正在运行程序或有未提交的输入', detail: '关闭窗口可以保留服务在菜单栏运行。退出应用会停止本应用启动的所有实例。' });
        if (result.response !== 1) return;
      }
      await sessions.stopAll(); await manager.stopAll(); quitting = true; app.quit();
    })().catch(error => dialog.showErrorBox('无法安全退出', error.message)).finally(() => { quitDialog = false; });
  });
}
