import { ulid } from 'ulid';
import type {
  Artifact, ArtifactKind, ArtifactOrigin, ArtifactStatus,
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
    };
  }

  // getById / listByUser / retire 下一 Task 加
}
