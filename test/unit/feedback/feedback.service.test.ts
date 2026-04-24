// test/unit/feedback/feedback.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService } from '../../../src/modules/feedback/services/feedback.service';
import type { FeedbackRepository } from '../../../src/modules/feedback/repositories/feedback.repository';
import type { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { FeedbackNotFoundError, FeedbackForbiddenError } from '../../../src/modules/feedback/domain/errors';

describe('FeedbackService', () => {
  let feedbackService: FeedbackService;
  let mockFeedbackRepo: FeedbackRepository;
  let mockArtifactRepo: ArtifactRepository;

  beforeEach(() => {
    mockFeedbackRepo = {
      insert: vi.fn(),
      listByArtifact: vi.fn(),
      listByUserAndIntentKeyword: vi.fn(),
    } as unknown as FeedbackRepository;

    mockArtifactRepo = {
      findById: vi.fn(),
    } as unknown as ArtifactRepository;

    feedbackService = new FeedbackService(mockFeedbackRepo, mockArtifactRepo);
  });

  describe('create', () => {
    it('throws FeedbackNotFoundError when artifact does not exist', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        feedbackService.create('user1', 'artifact1', 'function_bug', null),
      ).rejects.toThrow(FeedbackNotFoundError);
    });

    it('throws FeedbackForbiddenError when user is not owner', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue({
        id: 'artifact1', userId: 'user2', kind: 'web', title: 'Test',
        payload: {}, status: 'ready' as const, origin: 'user_intent' as const,
        parentArtifactId: null, createdAt: new Date(), visibility: 'private' as const,
      });

      await expect(
        feedbackService.create('user1', 'artifact1', 'function_bug', null),
      ).rejects.toThrow(FeedbackForbiddenError);
    });

    it('calls feedbackRepo.insert when authorized', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue({
        id: 'artifact1', userId: 'user1', kind: 'web', title: 'Test',
        payload: {}, status: 'ready' as const, origin: 'user_intent' as const,
        parentArtifactId: null, createdAt: new Date(), visibility: 'private' as const,
      });
      mockFeedbackRepo.insert = vi.fn().mockResolvedValue(undefined);

      await feedbackService.create('user1', 'artifact1', 'function_bug', '按钮不工作');

      expect(mockFeedbackRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: 'artifact1',
          userId: 'user1',
          label: 'function_bug',
          comment: '按钮不工作',
        }),
      );
    });
  });

  describe('injectIntoPrompt', () => {
    it('returns empty string for empty array', () => {
      const result = feedbackService.injectIntoPrompt([]);
      expect(result).toBe('');
    });

    it('returns formatted [HISTORICAL_FEEDBACK] block', () => {
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Web App: 记账',
        label: 'function_bug' as const,
        comment: '按钮不工作',
        createdAt: new Date('2026-04-24'),
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);

      expect(result).toContain('[HISTORICAL_FEEDBACK]');
      expect(result).toContain('Web App: 记账');
      expect(result).toContain('function_bug');
      expect(result).toContain('按钮不工作');
      expect(result).toContain('[/HISTORICAL_FEEDBACK]');
    });

    it('shows "今天" for today feedback', () => {
      const today = new Date();
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Test',
        label: 'ui_issue' as const,
        comment: null,
        createdAt: today,
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);
      expect(result).toContain('今天');
    });

    it('shows "N天前" for older feedback', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Test',
        label: 'ui_issue' as const,
        comment: null,
        createdAt: twoDaysAgo,
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);
      expect(result).toContain('2天前');
    });
  });
});