import { describe, it, expect } from 'vitest';
import { parseLlmOutput, buildLlmMessages } from '../../../src/modules/intent/services/intent-session.service';

describe('parseLlmOutput', () => {
  it('parses EXECUTE with description', () => {
    const r = parseLlmOutput('好的,开始生成。\n__EXECUTE__\n{ "description": "一个记账 app" }');
    expect(r.isExecutable).toBe(true);
    expect(r.intentDescription).toBe('一个记账 app');
    expect(r.responseText).toBe('好的,开始生成。');
  });

  it('parses EXECUTE without description match', () => {
    const r = parseLlmOutput('好的,开始。\n__EXECUTE__\n{ "desc": "no" }');
    expect(r.isExecutable).toBe(true);
    expect(r.intentDescription).toBeNull();
    expect(r.responseText).toBe('好的,开始。');
  });

  it('returns clarifying when no EXECUTE', () => {
    const r = parseLlmOutput('请问你希望记账频率是每天还是每周?');
    expect(r.isExecutable).toBe(false);
    expect(r.responseText).toBe('请问你希望记账频率是每天还是每周?');
    expect(r.intentDescription).toBeNull();
  });

  it('trims whitespace from responseText', () => {
    const r = parseLlmOutput('  追问内容  ');
    expect(r.responseText).toBe('追问内容');
  });
});

import type { Message } from '../../../src/modules/memory/domain/message';

function makeMsg(role: Message['role'], content: string, createdAt = new Date()): Message {
  return { id: '01', conversationId: 'c1', role, content, createdAt };
}

describe('buildLlmMessages', () => {
  it('starts with system message from prompt', () => {
    const msgs = buildLlmMessages([], 'SYSTEM PROMPT');
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYSTEM PROMPT' });
  });

  it('maps user role to user', () => {
    const history = [makeMsg('user', '我要记账')];
    const msgs = buildLlmMessages(history, 'sys');
    expect(msgs[1]).toEqual({ role: 'user', content: '我要记账' });
  });

  it('maps system role to assistant (AI reply)', () => {
    const history = [makeMsg('system', '请问频率?')];
    const msgs = buildLlmMessages(history, 'sys');
    expect(msgs[1]).toEqual({ role: 'assistant', content: '请问频率?' });
  });

  it('skips ai role', () => {
    const history = [makeMsg('ai', 'ignored')];
    const msgs = buildLlmMessages(history, 'sys');
    expect(msgs.find(m => m.content === 'ignored')).toBeUndefined();
  });

  it('last message is always the most recent user message from history', () => {
    const msgs = buildLlmMessages([makeMsg('user', 'hi'), makeMsg('user', 'current')], 'sys');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'current' });
  });
});
