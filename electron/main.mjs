import {runChatRecovery} from './claude-chat-job.mjs';
import {filePreview} from './file-preview.mjs';
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {AccessStore, accessKinds} from './access.mjs';
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
const isStore = process.mas === true;
app.setName(isStore ? 'BranchDeck Store' : 'BranchDeck');
if (process.env.BRANCHDECK_DATA_DIR) app.setPath('userData', process.env.BRANCHDECK_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else bootstrap().catch(error => { dialog.showErrorBox('BranchDeck 启动失败', error.message); app.exit(1); });
async function bootstrap() {
  await app.whenReady();
  const dataDirectory = app.getPath('userData');
  let language = app.getLocale().startsWith('zh') ? 'zh-CN' : 'en';
  const text = (zh, en) => language === 'zh-CN' ? zh : en;
  const realHome = process.env.BRANCHDECK_DISCOVERY_HOME || os.userInfo().homedir;
  const access = new AccessStore({directory: dataDirectory, enabled: isStore, home: realHome, startAccessing: bookmark => app.startAccessingSecurityScopedResource(bookmark)});
  access.restore();
  app.on('will-quit', () => access.close());
  const store = new Store(dataDirectory);
  let environment = await loginEnvironment(isStore ? {HOME: realHome} : {});
  const manager = new Manager(dataDirectory, environment);
  const shellEnvironment=process.env.BRANCHDECK_DISCOVERY_HOME?{...environment,HOME:process.env.BRANCHDECK_DISCOVERY_HOME,ZDOTDIR:process.env.BRANCHDECK_DISCOVERY_HOME,HISTFILE:path.join(process.env.BRANCHDECK_DISCOVERY_HOME,'.zsh_history')}:environment;
  const sessions=new TerminalSessions(dataDirectory,shellEnvironment,manager);
  const rootsFile = path.join(dataDirectory, 'scan-roots.json');
  let roots = []; try { roots = JSON.parse(fs.readFileSync(rootsFile, 'utf8')); } catch {}
  const discoveryHome = isStore ? realHome : process.env.BRANCHDECK_DISCOVERY_HOME || os.homedir();
  const canAccess = target => access.allows(target);
  const history = new HistoryDiscovery({home:discoveryHome,environment:process.env.BRANCHDECK_DISCOVERY_HOME?{}:environment,canAccess});
  const automaticHistory = new HistoryDiscovery({home:discoveryHome,environment:process.env.BRANCHDECK_DISCOVERY_HOME?{}:environment,canAccess});
  const catalog=new CommandCatalog(dataDirectory);
  const workspaceCatalog=new WorkspaceCatalog(dataDirectory);
  let automaticCandidates=[],historyScannedAt=0,historyWarnings=[];
  const refreshHistory=()=>{const result=automaticHistory.scan({limit:2000});automaticCandidates=result.candidates;discovery.historyRoots=result.workspaceRoots;historyWarnings=result.warnings;historyScannedAt=Date.now();};
  const syncHistoryGrants=()=>{if(isStore){history.extraFiles=access.paths('history');automaticHistory.extraFiles=access.paths('history');}};
  syncHistoryGrants();
  const discovery = new Discovery({ canAccess, home: discoveryHome, codexHome: process.env.BRANCHDECK_DISCOVERY_HOME ? path.join(discoveryHome, '.codex') : process.env.CODEX_HOME || path.join(discoveryHome, '.codex'), claudeHome: process.env.BRANCHDECK_DISCOVERY_HOME ? path.join(discoveryHome, '.claude') : process.env.CLAUDE_CONFIG_DIR || path.join(discoveryHome, '.claude'), roots, metadata: process.env.BRANCHDECK_NO_DISCOVERY !== '1' });
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
  handle('language', value => { if (!['en', 'zh-CN'].includes(value)) throw new Error('Invalid language'); language = value; updateMenus(); updateTray(); });
  const configFor = id => { const config = store.configs.find(c => c.id === id); if (!config) throw new Error('配置不存在'); return config; };
  handle('snapshot', async () => ({ access: access.snapshot(), configs: await Promise.all(store.configs.map(async c => ({ ...c, git: await branchInfo(c.cwd), exists: fs.existsSync(c.cwd) }))), runs: manager.list(), sessions:sessions.list(), commandRevision:catalog.revision, dataDirectory, historyScannedAt, historyWarnings, scanIntervalMinutes:5, discovery: workspaceCatalog.view(discovery.result) }));
  handle('discover', async () => {await scan();return workspaceCatalog.view(discovery.result);});
  let chatRecovery=null;
  handle('claude-chat-recover',()=>{
    if(chatRecovery)return chatRecovery;
    if(isStore)throw Error('聊天缓存提取需要非沙盒版本');
    if(process.platform!=='darwin')throw Error('当前仅支持 macOS Claude Desktop 缓存');
    const source=path.join(discoveryHome,'Library','Application Support','Claude');
    if(!fs.existsSync(source))throw Error('未找到 Claude 本地缓存，请先安装并使用 Claude Desktop');
    if(!canAccess(source))throw Error('没有读取 Claude 本地缓存的权限');
    chatRecovery=(async()=>{
      const result=await runChatRecovery({home:discoveryHome,destination:path.join(dataDirectory,'Claude Chat Archive')});
      if(!discovery.roots.includes(result.output))discovery.roots.push(result.output);
      atomicJson(rootsFile,discovery.roots);
      if(scanning)await scanning;
      await scan();workspaceCatalog.revive(result.output,discovery.result.workspaces);broadcast();
      return {...result,workspaceId:discovery.result.workspaces.find(w=>w.path===result.output)?.id};
    })().finally(()=>{chatRecovery=null;});
    return chatRecovery;
  });
  handle('workspace-remove',(id,scope)=>{const entry=workspaceCatalog.remove(discovery.result.workspaces,id,scope);broadcast();return entry;});
  handle('workspace-restore',id=>{workspaceCatalog.restore(id);broadcast();});
  handle('launchers', async id => {const view=await commandView(id);return [...view.commands,...view.suggestions];});
  handle('command-view', id=>commandView(id));
  handle('command-move',async(id,commandId,targetId,after)=>{const view=catalog.move(discovery.get(id),await allLaunchers(id),commandId,targetId,!!after,store.configs);broadcast();return view;});
  handle('command-remove',async(id,commandId)=>{const view=catalog.remove(discovery.get(id),await allLaunchers(id),commandId,store.configs);broadcast();return view;});
  handle('command-restore',async(id,commandId)=>{const view=catalog.restore(discovery.get(id),await allLaunchers(id),commandId,store.configs);broadcast();return view;});
  handle('command-decide', async(id,commandId,decision)=>{const view=catalog.decide(discovery.get(id),await allLaunchers(id),commandId,decision,store.configs);broadcast();return view;});
  handle('history-scan', () => {refreshHistory();broadcast();return history.scan();});
  const chooseAccess=async(kind, options, replacingId)=>{
    const result=await dialog.showOpenDialog(window,{...options, ...(isStore?{securityScopedBookmarks:true}: {})});
    access.accept(result,kind,replacingId);
    return result;
  };
  handle('access-status',()=>access.snapshot());
  handle('access-grant',async(kind,replacingId)=>{
    if(!isStore||!accessKinds.includes(kind))throw new Error('当前版本不需要此授权');
    const previous=access.entries.find(e=>e.id===replacingId);
    if(replacingId&&(!previous||previous.kind!==kind))throw new Error('授权记录已变化');
    const defaults={workspace:path.join(realHome,'Documents'),metadata:path.join(realHome,'.codex'),history:path.join(realHome,'.zsh_history'),shell:path.join(realHome,'.zshrc'),ssh:path.join(realHome,'.ssh'),tools:'/opt/homebrew',home:realHome};
    const directories=['workspace','tools','home'].includes(kind);
    const result=await chooseAccess(kind,{title:'选择要授权给 BranchDeck 的'+({workspace:'项目目录',metadata:'项目索引',history:'历史文件',shell:'Shell 配置',ssh:'SSH 文件',tools:'工具链目录',home:'个人目录'}[kind]),defaultPath:previous?.path||defaults[kind],properties:[...(directories?['openDirectory']:kind==='history'?['openFile']:['openFile','openDirectory']),'showHiddenFiles']},replacingId);
    if(result.canceled)return access.snapshot();
    if(kind==='workspace'){const root=fs.realpathSync(result.filePaths[0]);if(!discovery.roots.includes(root))discovery.roots.push(root);atomicJson(rootsFile,discovery.roots);}
    syncHistoryGrants();
    environment=await loginEnvironment({HOME:realHome});manager.environment=environment;sessions.environment=environment;history.environment=environment;automaticHistory.environment=environment;
    await scan();broadcast();return access.snapshot();
  });
  handle('access-forget',id=>{if(!isStore)throw new Error('当前版本不需要此授权');access.forget(id);broadcast();return access.snapshot();});
  handle('history-file', async () => {
    const result=await chooseAccess('history',{properties:['openFile','showHiddenFiles'],title:text('选择 Shell 历史文件', 'Choose a shell history file')});
    if(result.canceled)return null;
    if(isStore)syncHistoryGrants();else{history.extraFiles=[result.filePaths[0]];automaticHistory.extraFiles=[result.filePaths[0]];}refreshHistory();broadcast();return history.scan();
  });
  handle('history-import', async (scanId,selections) => {
    if(quitDialog||quitting)throw new Error('正在退出，请稍后导入');
    const {configs,skipped}=history.prepare(scanId,selections,store.configs);
    store.importConfigs(configs);configs.forEach(c=>catalog.revive(c));broadcast();
    if(configs.some(c=>!discovery.result.workspaces.some(w=>c.cwd===w.path||c.cwd.startsWith(w.path+path.sep))))awaitScan();
    return {imported:configs.length,skipped};
  });
  handle('claude-cache-list', id => discovery.claudeCache.list(discovery.get(id), discovery.result.workspaces));
  handle('claude-cache-preview', (id, fileId, offset) => discovery.claudeCache.preview(discovery.get(id), discovery.result.workspaces, fileId, offset));
  handle('folders', (id, relative) => discovery.folders(id, relative));
  handle('add-root', async () => { const result = await chooseAccess('workspace', { properties: ['openDirectory'], title: text('添加工作区或包含多个项目的目录', 'Add a workspace or a folder containing projects') }); if (result.canceled) return null; const root = fs.realpathSync(result.filePaths[0]); if (!discovery.roots.includes(root)) discovery.roots.push(root); atomicJson(rootsFile, discovery.roots); await scan(); workspaceCatalog.revive(root,discovery.result.workspaces); broadcast(); return root; });
  handle('workspace-open', id => openPath(discovery.get(id).path));
  handle('workspace-copy-path', id => { clipboard.writeText(discovery.get(id).path); });
  const folderTrash=new FolderTrash({
    protectedPaths:[os.homedir(),discoveryHome,dataDirectory,app.getAppPath()],
    linked:async target=>{for(const directory of new Set([target,...discovery.result.workspaces.filter(w=>within(target,w.path)).map(w=>w.path)]))await checkLinkedWorktrees(directory);},
    related:target=>{
      const matches=sessions.list().filter(s=>within(target,s.cwd)||discovery.result.workspaces.some(w=>w.id===s.workspaceId&&within(target,w.path))).map(s=>({...s,type:'session'}));
      for(const r of manager.list())if(manager.isActive(r.configId)&&within(target,r.cwd)&&!matches.some(s=>s.configId===r.configId))matches.push({id:r.configId,pid:r.pid,name:configFor(r.configId).name,type:'run'});
      return matches;
    },
    confirm:async(target,related)=>{const answer=await dialog.showMessageBox(window,{type:'warning',buttons:[text('取消', 'Cancel'),related.length?text('关闭相关终端并移到废纸篓', 'Close related terminals and move to Trash'):text('移到废纸篓', 'Move to Trash')],defaultId:0,cancelId:0,message:text(`删除文件夹「${path.basename(target)}」？`, `Move folder “${path.basename(target)}” to Trash?`),detail:text(`将把下面的文件夹及其全部内容移到系统废纸篓：\n${target}\n\n${related.length?`将关闭 ${related.length} 个相关终端或服务：${related.map(s=>s.name).join('、')}。未保存的终端输入将丢失。\n`:''}需要恢复时，请在 Finder 的废纸篓中放回原位置。`, `This folder and all its contents will be moved to the system Trash:\n${target}\n\n${related.length ? `${related.length} related terminals or services will be closed. Unfinished terminal input will be lost.\n` : ''}To restore it, use Put Back in Finder’s Trash.`)});return answer.response===1;},
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
  handle('file-preview',(id,relative,offset=0)=>{const {target}=sessionWorkspace(id,relative);if(!canAccess(target))throw Error('文件未授权');return filePreview(target,offset);});
  handle('file-reveal',(id,relative)=>shell.showItemInFolder(sessionWorkspace(id,relative).target));
  handle('terminal-snapshot', id => manager.terminalSnapshot(id));
  handle('terminal-input', (id, runId, data) => manager.input(id, runId, data));
  handle('terminal-resize', (id, runId, cols, rows) => manager.resize(id, runId, cols, rows));
  handle('logs', id => { configFor(id); return manager.tail(id); });
  handle('pick-directory', async () => { const result = await chooseAccess('workspace', { properties: ['openDirectory', 'createDirectory'], title: text('选择代码工作目录', 'Choose a project working directory') }); return result.canceled ? null : result.filePaths[0]; });
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
    tray.setToolTip(text(`BranchDeck · ${count} 个运行实例`, `BranchDeck · ${count} running`));
    tray.setContextMenu(Menu.buildFromTemplate([{ label: text('打开 BranchDeck', 'Open BranchDeck'), click: show }, { label: text(`${count} 个实例运行中`, `${count} running sessions`), enabled: false }, { type: 'separator' }, ...store.configs.map(c => ({ label: `${manager.isActive(c.id) ? '●' : '○'} ${c.name}`, click: () => { show(); } })), { type: 'separator' }, { label: text('退出 BranchDeck…', 'Quit BranchDeck…'), click: () => app.quit() }]));
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
  function updateMenus() { Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'BranchDeck', submenu: [{ role: 'about' }, { type: 'separator' }, { label: text('显示主窗口', 'Show main window'), accelerator: 'CmdOrCtrl+Shift+B', click: show }, { role: 'hide' }, { type: 'separator' }, { label: text('退出…', 'Quit…'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
    { label: text('编辑', 'Edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: text('窗口', 'Window'), submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: text('显示主窗口', 'Show main window'), click: show }] }
  ])); }
  updateMenus();
  app.on('activate', show); app.on('second-instance', show);
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (quitDialog||folderTrash.busy) return;
    if (manager.pending.size||sessions.initializing.size) { show(); dialog.showMessageBox(window, { message: text('正在检查启动配置，请稍后退出。', 'Checking launch configuration. Please try quitting again shortly.') }); return; }
    quitDialog = true;
    (async () => {
      if (manager.children.size||sessions.list().some(s=>s.busy||s.draft)) {
        const result = await dialog.showMessageBox(window, { type: 'question', buttons: [text('取消', 'Cancel'), text('停止全部并退出', 'Stop all and quit')], defaultId: 0, cancelId: 0, message: text('仍有终端正在运行程序或有未提交的输入', 'Terminals are running programs or contain unfinished input'), detail: text('关闭窗口可以保留服务在菜单栏运行。退出应用会停止本应用启动的所有实例。', 'Close the window to keep services running in the menu bar. Quitting stops all terminals and services launched by this app.') });
        if (result.response !== 1) return;
      }
      await sessions.stopAll(); await manager.stopAll(); quitting = true; app.quit();
    })().catch(error => dialog.showErrorBox(text('无法安全退出', 'Unable to quit safely'), error.message)).finally(() => { quitDialog = false; });
  });
}
