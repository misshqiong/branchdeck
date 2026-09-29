export type RemovedWorkspace={id:string;scope:'workspace'|'group';path:string;groupId:string;name:string};
export type Config = { id:string; name:string; cwd:string; command:string; environment:string; kind:'service'|'task'; port:number|null; env:Record<string,string>; timeout:number; stopCommand?:string; stopSignal?:'SIGTERM'|'SIGINT'; stopTimeout?:number; requiresConfirm?:boolean; category?:string; git?:{root:string;branch:string;commit:string}; exists?:boolean };
export type Run = { id:string; configId:string; kind?:string; status:string; pid:number|null; branch:string; commit:string; cwd:string; command:string; startedAt:number; endedAt:number|null; exitCode:number|null; detail:string; logPath:string };
export type Workspace = { id:string; path:string; name:string; displayName?:string; branch:string; commit:string; groupId:string; repository:string; sources:string[]; updatedAt:number; isWorktree:boolean };
export type Launcher = Config & { history?:{id:string;count:number;evidence:string}; relative:string; evidence:string; detected:boolean; description?:string };
export type FolderEntry = { name:string; relative:string; directory:boolean; manifest:boolean };
export type DiscoveryResult = {removed?:RemovedWorkspace[]; workspaces:Workspace[]; scannedAt:number|null; warnings:string[]; scanning:boolean };
export type CommandView = {commands:Launcher[];suggestions:Launcher[];removed:Launcher[]};
export type Session = {id:string;workspaceId:string;name:string;kind:'shell'|'service';cwd:string;status:string;busy:boolean;draft:boolean;configId:string|null;runId:string|null;pid:number|null};
export type SessionEvent = {sessionId:string;sequence:number;data:string};
export type Snapshot = {commandRevision?:number;sessions:Session[]; historyWarnings?:string[];scanIntervalMinutes?:number; historyScannedAt?:number; configs:Config[]; runs:Run[]; dataDirectory:string; discovery:DiscoveryResult };
export type TerminalEvent = {configId:string;runId:string;sequence:number;data:string};
export type HistoryCandidate = {id:string;command:string;name:string;cwd:string|null;kind:'service'|'task';category:string;count:number;lastUsed:number|null;sources:string[];directoryEvidence:string;requiresConfirm:boolean};
export type HistoryResult = {scanId:string;candidates:HistoryCandidate[];sources:{path:string;name:string;records:number}[];warnings:string[];skipped:number;records:number};
export type Bridge = {
 sessionEnsure(id:string):Promise<Session>;sessionCreate(id:string,relative?:string):Promise<Session>;sessionSend(id:string,launcherId:string,sessionId?:string,fillOnly?:boolean):Promise<Session>;
 sessionSnapshot(id:string):Promise<{sequence:number;data:string}>;sessionInput(id:string,data:string):Promise<void>;sessionResize(id:string,cols:number,rows:number):Promise<void>;sessionInterrupt(id:string):Promise<void>;sessionClose(id:string,confirmed?:boolean):Promise<{requiresConfirm:boolean}>;
 filePreview(id:string,relative:string):Promise<{path:string;content:string}>;onSessionData(callback:(event:SessionEvent)=>void):()=>void;

 workspaceRemove(id:string,scope:'workspace'|'group'):Promise<RemovedWorkspace>;workspaceRestore(id:string):Promise<void>;
 commandMove(id:string,commandId:string,targetId:string,after:boolean):Promise<CommandView>;commandRemove(id:string,commandId:string):Promise<CommandView>;commandRestore(id:string,commandId:string):Promise<CommandView>;
 commandView(id:string):Promise<CommandView>;commandDecide(id:string,commandId:string,decision:"accept"|"dismiss"):Promise<CommandView>;
 historyScan():Promise<HistoryResult>;historyFile():Promise<HistoryResult|null>;historyImport(scanId:string,selections:{id:string;cwd:string}[]):Promise<{imported:number;skipped:number}>;

 terminalSnapshot(id:string):Promise<{runId:string|null;sequence:number;data:string;active:boolean}>; terminalInput(id:string,runId:string,data:string):Promise<void>; terminalResize(id:string,runId:string,cols:number,rows:number):Promise<void>; onTerminal(callback:(event:TerminalEvent)=>void):()=>void;
 snapshot():Promise<Snapshot>; discover():Promise<DiscoveryResult>; launchers(id:string):Promise<Launcher[]>; folders(id:string,relative?:string):Promise<FolderEntry[]>; addRoot():Promise<string|null>; openWorkspace(id:string):Promise<void>; launch(workspaceId:string,launcherId:string):Promise<Run>;
 save(config:Partial<Config>):Promise<Config>; remove(id:string):Promise<void>; action(id:string,action:string):Promise<void>; logs(id:string):Promise<string>; pickDirectory():Promise<string|null>; openDirectory(id:string):Promise<void>; openLog(id:string):Promise<void>; openData():Promise<void>; tools():Promise<{name:string;path:string}[]>;
 onChange(callback:()=>void):()=>void; onLog(callback:(value:{configId:string;runId:string;text:string})=>void):()=>void;
};
declare global { interface Window { branchdeck:Bridge } }
