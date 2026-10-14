/**
 * MicMixFun & Mimic Party Server - Entry Point (TypeScript)
 * Kiến trúc Modular Clean Structure (`src/`)
 */
import { PORT } from './config/constants';
import { app, server, io } from './app';
import { rooms, gameSessions, destroyRoomData } from './services/room.service';
import {
  issueAuthToken,
  verifyAuthToken,
  verifyFirebaseIdToken,
  computeClientFingerprint,
  createAuthChallenge,
  verifyAppChallenge,
  generateSecureUserId
} from './services/auth.service';

import {
  ErrorCode,
  SystemMessageCode,
  GameMessageCode,
  RoomCloseReasonCode,
  StateLabelCode,
  AiRemarkCode,
  SoundPackNameCode,
  SoundPackDescCode
} from './config/messages';

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('================================================================');
    console.log(`🚀 MICMIXFUN SOCKET SERVER (TS) ĐANG CHẠY TẠI CỔNG ${PORT}`);
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

export {
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
  generateSecureUserId,
  ErrorCode,
  SystemMessageCode,
  GameMessageCode,
  RoomCloseReasonCode,
  StateLabelCode,
  AiRemarkCode,
  SoundPackNameCode,
  SoundPackDescCode
};
