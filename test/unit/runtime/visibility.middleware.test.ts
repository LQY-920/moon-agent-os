import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createVisibilityMiddleware } from '../../../src/core/middleware/artifact-visibility.middleware';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { SessionService } from '../../../src/modules/identity/services/session.service';
import { ArtifactNotFoundError } from '../../../src/modules/artifact/domain/errors';

describe('createVisibilityMiddleware', () => {
  function createMiddleware(artifactService: ArtifactService, sessionService: SessionService) {
    return createVisibilityMiddleware(artifactService, sessionService, 'mao_sess');
  }

  let middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  let mockArtifactService: ArtifactService;
  let mockSessionService: SessionService;
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    mockArtifactService = {
      getForRuntime: vi.fn(),
    } as unknown as ArtifactService;
    mockSessionService = {
      getUserId: vi.fn(),
    } as unknown as SessionService;

    middleware = createMiddleware(mockArtifactService, mockSessionService);

    req = { params: { artifactId: 'artifact-123' }, context: {} } as unknown as Request;
    res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    } as unknown as Response;
    next = vi.fn();
  });

  it('calls next() for public artifact without session', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'public',
      userId: 'user-1',
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.artifact).toBeDefined();
  });

  it('calls next() for private artifact when user is owner', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue('user-1');

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('redirects to /login for private artifact without session', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 for private artifact when user is not owner', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue('user-2');

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact not found', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockRejectedValue(
      new ArtifactNotFoundError(),
    );

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
  });
});
