import { ulid } from 'ulid';
import type { FeedbackRepository } from '../repositories/feedback.repository';
import type { ArtifactRepository } from '../../artifact/repositories/artifact.repository';
import type { HistoricalFeedback, FeedbackLabel } from '../domain/feedback';
import { FeedbackNotFoundError, FeedbackForbiddenError } from '../domain/errors';
import { ITERATE_KEYWORDS } from '../../intent/services/intent-session.service';

export class FeedbackService {
  constructor(
    private readonly feedbackRepo: FeedbackRepository,
    private readonly artifactRepo: ArtifactRepository,
  ) {}

  async create(
    userId: string,
    artifactId: string,
    label: FeedbackLabel,
    comment: string | null,
  ): Promise<void> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) throw new FeedbackNotFoundError(artifactId);
    if (artifact.userId !== userId) throw new FeedbackForbiddenError();

    const id = ulid();
    const now = new Date();
    await this.feedbackRepo.insert({ id, artifactId, userId, label, comment, now });
  }

  async listByArtifact(artifactId: string): Promise<HistoricalFeedback[]> {
    const artifact = await this.artifactRepo.findById(artifactId);
    const rows = await this.feedbackRepo.listByArtifact(artifactId);
    return rows.map(r => ({
      artifactId: r.artifact_id,
      artifactTitle: artifact?.title ?? '',
      label: r.label as FeedbackLabel,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  async listByArtifactForOwner(userId: string, artifactId: string): Promise<HistoricalFeedback[]> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) throw new FeedbackNotFoundError(artifactId);
    if (artifact.userId !== userId) throw new FeedbackForbiddenError();
    return this.listByArtifact(artifactId);
  }

  async matchByIntent(userId: string, description: string, limit = 5): Promise<HistoricalFeedback[]> {
    // 关键词提取：剥离 ITERATE_KEYWORDS 后取前 10 字符
    let stripped = description;
    for (const kw of ITERATE_KEYWORDS) {
      stripped = stripped.replace(new RegExp(kw, 'gi'), '');
    }
    stripped = stripped.trim();
    const keyword = stripped.substring(0, 10);
    if (keyword.trim().length === 0) return [];

    const rows = await this.feedbackRepo.listByUserAndIntentKeyword(userId, keyword, limit);
    return rows.map(r => ({
      artifactId: r.artifact_id,
      artifactTitle: r.artifact_title,
      label: r.label as FeedbackLabel,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  injectIntoPrompt(feedbacks: HistoricalFeedback[]): string {
    if (feedbacks.length === 0) return '';
    const blocks = feedbacks.map(f => {
      const daysAgo = Math.floor((Date.now() - f.createdAt.getTime()) / 86400000);
      const timeStr = daysAgo === 0 ? '今天' : `${daysAgo}天前`;
      return `- artifact: "${f.artifactTitle}"（${timeStr}）
  labels: ${f.label}${f.comment ? `, comment: "${f.comment}"` : ''}`;
    }).join('\n');
    return `[HISTORICAL_FEEDBACK]\n${blocks}\n[/HISTORICAL_FEEDBACK]\n\n`;
  }
}
