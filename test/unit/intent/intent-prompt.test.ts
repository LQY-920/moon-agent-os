import { describe, it, expect } from 'vitest';
import { INTENT_SYSTEM_PROMPT } from '../../../src/config/intent-prompt';

describe('INTENT_SYSTEM_PROMPT', () => {
  it('contains EXECUTE marker', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('__EXECUTE__');
  });

  it('contains description extraction instruction', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('"description":');
  });

  it('contains rule about not generating code', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('不要生成应用代码');
  });

  it('contains rule about questioning when intent unclear', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('追问');
  });

  it('is a non-empty string', () => {
    expect(typeof INTENT_SYSTEM_PROMPT).toBe('string');
    expect(INTENT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
