/**
 * MicMixFun & Mimic Party Server - Entry Point
 * Kiến trúc Modular Clean Structure (`src/`)
 */
const { PORT } = require('./src/config/constants');
const { app, server, io } = require('./src/app');
const { rooms, gameSessions, destroyRoomData } = require('./src/services/room.service');
const {
  issueAuthToken,
  verifyAuthToken,
  verifyFirebaseIdToken,
  computeClientFingerprint,
  createAuthChallenge,
  verifyAppChallenge,
  generateSecureUserId
} = require('./src/services/auth.service');

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(`🚀 MICMIXFUN SOCKET SERVER ĐANG CHẠY TẠI CỔNG ${PORT}`);
    console.log(`👉 Trang Demo Web Studio & Room: http://localhost:${PORT}`);
    console.log(`👉 Trang Mimic Party Game:        http://localhost:${PORT}/mimic`);
    console.log(`👉 Tài liệu Swagger API Docs:     http://localhost:${PORT}/api-docs`);
    console.log(`👉 REST API Health Check:         http://localhost:${PORT}/api/health`);
    console.log(`👉 Auth Challenge API:            GET  http://localhost:${PORT}/api/auth/challenge`);
    console.log(`👉 Firebase Auth API:             POST http://localhost:${PORT}/api/auth/firebase`);
    console.log(`👉 Guest Auth Token API:          POST http://localhost:${PORT}/api/auth/guest`);
    console.log(`👉 Danh sách Sounds API:           http://localhost:${PORT}/api/sounds`);
    console.log(`👉 Socket.IO Endpoint:             ws://localhost:${PORT}`);
    console.log('================================================================');
  });
}

module.exports = {
  app,
  server,
  io,
  rooms,
  gameSessions,
  issueAuthToken,
  verifyAuthToken,
  verifyFirebaseIdToken,
  computeClientFingerprint,
  createAuthChallenge,
  verifyAppChallenge,
  destroyRoomData,
  generateSecureUserId
};
