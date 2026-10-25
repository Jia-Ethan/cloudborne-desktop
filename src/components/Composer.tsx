import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import type { Attachment } from '../agent';
import { useI18n } from '../i18n';
import type { Agent } from '../useAgent';
import { Icon } from './Icon';
import { ModelMenu } from './ModelMenu';

const MAX_IMAGES = 4;
const MAX_BYTES = 8 * 1024 * 1024;

function readImage(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith('image/') || file.size > MAX_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name || 'image.png', data: String(r.result) });
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

/** The draft lives in `agent`, so it survives switching pages and tasks. */
export function Composer({ agent, continuing }: { agent: Agent; continuing: boolean }) {
  const { t } = useI18n();
  const { text: draft, images } = agent.draft;
  const setImages = (f: (cur: Attachment[]) => Attachment[]) => agent.setDraft((d) => ({ ...d, images: f(d.images) }));
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = agent.isRunning(agent.currentId);
  const canSend = !running && !!agent.model && (draft.trim() !== '' || images.length > 0);

  const add = async (files: FileList | File[]) => {
    const read = (await Promise.all([...files].map(readImage))).filter((a): a is Attachment => !!a);
    setImages((cur) => [...cur, ...read].slice(0, MAX_IMAGES));
  };

  const submit = () => {
    if (!canSend) return;
    agent.send(draft.trim(), images);
    agent.setDraft(() => ({ text: '', images: [] }));
  };

  return (
    <div
      className={`composer ${dropping ? 'dropping' : ''}`}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDropping(false);
        add(e.dataTransfer.files);
      }}
    >
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((a, i) => (
            <div key={i} className="composer-thumb">
              <img src={a.data} alt="" />
              <button
                aria-label={t('agent.remove')}
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
              >
                <Icon name="close" className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        value={draft}
        rows={2}
        autoFocus
        placeholder={continuing ? t('agent.placeholderContinue') : t('agent.placeholder')}
        onChange={(e) => agent.setDraft((d) => ({ ...d, text: e.target.value }))}
        onPaste={(e: ClipboardEvent) => {
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (files.length) {
            e.preventDefault();
            add(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-footer">
        <button className="icon-button" aria-label={t('agent.attach')} title={t('agent.attach')} onClick={() => fileInput.current?.click()}>
          <Icon name="paperclip" className="size-[17px]" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />
        <ModelMenu agent={agent} />
        {running ? (
          <button className="send-button" aria-label={t('agent.stop')} title={t('agent.stop')} onClick={agent.stop}>
            <span className="stop-square" />
          </button>
        ) : (
          <button className="send-button" aria-label={t('agent.send')} title={t('agent.send')} disabled={!canSend} onClick={submit}>
            <Icon name="arrowUp" className="size-[18px]" />
          </button>
        )}
      </div>
    </div>
  );
}
