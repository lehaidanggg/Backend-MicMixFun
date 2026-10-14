const fs = require('fs');
const path = require('path');
const { MAX_MEMBERS_PER_ROOM } = require('../config/constants');
const { GAME_STATES, STATE_LABELS, SOUND_PACKS } = require('../game/soundPacks');
const { getAllDownloadedSounds } = require('../services/audio.service');
const { rooms, gameSessions } = require('../services/room.service');
const {
  sanitizeUserName,
  extractClientIp,
  computeClientFingerprint,
  createAuthChallenge,
  verifyAppChallenge,
  verifyFirebaseIdToken,
  generateSecureUserId,
  issueAuthToken,
  verifyAuthToken
} = require('../services/auth.service');
const { buildOpenApiSpec, renderSwaggerHtml } = require('../config/swagger');

function registerApiRoutes(app, io) {
  // Swagger / OpenAPI 3.0 Documentation
  const resolveServerUrl = (req) => {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000').split(',')[0].trim();
    return `${proto}://${host}`;
  };

  app.get('/api-docs.json', (req, res) => {
    res.json(buildOpenApiSpec(resolveServerUrl(req)));
  });

  app.get(['/api-docs', '/docs', '/api/docs'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderSwaggerHtml(buildOpenApiSpec(resolveServerUrl(req))));
  });

  // 0. Phát hành One-Time Challenge Nonce (Chống Server Trung Gian / Replay Attack)
  app.get('/api/auth/challenge', (req, res) => {
    const clientIp = extractClientIp(req);
    const challenge = createAuthChallenge(clientIp);
    res.json({
      success: true,
      nonce: challenge.nonce,
      timestamp: Date.now(),
      expiresInMs: challenge.expiresInMs
    });
  });

  // 1. Xác thực qua Firebase Anonymous Authentication (Đổi Firebase ID Token lấy Session Token gắn Fingerprint)
  app.post('/api/auth/firebase', async (req, res) => {
    try {
      const { firebaseIdToken, userName, avatar, deviceId, nonce, timestamp, appSignature } = req.body || {};
      const rawToken = firebaseIdToken || req.headers.authorization;
      const fbDecoded = await verifyFirebaseIdToken(rawToken);

      if (!fbDecoded) {
        return res.status(401).json({
          success: false,
          message: 'Firebase ID Token không hợp lệ hoặc đã hết hạn!'
        });
      }

      const clientIp = extractClientIp(req);
      if (nonce || appSignature) {
        const challengeOk = verifyAppChallenge({
          nonce,
          timestamp,
          uid: fbDecoded.firebaseUid,
          signature: appSignature,
          clientIp
        });
        if (!challengeOk) {
          return res.status(403).json({
            success: false,
            message: 'Chữ ký xác thực thiết bị (Challenge-Response) không hợp lệ hoặc bị giả mạo qua trung gian!'
          });
        }
      }

      const fp = computeClientFingerprint({
        ip: clientIp,
        userAgent: req.headers['user-agent'],
        deviceId
      });
      const cleanName = sanitizeUserName(userName, fbDecoded.firebaseUid);
      const cleanAvatar = avatar || '🎧';

      const issued = issueAuthToken({
        userId: fbDecoded.uid,
        firebaseUid: fbDecoded.firebaseUid,
        provider: fbDecoded.isAnonymous ? 'firebase_anonymous' : fbDecoded.provider,
        userName: cleanName,
        avatar: cleanAvatar,
        fingerprint: fp
      });

      res.json({
        success: true,
        userId: issued.payload.uid,
        firebaseUid: fbDecoded.firebaseUid,
        provider: issued.payload.provider,
        authToken: issued.token,
        expiresAt: issued.payload.exp,
        user: {
          userId: issued.payload.uid,
          firebaseUid: fbDecoded.firebaseUid,
          userName: issued.payload.name,
          avatar: issued.payload.avatar
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 2. Cấp mới hoặc làm mới Guest Session Token (Hỗ trợ kèm firebaseIdToken & Fingerprint Binding)
  app.post('/api/auth/guest', async (req, res) => {
    const { userName, avatar, authToken, firebaseIdToken, deviceId } = req.body || {};
    const clientIp = extractClientIp(req);
    const fp = computeClientFingerprint({
      ip: clientIp,
      userAgent: req.headers['user-agent'],
      deviceId
    });

    let fbDecoded = null;
    if (firebaseIdToken) {
      fbDecoded = await verifyFirebaseIdToken(firebaseIdToken);
    }
    const existing = verifyAuthToken(authToken || req.headers.authorization, fp);

    const userId = fbDecoded
      ? fbDecoded.uid
      : (existing ? existing.uid : generateSecureUserId());
    const cleanName = sanitizeUserName(userName || (existing && existing.name), userId);
    const cleanAvatar = avatar || (existing && existing.avatar) || '🎧';

    const issued = issueAuthToken({
      userId,
      firebaseUid: fbDecoded ? fbDecoded.firebaseUid : (existing ? existing.fbUid : null),
      provider: fbDecoded ? 'firebase_anonymous' : (existing ? existing.provider : 'guest'),
      userName: cleanName,
      avatar: cleanAvatar,
      fingerprint: fp
    });

    res.json({
      success: true,
      userId: issued.payload.uid,
      firebaseUid: issued.payload.fbUid,
      provider: issued.payload.provider,
      authToken: issued.token,
      expiresAt: issued.payload.exp,
      user: {
        userId: issued.payload.uid,
        firebaseUid: issued.payload.fbUid,
        userName: issued.payload.name,
        avatar: issued.payload.avatar
      }
    });
  });

  // 3. Kiểm tra tính hợp lệ của Token hiện tại
  app.get('/api/auth/verify', async (req, res) => {
    const token = req.headers.authorization || req.query.token;
    const fp = computeClientFingerprint({
      ip: extractClientIp(req),
      userAgent: req.headers['user-agent'],
      deviceId: req.headers['x-device-id']
    });
    let decoded = verifyAuthToken(token, fp);
    if (!decoded) {
      const fb = await verifyFirebaseIdToken(token);
      if (fb) {
        decoded = {
          uid: fb.uid,
          fbUid: fb.firebaseUid,
          provider: 'firebase_anonymous',
          name: `User_${fb.firebaseUid.slice(0, 4)}`,
          avatar: '🎧',
          exp: fb.exp
        };
      }
    }
    if (!decoded) {
      return res.status(401).json({ success: false, valid: false, message: 'Token không hợp lệ hoặc đã hết hạn!' });
    }
    res.json({
      success: true,
      valid: true,
      user: {
        userId: decoded.uid,
        firebaseUid: decoded.fbUid || null,
        provider: decoded.provider || 'guest',
        userName: decoded.name,
        avatar: decoded.avatar,
        expiresAt: decoded.exp
      }
    });
  });

  // 4. Health Check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'online',
      timestamp: Date.now(),
      totalActiveRooms: rooms.size,
      totalConnectedSockets: io ? io.engine.clientsCount : 0
    });
  });

  // 5. Danh sách Sound Packs & Game States
  app.get('/api/mimic-packs', (req, res) => {
    res.json({ packs: SOUND_PACKS });
  });

  app.get('/api/game-states', (req, res) => {
    res.json({
      states: GAME_STATES,
      labels: STATE_LABELS
    });
  });

  // 6. Danh sách các phòng đang mở
  app.get('/api/rooms', (req, res) => {
    const roomList = [];
    for (const [, room] of rooms.entries()) {
      const game = gameSessions.get(room.id);
      roomList.push({
        roomId: room.id,
        roomName: room.name,
        memberCount: room.members.size,
        maxMembers: MAX_MEMBERS_PER_ROOM,
        gameState: game ? game.state : GAME_STATES.IDLE,
        createdAt: room.createdAt
      });
    }
    res.json({ rooms: roomList });
  });

  // 7. Stream trực tiếp audio bản thu của người chơi (giảm tải payload Socket)
  app.get('/api/attempts/:roomId/:socketId', (req, res) => {
    const roomId = (req.params.roomId || '').toUpperCase();
    const socketId = req.params.socketId;
    const game = gameSessions.get(roomId);
    if (!game) {
      return res.status(404).json({ error: 'Phòng đấu không tồn tại' });
    }
    const audioRecord = game.getAttemptAudio(socketId);
    if (!audioRecord || !audioRecord.buffer) {
      return res.status(404).json({ error: 'Không tìm thấy bản thu âm' });
    }
    res.setHeader('Content-Type', audioRecord.mimeType || 'audio/webm');
    res.setHeader('Content-Length', audioRecord.buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(audioRecord.buffer);
  });

  // 8. Lấy danh sách file âm thanh có sẵn từ các folder pack trong downloaded_sounds
  app.get('/api/sounds', (req, res) => {
    try {
      const packFilter = req.query.pack || null;
      const soundList = getAllDownloadedSounds(packFilter);
      const packCounts = {};
      for (const s of soundList) {
        packCounts[s.pack] = (packCounts[s.pack] || 0) + 1;
      }
      res.json({
        count: soundList.length,
        packCounts,
        sounds: soundList
      });
    } catch (err) {
      res.status(500).json({ error: 'Không thể đọc thư mục âm thanh', message: err.message });
    }
  });
}

module.exports = {
  registerApiRoutes
};
