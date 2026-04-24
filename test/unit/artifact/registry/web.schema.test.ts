import { describe, it, expect } from 'vitest';
import { WebArtifactPayload } from '../../../../src/modules/artifact/registry/web.schema';

describe('WebArtifactPayload', () => {
  it('accepts a minimal payload', () => {
    const ok = WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      metadata: {
        generatedBy: 'forge-pipeline-v1',
        generatedAt: '2026-04-24T10:00:00.000Z',
      },
    });
    expect(ok.entryHtml).toBe('<html></html>');
    expect(ok.assets).toBeUndefined();
  });

  it('accepts payload with assets', () => {
    const ok = WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      assets: { 'style.css': 'body{}' },
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    });
    expect(ok.assets?.['style.css']).toBe('body{}');
  });

  it('rejects missing entryHtml', () => {
    expect(() => WebArtifactPayload.parse({
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    })).toThrow();
  });

  it('rejects empty entryHtml', () => {
    expect(() => WebArtifactPayload.parse({
      entryHtml: '',
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    })).toThrow();
  });

  it('rejects non-ISO metadata.generatedAt', () => {
    expect(() => WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      metadata: { generatedBy: 'x', generatedAt: 'not-a-date' },
    })).toThrow();
  });
});
