import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { FeedbackRepository } from '../../../src/modules/feedback/repositories/feedback.repository';
import { FeedbackService } from '../../../src/modules/feedback/services/feedback.service';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let feedbackService: FeedbackService;
let feedbackRepo: FeedbackRepository;
let artifactRepo: ArtifactRepository;
let userId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  artifactRepo = new ArtifactRepository(db);
  feedbackRepo = new FeedbackRepository(db);
  feedbackService = new FeedbackService(feedbackRepo, artifactRepo);

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `feedback-int-${userId}@test.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Feedback Int Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('feedbacks').execute();
  await db.deleteFrom('artifacts').where('user_id', '=', userId).execute();
});

describe('FeedbackService integration', () => {
  it('create -> writes to feedbacks table', async () => {
    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: userId,
      kind: 'web',
      title: 'Web App: 记账应用',
      payload: JSON.stringify({ entryHtml: '<h1>记账</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await feedbackService.create(userId, artifactId, 'function_bug', '按钮点击无反应');

    const rows = await db.selectFrom('feedbacks').selectAll().where('artifact_id', '=', artifactId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('function_bug');
    expect(rows[0].comment).toBe('按钮点击无反应');
  });

  it('matchByIntent finds feedback by artifact title keyword', async () => {
    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: userId,
      kind: 'web',
      title: 'Web App: 记账应用',
      payload: JSON.stringify({ entryHtml: '<h1>记账</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await feedbackService.create(userId, artifactId, 'ui_issue', null);

    // '记账' will be used as keyword (first 10 chars after stripping)
    const feedbacks = await feedbackService.matchByIntent(userId, '记账', 5);

    expect(feedbacks.length).toBeGreaterThan(0);
    expect(feedbacks[0].artifactTitle).toContain('记账');
    expect(feedbacks[0].label).toBe('ui_issue');
  });

  it('matchByIntent limits to 5 results', async () => {
    for (let i = 0; i < 6; i++) {
      const aid = ulid();
      await db.insertInto('artifacts').values({
        id: aid,
        user_id: userId,
        kind: 'web',
        title: `Web App: 测试应用${i}`,
        payload: JSON.stringify({ entryHtml: '<h1>测试</h1>' }),
        status: 'ready',
        origin: 'user_intent',
        visibility: 'private',
        created_at: new Date(),
      }).execute();
      await feedbackService.create(userId, aid, 'function_bug', null);
    }

    const feedbacks = await feedbackService.matchByIntent(userId, '测试', 5);
    expect(feedbacks.length).toBe(5);
  });

  it('listByArtifactForOwner rejects non-owner', async () => {
    const otherUserId = ulid();
    await db.insertInto('users').values({
      id: otherUserId,
      email: `other-${otherUserId}@test.com`,
      email_verified: 0,
      password_hash: 'irrelevant',
      display_name: 'Other User',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: otherUserId,
      kind: 'web',
      title: 'Other user artifact',
      payload: JSON.stringify({ entryHtml: '<h1>Other</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await expect(
      feedbackService.listByArtifactForOwner(userId, artifactId),
    ).rejects.toThrow('无权对该产物提交反馈');
  });
});
