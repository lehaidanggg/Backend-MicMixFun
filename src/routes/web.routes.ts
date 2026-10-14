import { Express, Request, Response, NextFunction } from 'express';
import { resolveSoundFile } from '../services/audio.service';

export function registerWebRoutes(app: Express): void {
  // Trang chủ tự động điều hướng về trang tài liệu Swagger API Docs
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('/api-docs');
  });

  // Tự động Redirect (302) các đường dẫn cũ /sounds/*, /downloaded_sounds/* và /audio/* sang Cloudflare R2 CDN
  const fallbackSoundHandler = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    let subPath = '';
    try {
      subPath = decodeURIComponent(String(req.path || '').replace(/^\/+/, ''));
    } catch {
      subPath = String(req.path || '').replace(/^\/+/, '');
    }
    if (!subPath) {
      next();
      return;
    }

    const resolved = resolveSoundFile(subPath);
    if (resolved && resolved.url) {
      res.redirect(302, resolved.url);
      return;
    }
    next();
  };

  app.use('/sounds', fallbackSoundHandler);
  app.use('/downloaded_sounds', fallbackSoundHandler);
  app.use('/audio', fallbackSoundHandler);
}
