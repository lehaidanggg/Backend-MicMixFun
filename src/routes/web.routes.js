const express = require('express');
const path = require('path');
const { SERVER_ROOT, DOWNLOADED_SOUNDS_DIR } = require('../config/constants');
const { resolveSoundFile } = require('../services/audio.service');

function registerWebRoutes(app) {
  // Route trang chủ hiển thị Socket Room Demo (Tạo/Join phòng, Chat, Share Audio)
  app.get('/', (req, res) => {
    res.sendFile(path.join(SERVER_ROOT, 'room_demo.html'));
  });
  app.get('/room', (req, res) => {
    res.sendFile(path.join(SERVER_ROOT, 'room_demo.html'));
  });

  // Route Đấu trường nhại giọng online (Mimic Party Game)
  app.get('/mimic', (req, res) => {
    res.sendFile(path.join(SERVER_ROOT, 'mimic_party.html'));
  });
  app.get('/party', (req, res) => {
    res.sendFile(path.join(SERVER_ROOT, 'mimic_party.html'));
  });

  // Route xem Web Studio Catalog
  app.get('/studio', (req, res) => {
    res.sendFile(path.join(SERVER_ROOT, 'index.html'));
  });

  // Phục vụ file tĩnh (tắt index: false để không bị index.html đè trang chủ)
  app.use(express.static(SERVER_ROOT, { index: false }));
  app.use('/sounds', express.static(DOWNLOADED_SOUNDS_DIR));
  app.use('/downloaded_sounds', express.static(DOWNLOADED_SOUNDS_DIR));

  // Fallback tương thích ngược cho cả /sounds/*, /downloaded_sounds/* và /audio/*
  const fallbackSoundHandler = (req, res, next) => {
    const subPath = req.params[0] || req.params.fileName || '';
    const resolved = resolveSoundFile(subPath);
    if (resolved) {
      if (resolved.fullPath) return res.sendFile(resolved.fullPath);
      if (resolved.url) return res.redirect(302, resolved.url);
    }
    next();
  };

  app.get('/sounds/:fileName', fallbackSoundHandler);
  app.get('/downloaded_sounds/:fileName', fallbackSoundHandler);
  app.get('/audio/*', fallbackSoundHandler);
}

module.exports = {
  registerWebRoutes
};
