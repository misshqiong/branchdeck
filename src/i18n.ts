import english from './en.json';
export type Language = 'en' | 'zh-CN';
const saved = localStorage.getItem('branchdeck.language');
export const language: Language = saved === 'en' || saved === 'zh-CN' ? saved : navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
document.documentElement.lang = language;
window.branchdeck?.setLanguage(language).catch(error => console.error('Language sync failed', error));
export function t(message: string, values: unknown[] = []): string {
 const template = language === 'en' ? (english as Record<string,string>)[message] || message : message;
 return template.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
export function setLanguage(next: Language) {
 localStorage.setItem('branchdeck.language', next);
 // Only reload the renderer. Terminal processes live in Electron's main process.
 location.reload();
}
