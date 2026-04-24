// test/integration/forge/forge.service.int.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { InMemoryArtifactSchemaRegistry } from '../../../src/modules/artifact/registry';
import { WebArtifactPayload } from '../../../src/modules/artifact/registry/web.schema';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { ForgeService } from '../../../src/modules/forge/services/forge.service';
import type { LlmClient } from '../../../src/modules/llm/client';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let forge: ForgeService;
let artifactService: ArtifactService;
let memoryService: MemoryService;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `forge-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Forge Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  memoryService = new MemoryService(conversationRepo, messageRepo, db);

  const registry = new InMemoryArtifactSchemaRegistry();
  registry.register('web', WebArtifactPayload);
  const artifactRepo = new ArtifactRepository(db);
  artifactService = new ArtifactService(artifactRepo, registry);

  const mockLlm: LlmClient = {
    complete: async () => ({
      content: JSON.stringify({
        entryHtml: '<html><body><h1>测试应用</h1><p>这是一个测试页面</p></body></html>',
        assets: {},
      }),
    }),
  };

  forge = new ForgeService(mockLlm, artifactService, memoryService);
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('artifacts').where('user_id', '=', userId).execute();
  await db.deleteFrom('messages').where('conversation_id', 'in',
    db.selectFrom('conversations').select('id').where('user_id', '=', userId)
  ).execute();
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('artifacts').where('user_id', '=', userId).execute();
  await db.deleteFrom('messages').execute();
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
});

describe('ForgeService integration', () => {
  it('complete flow: generate → artifact → memory', async () => {
    // 1. 创建会话
    const conv = await memoryService.createConversation(userId, { title: 'forge-test' });

    // 2. 触发生成
    await forge.triggerFromIntent(userId, conv.id, {
      description: '一个测试应用',
      form: 'web',
    });

    // 3. 验证 artifact 已创建
    const artifacts = await artifactService.listByUser(userId, { limit: 10 });
    expect(artifacts.items.length).toBeGreaterThan(0);
    const artifact = artifacts.items[0];
    expect(artifact.kind).toBe('web');
    expect(artifact.origin).toBe('user_intent');
    expect(artifact.title).toBe('Web App: 一个测试应用');

    // 4. 验证记忆已写入
    const messages = await memoryService.listMessages(userId, conv.id, { limit: 10 });
    const lastMessage = messages.items[messages.items.length - 1];
    expect(lastMessage.role).toBe('system');
    expect(lastMessage.content).toContain('产物已生成');
    expect(lastMessage.content).toContain(artifact.id);
  });

  it('title truncates at 50 characters', async () => {
    const conv = await memoryService.createConversation(userId, { title: 'truncate-test' });
    const longDesc = '这是一个非常非常非常非常非常非常非常非常非常非常长的描述，超过50字符';

    await forge.triggerFromIntent(userId, conv.id, {
      description: longDesc,
      form: 'web',
    });

    const artifacts = await artifactService.listByUser(userId, { limit: 10 });
    const latest = artifacts.items.find(a => a.title.includes('Web App:'));
    expect(latest!.title).toHaveLength(`Web App: ${longDesc.substring(0, 50)}`.length);
  });
});