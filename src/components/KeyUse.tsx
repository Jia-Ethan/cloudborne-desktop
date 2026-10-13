import { useEffect, useState } from 'react';
import { api, errorText, type ApiKey, type Group } from '../api';
import { useI18n } from '../i18n';
import { canImportToCcSwitch, ccSwitchLink, exampleModel, snippet, type SnippetLang } from '../keys';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

const LANGS: { id: SnippetLang; name: string }[] = [
  { id: 'curl', name: 'cURL' },
  { id: 'python', name: 'Python' },
  { id: 'node', name: 'Node.js' },
];

export function KeyUse({
  apiKey,
  group,
  onClose,
  onToast,
}: {
  apiKey: ApiKey;
  group: Group | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [origin, setOrigin] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [lang, setLang] = useState<SnippetLang>('curl');
  const platform = group?.platform ?? 'openai';

  useEffect(() => {
    api.relayOrigin().then(setOrigin, () => {});
    api.keyModels(apiKey.key).then(setModels, () => {});
  }, [apiKey.key]);

  const model = exampleModel(platform, models);
  const base = origin + (platform === 'antigravity' ? '/antigravity' : '');

  return (
    <Dialog title={apiKey.name} onClose={onClose} wide>
      <div className="form-grid">
        <Copyable label={t('keys.baseUrl')} value={base} />
        <Copyable label={t('keys.apiKey')} value={apiKey.key} />

        <div className="form-row">
          <div className="flex items-center justify-between">
            <span>{t('keys.example')}</span>
            <div className="seg seg-sm" role="tablist">
              {LANGS.map((l) => (
                <button key={l.id} role="tab" aria-selected={lang === l.id} className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          {origin && <CodeBlock code={snippet(lang, platform, origin, apiKey.key, model)} />}
        </div>

        {origin && canImportToCcSwitch(platform) && (
          <button
            className="btn btn-quiet justify-self-start"
            onClick={() =>
              api.openCcSwitch(ccSwitchLink(platform, origin, apiKey.key, model)).catch((e) => onToast(errorText(e, t('common.genericError'))))
            }
          >
            {t('keys.ccswitch')}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function useCopied(): [boolean, (v: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);
  return [
    copied,
    (v) => {
      navigator.clipboard.writeText(v).catch(() => {});
      setCopied(true);
    },
  ];
}

function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, copy] = useCopied();
  return (
    <div className="form-row">
      <span>{label}</span>
      <div className="copy-field">
        <code>{value || '…'}</code>
        <button className={copied ? 'copied' : ''} title={t('keys.copy')} aria-label={t('keys.copy')} onClick={() => copy(value)}>
          <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, copy] = useCopied();
  return (
    <div className="md-code key-code">
      <pre>{code}</pre>
      <button className="md-copy" title={t('keys.copy')} aria-label={t('keys.copy')} onClick={() => copy(code)}>
        <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
      </button>
    </div>
  );
}
