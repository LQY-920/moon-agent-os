// test/unit/forge/web.generator.test.ts

import { describe, it, expect } from 'vitest';
import { buildWebPrompt, parseWebResponse } from '../../../src/modules/forge/generators/web.generator';
import { FORGE_WEB_SYSTEM_PROMPT } from '../../../src/config/forge-prompt';

describe('buildWebPrompt', () => {
  it('returns system + user messages', () => {
    const msgs = buildWebPrompt('我要一个记账 app');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('system message contains FORGE_WEB_SYSTEM_PROMPT', () => {
    const msgs = buildWebPrompt('test');
    expect(msgs[0].content).toBe(FORGE_WEB_SYSTEM_PROMPT);
  });

  it('user message contains description', () => {
    const desc = '我要一个记账 app';
    const msgs = buildWebPrompt(desc);
    expect(msgs[1].content).toBe(desc);
  });
});

describe('parseWebResponse', () => {
  it('parses valid JSON with entryHtml', () => {
    const content = JSON.stringify({
      entryHtml: '<html><body>Hello</body></html>',
      assets: { style: 'body { color: red; }' },
    });
    const result = parseWebResponse(content);
    expect(result.entryHtml).toBe('<html><body>Hello</body></html>');
    expect(result.assets).toEqual({ style: 'body { color: red; }' });
  });

  it('handles extra text before JSON', () => {
    const content = '好的，这是生成的代码：\n' + JSON.stringify({
      entryHtml: '<html>test</html>',
      assets: {},
    });
    const result = parseWebResponse(content);
    expect(result.entryHtml).toBe('<html>test</html>');
  });

  it('throws when no valid JSON found', () => {
    expect(() => parseWebResponse('这不是 JSON')).toThrow();
  });

  it('defaults assets to empty object if missing', () => {
    const content = JSON.stringify({ entryHtml: '<html>test</html>' });
    const result = parseWebResponse(content);
    expect(result.assets).toEqual({});
  });
});
