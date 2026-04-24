import { ulid } from 'ulid';
import type {
  Artifact, ArtifactKind, ArtifactOrigin, ArtifactStatus, ArtifactVisibility,
} from '../domain/artifact';
import {
  ArtifactNotFoundError,
  ArtifactForbiddenError,
} from '../domain/errors';
import type { ArtifactRepository } from '../repositories/artifact.repository';
import type { ArtifactSchemaRegistry } from '../registry';

export type CreateArtifactInput = {
  kind: ArtifactKind;
  title: string;
  payload: unknown;
  origin: ArtifactOrigin;
  parentArtifactId?: string | null;
};

export type ListArtifactsOptions = {
  limit: number;
  cursor?: string | null;
  kind?: ArtifactKind;
  status?: ArtifactStatus;
};

export class ArtifactService {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly registry: ArtifactSchemaRegistry,
  ) {}

  async create(userId: string, input: CreateArtifactInput): Promise<Artifact> {
    // 1. registry validate;失败抛 InvalidPayloadError
    this.registry.validate(input.kind, input.payload);

    // 2. parent 存在性(不查归属,fork 场景允许跨用户)
    const parentArtifactId = input.parentArtifactId ?? null;
    if (parentArtifactId !== null) {
      const parent = await this.artifacts.findById(parentArtifactId);
      if (!parent) throw new ArtifactNotFoundError();
    }

    // 3. insert
    const id = ulid();
    const now = new Date();
    const status: ArtifactStatus = 'ready';
    await this.artifacts.insert({
      id,
      userId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      status,
      origin: input.origin,
      parentArtifactId,
      now,
    });

    return {
      id,
      userId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      status,
      origin: input.origin,
      parentArtifactId,
      createdAt: now,
      visibility: 'private',
    };
  }

  async updateVisibility(
    userId: string,
    artifactId: string,
    visibility: ArtifactVisibility,
  ): Promise<Artifact> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new ArtifactNotFoundError();
    if (artifact.userId !== userId) throw new ArtifactForbiddenError();

    await this.artifacts.updateVisibility(artifactId, visibility);
    return this.artifacts.findById(artifactId);
  }

  async getForRuntime(artifactId: string): Promise<Artifact> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new ArtifactNotFoundError();
    return artifact;
  }

  async getById(userId: string, id: string): Promise<Artifact> {
    const a = await this.artifacts.findById(id);
    if (!a) throw new ArtifactNotFoundError();
    if (a.userId !== userId) throw new ArtifactForbiddenError();
    return a;
  }

  async listByUser(userId: string, opts: ListArtifactsOptions): Promise<{ items: Artifact[]; nextCursor: string | null }> {
    // status 默认只查 ready(见 spec § 6)
    return this.artifacts.listByUser(userId, {
      limit: opts.limit,
      cursor: opts.cursor,
      kind: opts.kind,
      status: opts.status ?? 'ready',
    });
  }

  async retire(userId: string, id: string): Promise<void> {
    const a = await this.getById(userId, id);           // 复用归属校验
    if (a.status === 'retired') return;                  // 幂等
    await this.artifacts.updateStatus(id, 'retired');
  }
}
