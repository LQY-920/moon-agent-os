import type { ZodTypeAny } from 'zod';
import { InvalidPayloadError } from '../domain/errors';
import type { ArtifactKind } from '../domain/artifact';

export interface ArtifactSchemaRegistry {
  register(kind: ArtifactKind, schema: ZodTypeAny): void;
  has(kind: ArtifactKind): boolean;
  validate(kind: ArtifactKind, payload: unknown): unknown;
  listKinds(): ArtifactKind[];
}

export class InMemoryArtifactSchemaRegistry implements ArtifactSchemaRegistry {
  private readonly schemas = new Map<ArtifactKind, ZodTypeAny>();

  register(kind: ArtifactKind, schema: ZodTypeAny): void {
    if (this.schemas.has(kind)) {
      throw new Error(`kind "${kind}" already registered`);
    }
    this.schemas.set(kind, schema);
  }

  has(kind: ArtifactKind): boolean {
    return this.schemas.has(kind);
  }

  validate(kind: ArtifactKind, payload: unknown): unknown {
    const schema = this.schemas.get(kind);
    if (!schema) {
      throw new InvalidPayloadError(`unknown kind: ${kind}`);
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new InvalidPayloadError('payload schema validation failed', result.error.flatten());
    }
    return result.data;
  }

  listKinds(): ArtifactKind[] {
    return [...this.schemas.keys()];
  }
}