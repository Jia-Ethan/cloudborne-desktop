import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type Lang = 'zh-CN' | 'en';

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'zh-CN', name: '简体中文' },
  { id: 'en', name: 'English' },
];

const zh = {
  'login.title': '登录 Cloudborne',
  'login.email': '邮箱',
  'login.password': '密码',
  'login.submit': '登录',
  'login.twoFactor': '两步验证',
  'login.twoFactorHint': '输入 {email} 绑定的验证器里的 6 位数字',
  'login.yourAccount': '你的账号',
  'login.verify': '验证',
  'login.back': '返回',
  'common.wait': '请稍候…',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.copied': '已复制',
  'common.genericError': '出了点问题，请重试',
  'nav.home': '首页',
  'nav.newTask': '新任务',
  'nav.recent': '最近',
  'agent.title': 'AI 工具出问题？让 Cloudborne 帮你。',
  'agent.case1': '检查我的 Claude Code 接入，修好连不上的问题',
  'agent.case2': '把我的 Claude Code skills 装到 Codex 里',
  'agent.case3': 'Codex 接入后报错了，帮我查本地配置',
  'agent.placeholder': '让 Cloudborne 帮你检查、配置和修复本机的 AI 工具',
  'agent.placeholderContinue': '继续提出需求',
  'agent.attach': '添加截图',
  'agent.remove': '移除',
  'agent.send': '发送',
  'agent.stop': '停止',
  'agent.modelMenu': '选择模型和推理强度',
  'agent.effort': '推理',
  'agent.model': '模型',
  'effort.low': '低',
  'effort.medium': '中',
  'effort.high': '高',
  'effort.xhigh': '超高',
  'agent.thinking': '思考中',
  'agent.thought': '思考',
  'agent.cmdRunning': '正在运行命令',
  'agent.cmdsDone': '已运行 {n} 条命令',
  'agent.cmdFailed': '命令失败',
  'agent.filesRunning': '正在编辑文件',
  'agent.filesDone': '已编辑 {n} 个文件',
  'change.add': '新增',
  'change.delete': '删除',
  'change.update': '修改',
  'agent.searched': '已搜索网络',
  'agent.called': '已调用 {name}',
  'agent.plan': '计划',
  'agent.preparing': '正在准备运行环境',
  'agent.preparingPct': '正在准备运行环境 {pct}%',
  'agent.stopped': '已停止',
  'agent.retry': '重试',
  'agent.details': '详细信息',
  'agent.copyCode': '复制代码',
  'agent.delete': '删除',
  'agent.untitled': '新任务',
  'agent.noModels': '你的账号下没有可用的 GPT 分组',
  'fail.balance': '余额不足',
  'fail.auth': '登录状态失效，请重新登录',
  'fail.rate': '请求太频繁，请稍后再试',
  'fail.runtime': '运行环境没能准备好',
  'fail.network': '网络连接失败',
  'fail.other': '出了点问题',
  'fail.signIn': '重新登录',
  'nav.main': '主导航',
  'menu.account': '账户菜单',
  'menu.copyEmail': '点击复制账号',
  'menu.console': '控制台',
  'menu.language': '语言',
  'menu.checkUpdate': '检查更新',
  'menu.updateTo': '更新到 v{version}',
  'menu.about': '关于 Cloudborne',
  'menu.logout': '退出账号',
  'update.checking': '正在检查…',
  'update.latest': '已是最新版本',
  'update.failed': '检查失败',
  'update.downloading': '正在下载…',
  'update.downloadingPct': '正在下载 {pct}%',
  'update.installing': '正在安装…',
  'update.checkError': '检查更新失败：{msg}',
  'update.installError': '更新失败：{msg}',
  'about.version': '版本 {version}',
  'home.balance': '钱包余额',
  'home.refresh': '刷新余额和工具状态',
  'home.connect': '一键接入',
  'home.recheck': '重新检测',
  'tool.badConfig': '配置文件有问题',
  'tool.connected': '已连接 Cloudborne',
  'tool.installed': '已安装',
  'tool.notInstalled': '未安装',
  'tool.update': '更新配置',
  'tool.disconnect': '断开',
  'tool.installCli': '安装 CLI',
  'tool.connectCta': '连接 Cloudborne',
  'tool.install': '一键安装',
  'tool.working': '处理中…',
  'tool.pickGroup': '选择要用的分组：',
  'tool.noGroups': '你的账号下没有能给这个工具用的分组',
  'tool.disconnectAsk': '断开后恢复成连接前的配置。要不要同时删除中转站上的专用密钥？',
  'tool.disconnectOnly': '只断开',
  'tool.disconnectAndDelete': '断开并删除密钥',
  'toast.connected': '{tool} 已连接到「{group}」分组，重启 {tool} 后生效',
  'toast.needsNode': '安装 Codex 需要先装 Node.js，已打开下载页',
  'toast.package': '已下载并打开安装包：{path}',
  'toast.terminal': '已在终端里开始安装 {tool}，装完回来点「重新检测」',
  'toast.disconnected': '{tool} 已断开',
  'toast.disconnectedDeleted': '{tool} 已断开，专用密钥已删除',
};

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  'login.title': 'Sign in to Cloudborne',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.twoFactor': 'Two-step verification',
  'login.twoFactorHint': 'Enter the 6-digit code from the authenticator linked to {email}',
  'login.yourAccount': 'your account',
  'login.verify': 'Verify',
  'login.back': 'Back',
  'common.wait': 'Please wait…',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copied': 'Copied',
  'common.genericError': 'Something went wrong. Please try again.',
  'nav.home': 'Home',
  'nav.newTask': 'New task',
  'nav.recent': 'Recent',
  'agent.title': 'AI tools acting up? Let Cloudborne help.',
  'agent.case1': 'Check my Claude Code setup and fix the connection',
  'agent.case2': 'Install my Claude Code skills into Codex',
  'agent.case3': 'Codex errors after connecting. Check my local config',
  'agent.placeholder': 'Ask Cloudborne to check, set up or fix the AI tools on this computer',
  'agent.placeholderContinue': 'Ask a follow-up',
  'agent.attach': 'Add screenshot',
  'agent.remove': 'Remove',
  'agent.send': 'Send',
  'agent.stop': 'Stop',
  'agent.modelMenu': 'Choose model and reasoning',
  'agent.effort': 'Reasoning',
  'agent.model': 'Model',
  'effort.low': 'Low',
  'effort.medium': 'Medium',
  'effort.high': 'High',
  'effort.xhigh': 'Extra high',
  'agent.thinking': 'Thinking',
  'agent.thought': 'Thought',
  'agent.cmdRunning': 'Running a command',
  'agent.cmdsDone': 'Ran {n} commands',
  'agent.cmdFailed': 'Command failed',
  'agent.filesRunning': 'Editing files',
  'agent.filesDone': 'Edited {n} files',
  'change.add': 'Added',
  'change.delete': 'Deleted',
  'change.update': 'Modified',
  'agent.searched': 'Searched the web',
  'agent.called': 'Called {name}',
  'agent.plan': 'Plan',
  'agent.preparing': 'Setting up the runtime',
  'agent.preparingPct': 'Setting up the runtime {pct}%',
  'agent.stopped': 'Stopped',
  'agent.retry': 'Retry',
  'agent.details': 'Details',
  'agent.copyCode': 'Copy code',
  'agent.delete': 'Delete',
  'agent.untitled': 'New task',
  'agent.noModels': 'Your account has no GPT group',
  'fail.balance': 'Balance too low',
  'fail.auth': 'Your session has expired. Please sign in again.',
  'fail.rate': 'Too many requests. Try again shortly.',
  'fail.runtime': 'The runtime could not be set up',
  'fail.network': 'Network connection failed',
  'fail.other': 'Something went wrong',
  'fail.signIn': 'Sign in again',
  'nav.main': 'Main navigation',
  'menu.account': 'Account menu',
  'menu.copyEmail': 'Click to copy',
  'menu.console': 'Console',
  'menu.language': 'Language',
  'menu.checkUpdate': 'Check for updates',
  'menu.updateTo': 'Update to v{version}',
  'menu.about': 'About Cloudborne',
  'menu.logout': 'Sign out',
  'update.checking': 'Checking…',
  'update.latest': 'Up to date',
  'update.failed': 'Check failed',
  'update.downloading': 'Downloading…',
  'update.downloadingPct': 'Downloading {pct}%',
  'update.installing': 'Installing…',
  'update.checkError': 'Could not check for updates: {msg}',
  'update.installError': 'Update failed: {msg}',
  'about.version': 'Version {version}',
  'home.balance': 'Balance',
  'home.refresh': 'Refresh balance and tool status',
  'home.connect': 'Connect your tools',
  'home.recheck': 'Re-check',
  'tool.badConfig': 'Config file has a problem',
  'tool.connected': 'Connected to Cloudborne',
  'tool.installed': 'Installed',
  'tool.notInstalled': 'Not installed',
  'tool.update': 'Update config',
  'tool.disconnect': 'Disconnect',
  'tool.installCli': 'Install CLI',
  'tool.connectCta': 'Connect Cloudborne',
  'tool.install': 'Install',
  'tool.working': 'Working…',
  'tool.pickGroup': 'Choose a group:',
  'tool.noGroups': 'Your account has no group this tool can use',
  'tool.disconnectAsk': 'Disconnecting restores the config from before. Also delete the dedicated key on the relay?',
  'tool.disconnectOnly': 'Disconnect only',
  'tool.disconnectAndDelete': 'Disconnect and delete key',
  'toast.connected': '{tool} is connected to the “{group}” group. Restart {tool} to use it.',
  'toast.needsNode': 'Codex needs Node.js first. The download page is open.',
  'toast.package': 'Downloaded and opened the installer: {path}',
  'toast.terminal': 'Installing {tool} in Terminal. Click Re-check when it finishes.',
  'toast.disconnected': '{tool} is disconnected',
  'toast.disconnectedDeleted': '{tool} is disconnected and its key deleted',
};

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { 'zh-CN': zh, en };
const STORAGE_KEY = 'cloudborne.lang';

export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh-CN' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const I18n = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    api.setLanguage(lang).catch(() => {});
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    // A short fade so the swap reads as one change rather than a flicker.
    const root = document.documentElement;
    root.classList.remove('lang-swap');
    void root.offsetWidth;
    root.classList.add('lang-swap');
    setLangState(l);
  }, []);

  const value = useMemo(() => {
    const table = MESSAGES[lang];
    const t: T = (key, vars) =>
      table[key].replace(/\{(\w+)\}/g, (m, name: string) => (vars && name in vars ? String(vars[name]) : m));
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n() {
  const v = useContext(I18n);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
