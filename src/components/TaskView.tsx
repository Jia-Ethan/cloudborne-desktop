import type { CSSProperties } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import type { Agent } from '../useAgent';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { Icon } from './Icon';

const CASES: MessageKey[] = ['agent.case1', 'agent.case2', 'agent.case3'];

/** New task page, and the conversation once a task is open. */
export function TaskView({ agent, onSignIn }: { agent: Agent; onSignIn: () => void }) {
  const { t } = useI18n();
  const session = agent.current;

  if (!session || session.turns.length === 0) {
    return (
      <div className="task-empty">
        <div className="task-empty-column">
          <h1 className="rise" style={{ '--i': 0 } as CSSProperties}>
            {t('agent.title')}
          </h1>
          <div className="case-list">
            {CASES.map((k, i) => (
              <button key={k} className="case-item rise" style={{ '--i': i + 1 } as CSSProperties} onClick={() => agent.setDraft((d) => ({ ...d, text: t(k) }))}>
                <span className="flex-1">{t(k)}</span>
                <Icon name="arrowUp" className="size-3.5 rotate-45" />
              </button>
            ))}
          </div>
          <div className="rise mt-6" style={{ '--i': 4 } as CSSProperties}>
            {agent.modelsError || agent.models?.models.length === 0 ? (
              <p className="text-center text-[13px] text-ink-3">{agent.modelsError || t('agent.noModels')}</p>
            ) : (
              <Composer agent={agent} continuing={false} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="task-session">
      <Conversation session={session} onSignIn={onSignIn} />
      <div className="composer-dock">
        <Composer agent={agent} continuing />
      </div>
    </div>
  );
}
