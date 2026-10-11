import {t} from './i18n';
import { useEffect, useState } from 'react';
import type { AccessKind, AccessStatus } from './types';
const api = window.branchdeck;
const choices: {
    kind: AccessKind;
    label: string;
    detail: string;
}[] = [
    { kind: 'workspace', label: t("项目目录"), detail: t("选择项目或包含多个项目的目录；目录内的项目和 worktree 会自动发现。") },
    { kind: 'metadata', label: t("Codex / Claude 索引"), detail: t("可分别选择 .codex、.claude 和 .claude.json；索引指向的项目也需要目录授权。") },
    { kind: 'history', label: t("Shell 历史文件"), detail: t("选择 .zsh_history、.bash_history 或自定义历史文件，恢复历史命令建议。") },
    { kind: 'shell', label: t("Shell 配置"), detail: t("选择 .zshrc 等配置文件或其所在目录，保留别名和工具环境。") },
    { kind: 'ssh', label: t("SSH / Git 配置"), detail: t("选择 .ssh、.gitconfig 等所需文件或目录。授权后应用中的命令也能访问它们。") },
    { kind: 'tools', label: t("工具链目录"), detail: t("选择 Homebrew、Node 等安装目录；运行工具时还可能需要其缓存或配置目录。") },
    { kind: 'home', label: t("个人目录（可选）"), detail: t("一次授权个人目录可保留更多自动发现和 Shell 行为，也允许应用及其命令访问目录中的其他文件。可改为逐项授权。") }
];
export function AccessPanel() {
    const [status, setStatus] = useState<AccessStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { let alive = true; const refresh = () => api.accessStatus().then(s => { if (alive)
        setStatus(s); }).catch(e => { if (alive)
        setError(e.message); }); void refresh(); const off = api.onChange(refresh); return () => { alive = false; off(); }; }, []);
    if (!status?.enabled)
        return null;
    const perform = async (fn: () => Promise<AccessStatus>) => { setBusy(true); setError(''); try {
        setStatus(await fn());
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <section className="access-panel" aria-label={t("目录与文件授权")}>
  <h3>{t("目录与文件授权")}</h3><p>{t("选择允许 BranchDeck 访问的目录或文件。授权会在下次启动时恢复；新的 Shell 配置对新建终端生效。网络与终端仍受系统沙盒约束，目录授权不能解除所有限制。")}</p>
  {choices.map(c => <div className="access-choice" key={c.kind}><div><strong>{c.label}</strong><p>{c.detail}</p></div><button className="secondary" disabled={busy} onClick={() => perform(() => api.accessGrant(c.kind))}>{t("授权")}{c.label}</button></div>)}
  {!!status.entries.length && <h3>{t("已选择的位置")}</h3>}
  {status.entries.map(e => <div className="access-entry" key={e.id}><p className="mono">{e.path}</p><small>{e.pendingRemoval ? t("已停止保存授权，下次完全退出并重启后生效。") : e.active ? t("已授权") : e.error || t("需要重新授权")}</small><div><button className="secondary" disabled={busy || e.pendingRemoval} onClick={() => perform(() => api.accessGrant(e.kind, e.id))}>{t("重新授权")}</button><button className="secondary" disabled={busy || e.pendingRemoval} onClick={() => perform(() => api.accessForget(e.id))}>{t("下次启动移除授权")}</button></div></div>)}
  {(error || status.warning) && <p className="form-error" role="alert">{error || status.warning}</p>}
 </section>;
}
