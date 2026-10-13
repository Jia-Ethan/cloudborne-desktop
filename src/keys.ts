import type { ApiKey } from './api';

/** `sk-abcd…wxyz`: enough to tell keys apart without showing them. */
export function maskKey(k: string): string {
  return k.length <= 14 ? k : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

/** Platforms whose groups take Anthropic's Messages API; the rest take Chat Completions. */
export const MESSAGES_PLATFORMS = ['anthropic', 'antigravity'];

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-5-5',
  antigravity: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-4.5',
};

/** A chat model to put in the examples: the first one the key serves, else a known default. */
export function exampleModel(platform: string, models: string[]): string {
  const chat = models.find((m) => !/(image|audio|embed|tts|whisper|moderation|imagine)/i.test(m));
  return chat ?? DEFAULT_MODEL[platform] ?? 'gpt-5.4';
}

export type SnippetLang = 'curl' | 'python' | 'node';

/** A minimal request in each language, with the key and endpoint filled in. */
export function snippet(lang: SnippetLang, platform: string, origin: string, key: string, model: string): string {
  const root = origin.replace(/\/+$/, '') + (platform === 'antigravity' ? '/antigravity' : '');
  if (MESSAGES_PLATFORMS.includes(platform)) {
    if (lang === 'python')
      return `from anthropic import Anthropic

client = Anthropic(
    base_url="${root}",
    api_key="${key}",
)

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`;
    if (lang === 'node')
      return `import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: '${root}',
  apiKey: '${key}',
})

const message = await client.messages.create({
  model: '${model}',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
})
console.log(message.content[0].text)`;
    return `curl ${root}/v1/messages \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
  }
  const base = `${root}/v1`;
  if (lang === 'python')
    return `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="${key}",
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(completion.choices[0].message.content)`;
  if (lang === 'node')
    return `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${base}',
  apiKey: '${key}',
})

const completion = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: 'Hello!' }],
})
console.log(completion.choices[0].message.content)`;
  return `curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
}

// Same balance query the relay's web console hands CC Switch.
const CCS_USAGE_SCRIPT = `({
    request: {
      url: "{{baseUrl}}/v1/usage",
      method: "GET",
      headers: { "Authorization": "Bearer {{apiKey}}" }
    },
    extractor: function(response) {
      const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;
      const unit = response?.unit ?? response?.quota?.unit ?? "USD";
      return {
        isValid: response?.is_active ?? response?.isValid ?? true,
        remaining,
        unit
      };
    }
  })`;

/** CC Switch app per platform; platforms it has no app for are left out. */
const CCS_APP: Record<string, { app: string; v1?: boolean }> = {
  anthropic: { app: 'claude' },
  openai: { app: 'codex' },
  gemini: { app: 'gemini' },
  grok: { app: 'grokbuild', v1: true },
};

export function canImportToCcSwitch(platform: string): boolean {
  return platform in CCS_APP;
}

/** The `ccswitch://` link that adds this key as a provider, as the web console builds it. */
export function ccSwitchLink(platform: string, origin: string, key: string, model?: string): string {
  const c = CCS_APP[platform];
  const base = origin.replace(/\/+$/, '');
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', c.app],
    ['name', 'Cloudborne'],
    ['homepage', base],
    ['endpoint', c.v1 ? `${base}/v1` : base],
    ['apiKey', key],
    ['configFormat', 'json'],
    ['usageEnabled', 'true'],
    ['usageScript', btoa(CCS_USAGE_SCRIPT)],
    ['usageAutoInterval', '30'],
  ];
  if (model && (platform === 'openai' || platform === 'grok')) entries.splice(2, 0, ['model', model]);
  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`;
}

export interface KeyForm {
  name: string;
  groupId: number | null;
  /** Only when creating; empty lets the relay generate one. */
  customKey: string;
  /** Dollars; empty or 0 is unlimited. */
  quota: string;
  /** 'keep' leaves an existing expiry alone. */
  expiry: 'keep' | 'never' | '7' | '30' | '90';
  limit5h: string;
  limit1d: string;
  limit7d: string;
  /** One address or CIDR per line. */
  allow: string;
  deny: string;
}

export function emptyForm(): KeyForm {
  return { name: '', groupId: null, customKey: '', quota: '', expiry: 'never', limit5h: '', limit1d: '', limit7d: '', allow: '', deny: '' };
}

export function formOf(k: ApiKey): KeyForm {
  const n = (v: number) => (v > 0 ? String(v) : '');
  return {
    name: k.name,
    groupId: k.group_id,
    customKey: '',
    quota: n(k.quota),
    expiry: 'keep',
    limit5h: n(k.rate_limit_5h),
    limit1d: n(k.rate_limit_1d),
    limit7d: n(k.rate_limit_7d),
    allow: (k.ip_whitelist ?? []).join('\n'),
    deny: (k.ip_blacklist ?? []).join('\n'),
  };
}

const lines = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
const amount = (s: string) => {
  const v = Number(s.trim() || 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** The relay's create body. Unlimited fields are left out. */
export function createBody(f: KeyForm): Record<string, unknown> {
  const b: Record<string, unknown> = { name: f.name.trim(), group_id: f.groupId };
  if (f.customKey.trim()) b.custom_key = f.customKey.trim();
  if (amount(f.quota)) b.quota = amount(f.quota);
  if (f.expiry !== 'never' && f.expiry !== 'keep') b.expires_in_days = Number(f.expiry);
  if (amount(f.limit5h)) b.rate_limit_5h = amount(f.limit5h);
  if (amount(f.limit1d)) b.rate_limit_1d = amount(f.limit1d);
  if (amount(f.limit7d)) b.rate_limit_7d = amount(f.limit7d);
  if (lines(f.allow).length) b.ip_whitelist = lines(f.allow);
  if (lines(f.deny).length) b.ip_blacklist = lines(f.deny);
  return b;
}

/** The relay's update body. Limits are always sent, so clearing a field removes the limit. */
export function updateBody(f: KeyForm, now = new Date()): Record<string, unknown> {
  const b: Record<string, unknown> = {
    name: f.name.trim(),
    group_id: f.groupId,
    quota: amount(f.quota),
    rate_limit_5h: amount(f.limit5h),
    rate_limit_1d: amount(f.limit1d),
    rate_limit_7d: amount(f.limit7d),
    ip_whitelist: lines(f.allow),
    ip_blacklist: lines(f.deny),
  };
  if (f.expiry === 'never') b.expires_at = '';
  else if (f.expiry !== 'keep') b.expires_at = new Date(now.getTime() + Number(f.expiry) * 864e5).toISOString();
  return b;
}

/** Custom keys: at least 16 letters, digits, `_` or `-`, as the relay requires. */
export function customKeyProblem(k: string): 'short' | 'chars' | null {
  const s = k.trim();
  if (!s) return null;
  if (s.length < 16) return 'short';
  return /^[A-Za-z0-9_-]+$/.test(s) ? null : 'chars';
}
