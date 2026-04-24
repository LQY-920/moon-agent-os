// test/unit/forge/forge.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgeService } from '../../../src/modules/forge/services/forge.service';
import type { LlmClient } from '../../../src/modules/llm/client';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { MemoryService } from '../../../src/modules/memory/services/memory.service';

describe('ForgeService', () => {
  let forge: ForgeService;
  let mockLlm: LlmClient;
  let mockArtifact: ArtifactService;
  let mockMemory: MemoryService;

  beforeEach(() => {
    mockLlm = { complete: vi.fn() };
    mockArtifact = {
      create: vi.fn().mockResolvedValue({
        id: 'artifact-123',
        title: 'Web App: 测试应用',
      }),
    } as unknown as ArtifactService;
    mockMemory = {
      addMessage: vi.fn().mockResolvedValue({}),
    } as unknown as MemoryService;
    forge = new ForgeService(mockLlm, mockArtifact, mockMemory);
  });

  it('calls LLM with web prompt', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '一个测试应用',
      form: 'web',
    });

    expect(mockLlm.complete).toHaveBeenCalled();
    const callArgs = (mockLlm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs[0].role).toBe('system');
    expect(callArgs[1].role).toBe('user');
    expect(callArgs[1].content).toBe('一个测试应用');
  });

  it('creates artifact with correct input', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '一个记账 app',
      form: 'web',
    });

    expect(mockArtifact.create).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({
        kind: 'web',
        title: 'Web App: 一个记账 app',
        payload: expect.objectContaining({
          entryHtml: '<html>test</html>',
          assets: {},
          metadata: expect.objectContaining({
            generatedBy: 'forge-m2',
          }),
        }),
        origin: 'user_intent',
      }),
    );
  });

  it('writes completion message to memory', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '测试',
      form: 'web',
    });

    expect(mockMemory.addMessage).toHaveBeenCalledWith(
      'user1',
      'session1',
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('产物已生成'),
      }),
    );
  });

  it('truncates title at 50 chars', async () => {
    const longDesc = '这是一个非常非常非常非常非常非常非常非常非常非常长的描述';
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: longDesc,
      form: 'web',
    });

    expect(mockArtifact.create).toHaveBeenCalledWith('user1', expect.objectContaining({
      title: `Web App: ${longDesc.substring(0, 50)}`,
    }));
  });

  it('throws ForgeGenerationError on invalid LLM response', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({ content: 'not json' });

    await expect(
      forge.triggerFromIntent('user1', 'session1', {
        description: 'test',
        form: 'web',
      }),
    ).rejects.toThrow('LLM 响应格式错误');
  });

  it('does not create artifact when LLM response invalid', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({ content: 'invalid' });

    try {
      await forge.triggerFromIntent('user1', 'session1', {
        description: 'test',
        form: 'web',
      });
    } catch { /* ignore */ }

    expect(mockArtifact.create).not.toHaveBeenCalled();
  });
});
