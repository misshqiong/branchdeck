// The PTY's session/group leader stays alive until all foreground descendants exit.
import {spawn,spawnSync} from 'node:child_process';
const encoded=process.env.BRANCHDECK_LAUNCH;
delete process.env.BRANCHDECK_LAUNCH;
delete process.env.ELECTRON_RUN_AS_NODE;
let launch;
try { launch=JSON.parse(Buffer.from(encoded||'', 'base64').toString('utf8')); } catch { console.error('Invalid terminal launch'); process.exit(127); }
let child,finished=false,stopping=false,exitCode=null,hardTimer,timer;
function members(){const result=spawnSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:2000});if(result.status!==0)throw new Error('Process inspection failed');return result.stdout.split('\n').map(l=>l.trim().split(/\s+/)).filter(([pid,group,state])=>Number(group)===process.pid&&Number(pid)!==process.pid&&Number(pid)!==result.pid&&!state?.startsWith('Z'));}
function stop(signal='SIGTERM'){
 if(stopping)return;stopping=true;let signalled=false;
 const terminate=()=>{if(signalled)return;signalled=true;hardTimer=setTimeout(()=>{try{process.kill(-process.pid,'SIGKILL');}catch{process.exit(1);}},(launch.stopTimeout||5)*1000);try{process.kill(-process.pid,signal);}catch{process.exit(0);}};
 if(launch.stopCommand){console.log('[BranchDeck] 执行自定义停止命令');const stopper=spawn('/bin/zsh',['-c',launch.stopCommand],{cwd:launch.cwd,env:launch.env,stdio:['ignore','inherit','inherit']});const deadline=setTimeout(terminate,5000);stopper.once('error',e=>{console.error(e.message);clearTimeout(deadline);terminate();});stopper.once('exit',code=>{if(code)console.error('[BranchDeck] 关闭命令退出码',code);clearTimeout(deadline);terminate();});}else terminate();
}
process.on('SIGTERM',()=>stop(launch.stopSignal==='SIGINT'?'SIGINT':'SIGTERM'));
process.on('SIGINT',()=>stop('SIGINT'));
// PTY hangup after the GUI crashes still cleans up owned descendants.
process.on('SIGHUP',()=>stop('SIGTERM'));
process.stdout.write('\x1b]777;branchdeck-ready\x07');
child=spawn('/bin/zsh',['-c',launch.command],{cwd:launch.cwd,env:launch.env,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);finished=true;exitCode=127;});
child.on('exit',(code,signal)=>{finished=true;exitCode=code??(signal==='SIGINT'?130:1);});
timer=setInterval(()=>{if(!finished&&!stopping)return;try{if(!members().length){clearInterval(timer);clearTimeout(hardTimer);process.exit(stopping?130:exitCode??1);}}catch{/* Retain group ownership when inspection cannot establish exit. */}},200);
