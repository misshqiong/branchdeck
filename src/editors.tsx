import {t, language, setLanguage, type Language} from './i18n';
import { AccessPanel } from './AccessPanel';
import { useEffect, useState } from 'react';
import { X, FolderOpen, Check, Trash2, ChevronDown, Terminal, ShieldCheck } from 'lucide-react';
import type { Config } from './types';
const api = window.branchdeck;
export function Editor({ config, onClose, onSave, onDelete }: {
    config: Partial<Config>;
    onClose: () => void;
    onSave: (c: Partial<Config>) => Promise<void>;
    onDelete?: () => void;
}) {
    const [form, setForm] = useState({ ...config, name: config.name || '', command: config.command || '', cwd: config.cwd || '', kind: config.kind || 'service', environment: config.environment || 'Local', port: config.port?.toString() || '', timeout: config.timeout || 90, stopSignal: config.stopSignal || 'SIGTERM', stopTimeout: config.stopTimeout || 5, stopCommand: config.stopCommand || '' });
    const [env, setEnv] = useState(Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const update = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));
    useEffect(() => { const fn = (e: KeyboardEvent) => { if (e.key === 'Escape')
        onClose(); }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn); }, []);
    return <div className="backdrop"><form className="modal editor" role="dialog" aria-label={t("运行方式")} aria-modal="true" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
        const vars: Record<string, string> = {};
        for (const line of env.split('\n')) {
            if (!line.trim())
                continue;
            const i = line.indexOf('=');
            if (i < 1)
                throw new Error(t("环境变量格式为 KEY=value"));
            vars[line.slice(0, i).trim()] = line.slice(i + 1);
        }
        await onSave({ ...form, name: form.name.trim() || form.command.slice(0, 60), port: form.port ? Number(form.port) : null, env: vars });
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>
 <div className="modal-head"><div><span className="overline">MAKE IT YOURS</span><h2>{config.id ? t("调整运行方式") : config.kind === 'task' ? t("添加常用命令") : t("添加启动方式")}</h2></div><button type="button" className="icon" aria-label={t("关闭配置")} onClick={onClose}><X size={19}/></button></div>
 <label>{t("执行目录")}<div className="path-field"><input aria-label={t("执行目录")} required value={form.cwd} onChange={e => update('cwd', e.target.value)}/><button type="button" title={t("选择目录")} onClick={async () => { const p = await api.pickDirectory(); if (p)
        update('cwd', p); }}><FolderOpen size={16}/></button></div></label>
 <label>{form.kind === 'task' ? t("常用命令") : t("启动命令")}<textarea aria-label={form.kind === 'task' ? t("常用命令") : t("启动命令")} autoFocus required rows={2} placeholder={t("例如 pnpm run dev")} value={form.command} onChange={e => update('command', e.target.value)}/></label>
 <label>{t("显示名称")}<small>{t("可选")}</small><input placeholder={t("不填写则使用命令名称")} value={form.name} onChange={e => update('name', e.target.value)}/></label>
 <details><summary><ChevronDown size={14}/>{t("高级设置")}<span>{t("关闭方式、端口、环境变量")}</span></summary><div className="advanced">
 <div className="field-grid"><label>{t("运行类型")}<select value={form.kind} onChange={e => update('kind', e.target.value)}><option value="service">{t("常驻服务")}</option><option value="task">{t("一次性命令")}</option></select></label><label>{t("环境标签")}<input value={form.environment} onChange={e => update('environment', e.target.value)}/></label>
 <label>{t("关闭信号")}<select value={form.stopSignal} onChange={e => update('stopSignal', e.target.value)}><option value="SIGTERM">{t("正常终止 · SIGTERM")}</option><option value="SIGINT">{t("终端中断 · Ctrl+C")}</option></select></label><label>{t("关闭等待（秒）")}<input type="number" min="1" max="60" value={form.stopTimeout} onChange={e => update('stopTimeout', Number(e.target.value))}/></label></div>
 <label>{t("关闭前执行")}<small>{t("可选")}</small><input placeholder={t("例如 pnpm run stop")} value={form.stopCommand} onChange={e => update('stopCommand', e.target.value)}/><small>{t("在同目录执行，最多等待 5 秒，随后正常结束本次进程组。")}</small></label>
 <div className="field-grid"><label>{t("就绪端口")}<small>{t("可选")}</small><input type="number" min="1" max="65535" placeholder="3000" value={form.port} onChange={e => update('port', e.target.value)}/></label><label>{t("就绪等待（秒）")}<input type="number" min="5" max="3600" value={form.timeout} onChange={e => update('timeout', Number(e.target.value))}/></label></div>
 <label>{t("环境变量")}<textarea rows={3} placeholder={'NODE_ENV=development\nJAVA_HOME=/path/to/jdk'} value={env} onChange={e => setEnv(e.target.value)}/><small>{t("每行 KEY=value，保存在本机明文配置中。")}</small></label>
 <label className="checkbox"><input type="checkbox" checked={!!form.requiresConfirm} onChange={e => update('requiresConfirm', e.target.checked)}/>{t("执行前确认（适用于会修改工作区的命令）")}</label>
 </div></details>
 {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-foot">{onDelete && <button type="button" className="danger-text" onClick={onDelete}><Trash2 size={14}/>{t("移除命令")}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{t("取消")}</button><button className="primary" disabled={busy}><Check size={15}/>{busy ? t("保存中") : t("保存")}</button></div>
 </form></div>;
}
export function Settings({ path, onClose }: {
    path: string;
    onClose: () => void;
}) {
    const [tools, setTools] = useState<{
        name: string;
        path: string;
    }[]>([]), [error, setError] = useState('');
    useEffect(() => { api.tools().then(setTools).catch(e => setError(e.message)); }, []);
    return <div className="backdrop"><section className="modal settings" role="dialog" aria-label={t("应用设置")} aria-modal="true"><div className="modal-head"><div><span className="overline">ON YOUR MACHINE</span><h2>{t("应用设置")}</h2></div><button className="icon" aria-label={t("关闭设置")} onClick={onClose}><X size={19}/></button></div><label className="language-setting">Language / 语言<select aria-label="Language / 语言" value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label><AccessPanel /><h3>{t("自动发现")}</h3><p>{t("在可访问范围内读取 Codex、Claude Code 项目索引、终端历史中的目录和常见代码目录，并补全 Git worktree。其它工具创建的本地项目也可通过目录发现。首次自动整理匹配的历史命令，之后每 5 分钟扫描并建议添加。不会读取对话正文或自动执行命令。")}</p><h3>{t("工具路径")}</h3><div className="tools">{tools.length ? tools.map(t => <div key={t.name}><code>{t.name}</code><span title={t.path}>{t.path}</span></div>) : t("正在读取登录 Shell 环境…")}</div><h3>{t("数据目录")}</h3><p className="mono">{path}</p><button className="secondary" onClick={() => api.openData().catch(e => setError(e.message))}><FolderOpen size={15}/>{t("在 Finder 中打开")}</button><div className="info-box"><ShieldCheck size={17}/><p>{t("终端使用登录交互式 zsh，加载你的 Shell 配置。切换工作区或隐藏窗口会保留会话；完全退出应用会关闭终端及托管程序。")}</p></div>{error && <p className="form-error">{error}</p>}<div className="settings-version"><Terminal size={14}/>{t("BranchDeck 0.10 · 工作区终端")}</div></section></div>;
}
