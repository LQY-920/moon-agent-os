import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InMemoryArtifactSchemaRegistry } from '../../../../src/modules/artifact/registry';
import { InvalidPayloadError } from '../../../../src/modules/artifact/domain/errors';

// 测试专用 kind + schema,不复用 web.schema,保证 registry 机制测试独立
const testKind = 'test-kind';
const testSchema = z.object({ note: z.string().min(1) });

describe('InMemoryArtifactSchemaRegistry', () => {
  it('register + has', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    expect(r.has(testKind)).toBe(false);
    r.register(testKind, testSchema);
    expect(r.has(testKind)).toBe(true);
  });

  it('listKinds returns all registered kinds', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register('a', testSchema);
    r.register('b', testSchema);
    expect(r.listKinds().sort()).toEqual(['a', 'b']);
  });

  it('registering same kind twice throws', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    expect(() => r.register(testKind, testSchema)).toThrow(/already registered/);
  });

  it('validate returns parsed data for valid payload', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    const data = r.validate(testKind, { note: 'hello' });
    expect(data).toEqual({ note: 'hello' });
  });

  it('validate throws InvalidPayloadError for unknown kind', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    expect(() => r.validate('nope', {})).toThrow(InvalidPayloadError);
  });

  it('validate throws InvalidPayloadError for invalid payload and carries details', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    try {
      r.validate(testKind, { note: '' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPayloadError);
      expect((e as InvalidPayloadError).details).toBeDefined();
    }
  });
});