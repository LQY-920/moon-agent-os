import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ArtifactService } from '../../../../src/modules/artifact/services/artifact.service';
import { InMemoryArtifactSchemaRegistry } from '../../../../src/modules/artifact/registry';
import {
  ArtifactNotFoundError,
  ArtifactForbiddenError,
  InvalidPayloadError,
} from '../../../../src/modules/artifact/domain/errors';
import type { Artifact } from '../../../../src/modules/artifact/domain/artifact';

const testKind = 'test-kind';
const testSchema = z.object({ note: z.string().min(1) });

function makeRegistry(): InMemoryArtifactSchemaRegistry {
  const r = new InMemoryArtifactSchemaRegistry();
  r.register(testKind, testSchema);
  return r;
}

function makeRepoMock() {
  return {
    insert: vi.fn(async () => {}),
    findById: vi.fn(),
    listByUser: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateStatus: vi.fn(async () => {}),
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: '01K40A8Y3V9E2XBSG5HMTVKQ11',
    userId: '01K40A8Y3V9E2XBSG5HMTVKQ22',
    kind: testKind,
    title: 'hi',
    payload: { note: 'hi' },
    status: 'ready',
    origin: 'user_intent',
    parentArtifactId: null,
    createdAt: new Date('2026-04-24T10:00:00.000Z'),
    ...overrides,
  };
}

describe('ArtifactService.create', () => {
  it('validates payload via registry and inserts with defaults', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.create('user1', {
      kind: testKind,
      title: 'my artifact',
      payload: { note: 'hello' },
      origin: 'user_intent',
    });
    expect(repo.insert).toHaveBeenCalledOnce();
    const arg = repo.insert.mock.calls[0][0];
    expect(arg.userId).toBe('user1');
    expect(arg.title).toBe('my artifact');
    expect(arg.status).toBe('ready');
    expect(arg.origin).toBe('user_intent');
    expect(arg.parentArtifactId).toBeNull();
    expect(arg.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(r.userId).toBe('user1');
    expect(r.status).toBe('ready');
  });

  it('throws InvalidPayloadError when payload fails validation; insert is NOT called', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: testKind,
      title: 'x',
      payload: { note: '' },
      origin: 'user_intent',
    })).rejects.toBeInstanceOf(InvalidPayloadError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('throws InvalidPayloadError for unknown kind', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: 'never-registered',
      title: 'x',
      payload: {},
      origin: 'user_intent',
    })).rejects.toBeInstanceOf(InvalidPayloadError);
  });

  it('with parentArtifactId: checks parent exists; fails when missing', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: testKind,
      title: 'x',
      payload: { note: 'hi' },
      origin: 'iteration',
      parentArtifactId: '01K40A8Y3V9E2XBSG5HMTVKQZZ',
    })).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('with parentArtifactId pointing to ANOTHER user: does NOT throw (fork is allowed)', async () => {
    const repo = makeRepoMock();
    const parent = makeArtifact({ userId: 'someone-else' });
    repo.findById.mockResolvedValueOnce(parent);
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.create('user1', {
      kind: testKind,
      title: 'fork of something',
      payload: { note: 'hi' },
      origin: 'fork',
      parentArtifactId: parent.id,
    });
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(r.userId).toBe('user1');
    expect(r.parentArtifactId).toBe(parent.id);
  });
});

describe('ArtifactService.getById', () => {
  it('returns when owned by user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.getById('user1', a.id);
    expect(r.id).toBe(a.id);
  });

  it('throws ArtifactNotFoundError when id unknown', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.getById('user1', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('throws ArtifactForbiddenError when owned by another user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'other' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.getById('user1', a.id)).rejects.toBeInstanceOf(ArtifactForbiddenError);
  });
});

describe('ArtifactService.listByUser', () => {
  it('defaults status to ready when not provided', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 20 });
    expect(repo.listByUser).toHaveBeenCalledWith('user1', {
      limit: 20,
      cursor: undefined,
      kind: undefined,
      status: 'ready',
    });
  });

  it('passes explicit status through (allow querying retired)', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 20, status: 'retired' });
    expect(repo.listByUser.mock.calls[0][1].status).toBe('retired');
  });

  it('passes kind + cursor through', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 10, kind: 'web', cursor: 'abc' });
    expect(repo.listByUser.mock.calls[0][1]).toMatchObject({
      limit: 10, kind: 'web', cursor: 'abc', status: 'ready',
    });
  });
});

describe('ArtifactService.retire', () => {
  it('retires when owned and currently ready', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1', status: 'ready' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.retire('user1', a.id);
    expect(repo.updateStatus).toHaveBeenCalledWith(a.id, 'retired');
  });

  it('is idempotent when already retired (does NOT call updateStatus)', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1', status: 'retired' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.retire('user1', a.id);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('throws ArtifactForbiddenError when owned by another user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'other', status: 'ready' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.retire('user1', a.id)).rejects.toBeInstanceOf(ArtifactForbiddenError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('throws ArtifactNotFoundError when id unknown', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.retire('user1', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
