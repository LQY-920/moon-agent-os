import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { LlmClient, LlmResponse } from '../../../src/modules/llm/client';
import { IntentSessionService } from '../../../src/modules/intent/services/intent-session.service';
import { startTestDb } from '../setup';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { ForgeService } from '../../../src/modules/forge/services/forge.service';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { MemoryService as MemoryServiceInterface } from '../../../src/modules/memory/services/memory.service';
import type { LlmClient as LlmClientInterface } from '../../../src/modules/llm/client';

let memoryService: MemoryService;
let cleanup: () => Promise<void>;
let userId: string;
let db: any;

beforeAll(async () => {
  const ctx = await startTestDb();
  cleanup = ctx.destroy;
  db = ctx.db;

  // seed user
  userId = '01K40A8Y3V9E2XBSG5HMTVKQ00';
  await db.insertInto('users').values({
    id: userId,
    email: `intent-test@${userId}.test`,
    email_verified: 0,
    password_hash: 'x',
    display_name: 'Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  memoryService = new MemoryService(conversationRepo, messageRepo, db);
}, 120_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('messages').execute();
  await db.deleteFrom('conversations').execute();
});

// Mock LLM that returns clarification
const clarifyingLlm = (responseText: string): LlmClient => ({
  complete: vi.fn(async () => ({ content: responseText }) as LlmResponse),
});

// Mock LLM that returns executable
const executableLlm = (responseText: string, description: string): LlmClient => ({
  complete: vi.fn(async () => ({
    content: `${responseText}\n__EXECUTE__\n{ "description": "${description}" }`,
  } as LlmResponse)),
});

// Helper to create mock ForgeService
function createMockForgeService(): ForgeService {
  const mockLlm = { complete: vi.fn() } as unknown as LlmClientInterface;
  const mockArtifact = { create: vi.fn().mockResolvedValue({ id: 'test-artifact', title: 'Test' }) } as unknown as ArtifactService;
  const mockMem = { addMessage: vi.fn().mockResolvedValue({}) } as unknown as MemoryServiceInterface;
  const forge = new ForgeService(mockLlm, mockArtifact, mockMem);
  // Mock triggerFromIntent to avoid real LLM/artifact calls in integration tests
  forge.triggerFromIntent = vi.fn().mockResolvedValue(undefined);
  return forge;
}

describe('IntentSessionService integration', () => {
  // Mock feedbackService for tests
  const mockFeedbackService = {
    matchByIntent: vi.fn().mockResolvedValue([]),
    injectIntoPrompt: vi.fn().mockReturnValue(''),
  } as unknown as import('../../../src/modules/feedback/services/feedback.service').FeedbackService;

  it('createSession creates a conversation with intent: title', async () => {
    const service = new IntentSessionService(
      memoryService,
      clarifyingLlm('ok'),
      createMockForgeService(),
      mockFeedbackService,
    );
    const s = await service.createSession(userId);
    expect(s.title).toContain('intent:');
    expect(s.userId).toBe(userId);
  });

  it('sendMessage writes user+AI messages to memory and returns clarifying response', async () => {
    const llm = clarifyingLlm('请问具体是什么功能?');
    const service = new IntentSessionService(memoryService, llm, createMockForgeService(), mockFeedbackService);
    const session = await service.createSession(userId);

    const result = await service.sendMessage(userId, session.id, '我想做个记账 app');

    expect(result.status).toBe('clarifying');
    expect(result.intent).toBeNull();
    expect(result.message).toBe('请问具体是什么功能?');

    // Verify memory has both messages
    const msgs = await memoryService.listMessages(userId, session.id, { limit: 10 });
    expect(msgs.items.map(m => m.role)).toEqual(['user', 'system']);
    expect(msgs.items[0].content).toBe('我想做个记账 app');
    expect(msgs.items[1].content).toBe('请问具体是什么功能?');
  });

  it('sendMessage with executable intent calls forge and returns triggered', async () => {
    const forge = createMockForgeService();
    const triggerSpy = vi.spyOn(forge, 'triggerFromIntent');
    const llm = executableLlm('好的,开始生成。', '记账 app');
    const service = new IntentSessionService(memoryService, llm, forge, mockFeedbackService);
    const session = await service.createSession(userId);

    const result = await service.sendMessage(userId, session.id, '我要一个记账 app');

    expect(result.status).toBe('triggered');
    expect(result.intent).toEqual({ description: '记账 app', form: 'web' });
    expect(triggerSpy).toHaveBeenCalledOnce();
    expect(triggerSpy).toHaveBeenCalledWith(userId, session.id, {
      description: '记账 app',
      form: 'web',
    });
  });
});
