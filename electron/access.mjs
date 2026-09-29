import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson} from './store.mjs';

export const accessKinds = ['workspace', 'metadata', 'history', 'shell', 'ssh', 'tools', 'home'];
const contains = (root, target) => target === root || target.startsWith(root + path.sep);

// Bookmarks never cross IPC. Keep scopes alive until all child processes stop.
export class AccessStore {
  constructor({directory, enabled = false, startAccessing, home}) {
    this.enabled = enabled;
    this.file = path.join(directory, 'access-bookmarks.json');
    this.startAccessing = startAccessing;
    this.home = home;
    this.entries = [];
    this.active = new Map();
    this.errors = new Map();
    this.pendingRemoval = new Set();
    if (!enabled) return;
    try {
      const entries = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('invalid bookmarks');
      this.entries = entries.filter(e => typeof e.id === 'string' && accessKinds.includes(e.kind) && typeof e.path === 'string' && path.isAbsolute(e.path) && e.path !== '/' && typeof e.bookmark === 'string' && e.bookmark.length > 0);
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = '目录授权记录无法读取，请重新授权所需目录。';
    }
  }
  restore() {
    for (const entry of this.entries) {
      try { this.activate(entry); }
      catch { this.errors.set(entry.id, '授权已失效或位置已改变，请重新选择。'); }
    }
  }
  activate(entry) {
    const stop = this.startAccessing(entry.bookmark);
    if (typeof stop !== 'function') throw new Error('无法恢复目录授权');
    try {
      const real = fs.realpathSync(entry.path);
      if (real !== entry.path) throw new Error('授权路径已改变');
      fs.accessSync(real, fs.constants.R_OK);
      this.active.set(entry.id, {stop, path: real, directory: fs.statSync(real).isDirectory()});
      this.errors.delete(entry.id);
    } catch (error) { stop(); throw error; }
  }
  accept(result, kind, replacingId) {
    if (result.canceled) return [];
    if (!this.enabled) return result.filePaths;
    if (!accessKinds.includes(kind)) throw new Error('授权类型无效');
    if (replacingId && !this.entries.some(e => e.id === replacingId)) throw new Error('授权记录已变化');
    if (!result.filePaths?.length || result.bookmarks?.length !== result.filePaths.length || result.bookmarks.some(b => typeof b !== 'string' || !b)) throw new Error('系统没有返回持久授权，请重新选择。');
    const added = [];
    try {
      for (let i = 0; i < result.filePaths.length; i++) {
        const selected = fs.realpathSync(result.filePaths[i]);
        if (selected === '/' || (kind === 'home' && selected !== this.home)) throw new Error(kind === 'home' ? '请选择当前用户的个人目录。' : '请选择具体目录，而不是整个磁盘。');
        if (['workspace', 'home', 'tools'].includes(kind) && !fs.statSync(selected).isDirectory()) throw new Error('请选择目录。');
        const entry = {id: randomUUID(), path: selected, kind, bookmark: result.bookmarks[i]};
        this.activate(entry);
        added.push(entry);
      }
      const replaced = this.entries.filter(e => e.id === replacingId || added.some(n => n.path === e.path && n.kind === e.kind));
      const next = this.entries.filter(e => !replaced.includes(e)).concat(added);
      atomicJson(this.file, next.filter(e => !this.pendingRemoval.has(e.id)));
      this.entries = next;
      for (const entry of replaced) {
        this.active.get(entry.id)?.stop();
        this.active.delete(entry.id);
        this.errors.delete(entry.id);
        this.pendingRemoval.delete(entry.id);
      }
      this.loadError = undefined;
      return added.map(e => e.path);
    } catch (error) {
      for (const entry of added) { this.active.get(entry.id)?.stop(); this.active.delete(entry.id); }
      throw error;
    }
  }
  forget(id) {
    if (!this.entries.some(e => e.id === id)) throw new Error('授权记录不存在');
    // Existing shells inherit grants. Removing a bookmark only revokes future launches.
    atomicJson(this.file, this.entries.filter(e => e.id !== id && !this.pendingRemoval.has(e.id)));
    this.pendingRemoval.add(id);
  }
  allows(target) {
    if (!this.enabled) return true;
    if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
    try {
      const real = fs.realpathSync(target);
      return [...this.active.values()].some(e => e.directory ? contains(e.path, real) : e.path === real);
    } catch { return false; }
  }
  paths(kind) { return this.entries.filter(e => e.kind === kind && this.active.has(e.id)).map(e => e.path); }
  snapshot() {
    return {enabled: this.enabled, warning: this.loadError || '', entries: this.entries.map(e => ({id: e.id, path: e.path, kind: e.kind, active: this.active.has(e.id), pendingRemoval: this.pendingRemoval.has(e.id), error: this.errors.get(e.id) || ''}))};
  }
  close() { for (const {stop} of this.active.values()) stop(); this.active.clear(); }
}
