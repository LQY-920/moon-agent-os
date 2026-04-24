// test/unit/intent/intent-session.service.iterate.test.ts

import { describe, it, expect } from 'vitest';
import { detectIterateMode, ITERATE_KEYWORDS } from '../../../src/modules/intent/services/intent-session.service';

describe('detectIterateMode', () => {
  it('returns true for iterate keywords', () => {
    const iterateMessages = [
      '再做一个记账 app',
      '改进一下这个页面',
      '重新生成',
      '再试一次',
      '再来一次记账应用',
      'improve this',
      'retry',
    ];
    iterateMessages.forEach(msg => {
      expect(detectIterateMode(msg)).toBe(true);
    });
  });

  it('returns false for non-iterate messages', () => {
    const normalMessages = [
      '我想要一个记账 app',
      '帮我做一个预算工具',
      '做一个待办事项管理',
    ];
    normalMessages.forEach(msg => {
      expect(detectIterateMode(msg)).toBe(false);
    });
  });

  it('is case insensitive', () => {
    expect(detectIterateMode('IMPROVE')).toBe(true);
    expect(detectIterateMode('RETRY')).toBe(true);
    expect(detectIterateMode('Regenerate')).toBe(true);
  });
});

describe('ITERATE_KEYWORDS', () => {
  it('contains expected keywords', () => {
    expect(ITERATE_KEYWORDS).toContain('改进');
    expect(ITERATE_KEYWORDS).toContain('重新生成');
    expect(ITERATE_KEYWORDS).toContain('再来一次');
    expect(ITERATE_KEYWORDS).toContain('再试一次');
    expect(ITERATE_KEYWORDS).toContain('improve');
    expect(ITERATE_KEYWORDS).toContain('retry');
  });
});