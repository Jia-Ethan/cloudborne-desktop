import { describe, expect, it } from 'vitest';
import { applyEvent, type AgentItem, type Turn } from './agent';

const turn = (items: AgentItem[] = []): Turn => ({ prompt: 'p', images: [], items, status: 'running' });

describe('applyEvent', () => {
  it('streams deltas into an item, creating it when the delta arrives first', () => {
    let t = turn();
    t = applyEvent(t, { type: 'delta', id: 'r1', item_type: 'reasoning', field: 'text', text: '**Checking**' });
    t = applyEvent(t, { type: 'delta', id: 'r1', item_type: 'reasoning', field: 'text', text: ' the config' });
    expect(t.items).toEqual([{ id: 'r1', type: 'reasoning', status: 'in_progress', text: '**Checking** the config' }]);

    // The completed item replaces the streamed one.
    t = applyEvent(t, { type: 'item', item: { id: 'r1', type: 'reasoning', text: '**Checking** the config.', status: 'completed', duration_ms: 2100 } });
    expect(t.items).toEqual([{ id: 'r1', type: 'reasoning', text: '**Checking** the config.', status: 'completed', duration_ms: 2100 }]);
  });

  it('appends command output to the matching command only', () => {
    const cmd: AgentItem = { id: 'c1', type: 'command_execution', command: 'ls', aggregated_output: 'a\n', exit_code: null, status: 'in_progress' };
    const msg: AgentItem = { id: 'm1', type: 'agent_message', text: 'hi' };
    const t = applyEvent(turn([cmd, msg]), { type: 'delta', id: 'c1', item_type: 'command_execution', field: 'aggregated_output', text: 'b\n' });
    expect(t.items[0]).toMatchObject({ aggregated_output: 'a\nb\n' });
    expect(t.items[1]).toBe(msg);
  });

  it('updates a question in place when it is answered', () => {
    const ask: AgentItem = { id: 'q', type: 'question', request: '3', questions: [{ id: 'dir', header: 'Project', question: 'Which?' }], status: 'pending' };
    const t = applyEvent(turn([ask]), { type: 'item', item: { ...ask, status: 'answered', answers: { dir: ['A'] } } });
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ status: 'answered', answers: { dir: ['A'] } });
  });
});
