const { resolveSoundFile } = require('../services/audio.service');

function registerWebRoutes(app) {
  // Trang chủ tự động điều hướng về trang tài liệu Swagger API Docs
  app.get('/', (req, res) => {
    res.redirect('/api-docs');
  });

  // Tự động Redirect (302) các đường dẫn cũ /sounds/*, /downloaded_sounds/* và /audio/* sang Cloudflare R2 CDN
  const fallbackSoundHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let subPath = '';
    try {
      subPath = decodeURIComponent(String(req.path || '').replace(/^\/+/, ''));
    } catch (e) {
      subPath = String(req.path || '').replace(/^\/+/, '');
    }
    if (!subPath) return next();

    const resolved = resolveSoundFile(subPath);
    if (resolved && resolved.url) {
      return res.redirect(302, resolved.url);
    }
    next();
  };

  app.use('/sounds', fallbackSoundHandler);
  app.use('/downloaded_sounds', fallbackSoundHandler);
  app.use('/audio', fallbackSoundHandler);
}

module.exports = {
  registerWebRoutes
};
