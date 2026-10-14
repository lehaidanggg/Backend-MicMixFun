const express = require('express');
const { DOWNLOADED_SOUNDS_DIR } = require('../config/constants');
const { resolveSoundFile } = require('../services/audio.service');

function registerWebRoutes(app) {
  // Trang chủ tự động điều hướng về trang tài liệu Swagger API Docs
  app.get('/', (req, res) => {
    res.redirect('/api-docs');
  });

  app.use('/sounds', express.static(DOWNLOADED_SOUNDS_DIR));
  app.use('/downloaded_sounds', express.static(DOWNLOADED_SOUNDS_DIR));

  // Fallback tương thích ngược cho cả /sounds/*, /downloaded_sounds/* và /audio/* (Hỗ trợ Express 5 & Redirect R2 CDN)
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
    if (resolved) {
      if (resolved.fullPath) return res.sendFile(resolved.fullPath);
      if (resolved.url) return res.redirect(302, resolved.url);
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
