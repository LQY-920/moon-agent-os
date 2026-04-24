import type { Request, Response } from 'express';
import type { Artifact } from '../../artifact/domain/artifact';

export class WebRuntimeController {
  async renderApp(req: Request, res: Response) {
    const artifact = req.context?.artifact as Artifact | undefined;
    if (!artifact) {
      return res.status(500).send(renderErrorPage('Internal Error', 'artifact not found in context'));
    }

    const payload = artifact.payload as { entryHtml: string } | undefined;
    const entryHtml = payload?.entryHtml;

    if (!entryHtml) {
      return res.status(404).send(renderErrorPage('404', 'Artifact 内容为空'));
    }

    const html = this.buildHtml(artifact.title, entryHtml, artifact.visibility);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  private buildHtml(title: string, entryHtml: string, visibility: string): string {
    const topbar = `<div id="moon-topbar">
  <a href="/" class="back-btn">← 返回平台</a>
  <span class="title">${this.escapeHtml(title)}</span>
  <span class="visibility-badge ${visibility}">${visibility === 'public' ? '🔓 公开' : '🔒 私密'}</span>
</div>`;

    const iframe = `<iframe
  id="app-frame"
  sandbox="allow-scripts allow-same-origin"
  srcdoc="${this.escapeAttribute(entryHtml)}"
></iframe>`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; }
    #moon-topbar {
      display: flex; align-items: center; gap: 16px;
      padding: 12px 20px; background: #1a1a2e; color: #fff;
      position: sticky; top: 0; z-index: 100;
    }
    .back-btn { color: #fff; text-decoration: none; font-size: 14px; }
    .back-btn:hover { text-decoration: underline; }
    .title { flex: 1; font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .visibility-badge { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
    .visibility-badge.public { background: #059669; }
    .visibility-badge.private { background: #6b7280; }
    #app-frame { width: 100vw; height: calc(100vh - 52px); border: none; }
  </style>
</head>
<body>
${topbar}
${iframe}
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttribute(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .error-box { text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin: 0 0 16px; color: #333; }
    p { font-size: 16px; color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
