import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRuntimeController } from '../../../src/modules/runtime/controllers/web-runtime.controller';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';

describe('WebRuntimeController', () => {
  let controller: WebRuntimeController;
  let mockArtifactService: ArtifactService;
  let req: any;
  let res: any;

  beforeEach(() => {
    mockArtifactService = {} as ArtifactService;
    controller = new WebRuntimeController(mockArtifactService);

    req = { context: {} };
    res = {
      setHeader: vi.fn(),
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
  });

  describe('buildHtml', () => {
    it('generates valid HTML with topbar and iframe', () => {
      const html = (controller as any).buildHtml('Test App', '<h1>Hello</h1>', 'private');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('id="moon-topbar"');
      expect(html).toContain('id="app-frame"');
      expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
      expect(html).toContain('srcdoc=');
      expect(html).toContain('🔒 私密');
    });

    it('escapes title to prevent XSS', () => {
      const html = (controller as any).buildHtml('<script>alert(1)</script>', '<h1>Test</h1>', 'public');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes entryHtml in srcdoc attribute', () => {
      const maliciousHtml = '<script>alert("xss")</script>';
      const html = (controller as any).buildHtml('Test', maliciousHtml, 'private');

      expect(html).not.toContain('srcdoc="' + maliciousHtml + '"');
    });

    it('shows public badge for public visibility', () => {
      const html = (controller as any).buildHtml('Test', '<h1>Test</h1>', 'public');

      expect(html).toContain('🔓 公开');
      expect(html).toContain('visibility-badge public');
    });

    it('shows private badge for private visibility', () => {
      const html = (controller as any).buildHtml('Test', '<h1>Test</h1>', 'private');

      expect(html).toContain('🔒 私密');
      expect(html).toContain('visibility-badge private');
    });
  });

  describe('renderApp', () => {
    it('renders artifact entryHtml in iframe', async () => {
      req.context.artifact = {
        id: 'artifact-123',
        title: 'Test App',
        visibility: 'public',
        payload: { entryHtml: '<h1>Hello World</h1>' },
        userId: 'user-1',
      };

      await controller.renderApp(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.send).toHaveBeenCalled();
      const sentHtml = (res.send as any).mock.calls[0][0];
      // entryHtml is escaped in srcdoc attribute
      expect(sentHtml).toContain('srcdoc="&lt;h1&gt;Hello World&lt;/h1&gt;"');
      expect(sentHtml).toContain('<iframe');
      expect(sentHtml).toContain('sandbox="allow-scripts allow-same-origin"');
    });

    it('returns 500 when artifact not in context', async () => {
      req.context = {};

      await controller.renderApp(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 404 when entryHtml is empty', async () => {
      req.context.artifact = {
        id: 'artifact-123',
        title: 'Test App',
        visibility: 'public',
        payload: { entryHtml: '' },
        userId: 'user-1',
      };

      await controller.renderApp(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
