import { useState } from 'react';
import { api, errorText, type Group, type ToolStatus } from '../api';
import { ToolGlyph } from './ToolGlyph';

const BLURB: Record<ToolStatus['id'], string> = {
  codex: 'OpenAI 分组 · Codex 桌面版和 CLI 共用',
  claude: 'Anthropic 分组 · Claude Code 命令行',
  zcode: '国产模型分组 · OpenAI 兼容协议',
  grok: 'Grok 分组 · Grok Build 命令行',
};

type Phase = 'idle' | 'picking' | 'working' | 'confirm-disconnect';

export function ToolCard({ tool, onChanged }: { tool: ToolStatus; onChanged: (msg: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState('');

  async function run(fn: () => Promise<string>) {
    setPhase('working');
    setError('');
    try {
      onChanged(await fn());
      setPhase('idle');
    } catch (e) {
      setError(errorText(e));
      setPhase('idle');
    }
  }

  async function startConnect() {
    setError('');
    setPhase('working');
    try {
      const gs = await api.groupsFor(tool.id);
      if (gs.length === 0) {
        setError('你的账号下没有能给这个工具用的分组');
        setPhase('idle');
      } else if (gs.length === 1) {
        await connect(gs[0]);
      } else {
        setGroups(gs);
        setPhase('picking');
      }
    } catch (e) {
      setError(errorText(e));
      setPhase('idle');
    }
  }

  function connect(g: Group) {
    return run(async () => {
      await api.connect(tool.id, g.id);
      return `${tool.name} 已连接到「${g.name}」分组，重启 ${tool.name} 后生效`;
    });
  }

  function install() {
    return run(async () => {
      const r = await api.install(tool.id);
      if (r.kind === 'needs_node') return '安装 Codex 需要先装 Node.js，已打开下载页';
      if (r.kind === 'package') return `已下载并打开安装包：${r.path}`;
      return `已在终端里开始安装 ${tool.name}，装完回来点「重新检测」`;
    });
  }

  const status = tool.error
    ? { text: '配置文件有问题', dot: 'bg-warn' }
    : tool.connected
      ? { text: '已连接 Cloudborne', dot: 'bg-ok' }
      : tool.installed
        ? { text: '已安装', dot: 'bg-ink-3' }
        : { text: '未安装', dot: 'bg-ink-3/40' };

  const busy = phase === 'working';

  return (
    <div className="card p-5">
      <div className="flex items-center gap-4">
        <ToolGlyph id={tool.id} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[17px] font-semibold tracking-tight">{tool.name}</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
              <span className={`size-1.5 rounded-full ${status.dot}`} />
              {status.text}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-3">{BLURB[tool.id]}</p>
        </div>

        <div className="flex shrink-0 gap-2">
          {tool.connected ? (
            <>
              <button className="btn btn-quiet" disabled={busy} onClick={startConnect}>
                更新配置
              </button>
              <button className="btn btn-quiet" disabled={busy} onClick={() => setPhase('confirm-disconnect')}>
                断开
              </button>
            </>
          ) : tool.installed || tool.id === 'codex' ? (
            <>
              {!tool.installed && (
                <button className="btn btn-quiet" disabled={busy} onClick={install}>
                  安装 CLI
                </button>
              )}
              <button className="btn btn-primary" disabled={busy || !!tool.error} onClick={startConnect}>
                {busy ? '处理中…' : '连接 Cloudborne'}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={install}>
              {busy ? '处理中…' : '一键安装'}
            </button>
          )}
        </div>
      </div>

      {phase === 'picking' && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2.5 text-[13px] text-ink-2">选择要用的分组：</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button key={g.id} className="btn btn-quiet" onClick={() => connect(g)}>
                {g.name}
                {g.rate_multiplier > 0 && g.rate_multiplier !== 1 && (
                  <span className="text-xs font-normal text-ink-3">×{g.rate_multiplier}</span>
                )}
              </button>
            ))}
            <button className="btn text-ink-3" onClick={() => setPhase('idle')}>
              取消
            </button>
          </div>
        </div>
      )}

      {phase === 'confirm-disconnect' && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <p className="mr-auto text-[13px] text-ink-2">断开后恢复成连接前的配置。要不要同时删除中转站上的专用密钥？</p>
          <button
            className="btn btn-quiet"
            onClick={() => run(async () => (await api.disconnect(tool.id, false), `${tool.name} 已断开`))}
          >
            只断开
          </button>
          <button
            className="btn btn-primary"
            onClick={() => run(async () => (await api.disconnect(tool.id, true), `${tool.name} 已断开，专用密钥已删除`))}
          >
            断开并删除密钥
          </button>
          <button className="btn text-ink-3" onClick={() => setPhase('idle')}>
            取消
          </button>
        </div>
      )}

      {(error || tool.error) && <p className="mt-3 text-[13px] text-[#c2410c]">{error || tool.error}</p>}
    </div>
  );
}
