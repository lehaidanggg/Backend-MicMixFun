import { Express, Request, Response } from 'express';
import { Server } from 'socket.io';
import {
  DEFAULT_MATCHMAKING_WAIT_MS,
  DEFAULT_RECORD_DURATION_SEC,
  DEFAULT_TOTAL_ROUNDS,
  GAME_STEP_DURATIONS,
  MAX_MEMBERS_PER_ROOM
} from '../config/constants';
import {
  AiRemarkCode,
  ENUM_DICTIONARY,
  ErrorCode,
  GameMessageCode,
  RoomCloseReasonCode,
  SoundPackDescCode,
  SoundPackNameCode,
  StateLabelCode,
  SystemMessageCode
} from '../config/messages';
import { GAME_STATES, STATE_LABELS, SOUND_PACKS } from '../game/soundPacks';
import { getAllDownloadedSounds } from '../services/audio.service';
import { rooms, gameSessions, matchmakingQueue } from '../services/room.service';
import {
  challengeNonces,
  ipConnectionCounts,
  sanitizeUserName,
  extractClientIp,
  computeClientFingerprint,
  createAuthChallenge,
  verifyAppChallenge,
  verifyFirebaseIdToken,
  generateSecureUserId,
  issueAuthToken,
  verifyAuthToken
} from '../services/auth.service';
import { AuthTokenPayload } from '../types';

export function registerApiRoutes(app: Express, io: Server): void {
  // 0. Phát hành One-Time Challenge Nonce (Chống Server Trung Gian / Replay Attack)
  app.get('/api/auth/challenge', (req: Request, res: Response) => {
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
  app.post('/api/auth/firebase', async (req: Request, res: Response) => {
    try {
      const { firebaseIdToken, userName, avatar, deviceId, nonce, timestamp, appSignature } = req.body || {};
      const rawToken = firebaseIdToken || req.headers.authorization;
      const fbDecoded = await verifyFirebaseIdToken(rawToken);

      if (!fbDecoded) {
        res.status(401).json({
          success: false,
          code: ErrorCode.AUTH_FIREBASE_TOKEN_INVALID,
          message: ErrorCode.AUTH_FIREBASE_TOKEN_INVALID
        });
        return;
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
          res.status(403).json({
            success: false,
            code: ErrorCode.AUTH_CHALLENGE_SIGNATURE_INVALID,
            message: ErrorCode.AUTH_CHALLENGE_SIGNATURE_INVALID
          });
          return;
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
    } catch {
      res.status(500).json({
        success: false,
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: ErrorCode.INTERNAL_SERVER_ERROR
      });
    }
  });

  // 2. Cấp mới hoặc làm mới Guest Session Token (Hỗ trợ kèm firebaseIdToken & Fingerprint Binding)
  app.post('/api/auth/guest', async (req: Request, res: Response) => {
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
  app.get('/api/auth/verify', async (req: Request, res: Response) => {
    const token = req.headers.authorization || (typeof req.query.token === 'string' ? req.query.token : undefined);
    const fp = computeClientFingerprint({
      ip: extractClientIp(req),
      userAgent: req.headers['user-agent'],
      deviceId: req.headers['x-device-id']
    });
    let decoded: AuthTokenPayload | null = verifyAuthToken(token, fp);
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
      res.status(401).json({
        success: false,
        valid: false,
        code: ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED,
        message: ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED
      });
      return;
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

  // 4. Health Check & Resource Telemetry
  app.get('/api/health', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    let totalStoredAudioBuffers = 0;
    for (const game of gameSessions.values()) {
      totalStoredAudioBuffers += game.audioStore.size;
    }
    res.json({
      status: 'online',
      timestamp: Date.now(),
      totalActiveRooms: rooms.size,
      totalConnectedSockets: io ? io.engine.clientsCount : 0,
      stateCounters: {
        rooms: rooms.size,
        gameSessions: gameSessions.size,
        matchmakingQueue: matchmakingQueue.size,
        challengeNonces: challengeNonces.size,
        trackedIps: ipConnectionCounts.size,
        totalStoredAudioBuffers
      },
      memory: {
        rssMB: Number((mem.rss / (1024 * 1024)).toFixed(2)),
        heapUsedMB: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
        externalMB: Number((mem.external / (1024 * 1024)).toFixed(2)),
        arrayBuffersMB: Number(((mem.arrayBuffers || 0) / (1024 * 1024)).toFixed(2))
      }
    });
  });

  // 5. Danh sách Sound Packs & Game States (kèm toàn bộ Localization Enum Codes)
  app.get('/api/mimic-packs', (_req: Request, res: Response) => {
    res.json({ packs: SOUND_PACKS });
  });

  app.get('/api/game-states', (_req: Request, res: Response) => {
    res.json({
      states: GAME_STATES,
      labels: STATE_LABELS,
      stepDurations: GAME_STEP_DURATIONS,
      defaultTotalRounds: DEFAULT_TOTAL_ROUNDS,
      defaultRecordDuration: DEFAULT_RECORD_DURATION_SEC,
      matchmakingWaitMs: DEFAULT_MATCHMAKING_WAIT_MS,
      enums: {
        errorCodes: ErrorCode,
        systemMessageCodes: SystemMessageCode,
        gameMessageCodes: GameMessageCode,
        roomCloseReasonCodes: RoomCloseReasonCode,
        stateLabelCodes: StateLabelCode,
        aiRemarkCodes: AiRemarkCode,
        soundPackNameCodes: SoundPackNameCode,
        soundPackDescCodes: SoundPackDescCode
      },
      descriptions: ENUM_DICTIONARY
    });
  });

  // 5b. Bảng tra cứu chi tiết Localization Enum Codes -> Mô tả Tiếng Việt / Tiếng Anh
  app.get('/api/enums', (_req: Request, res: Response) => {
    res.json({
      enums: {
        errorCodes: ErrorCode,
        systemMessageCodes: SystemMessageCode,
        gameMessageCodes: GameMessageCode,
        roomCloseReasonCodes: RoomCloseReasonCode,
        stateLabelCodes: StateLabelCode,
        aiRemarkCodes: AiRemarkCode,
        soundPackNameCodes: SoundPackNameCode,
        soundPackDescCodes: SoundPackDescCode
      },
      descriptions: ENUM_DICTIONARY
    });
  });

  // 6. Danh sách các phòng đang mở (mặc định chỉ trả về CUSTOM_ROOM và giới hạn tối đa 100 phòng)
  app.get('/api/rooms', (req: Request, res: Response) => {
    const includeMatchmaking = req.query.includeMatchmaking === 'true';
    const maxLimit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const roomList = [];
    for (const [, room] of rooms.entries()) {
      const mode = room.mode || 'CUSTOM_ROOM';
      if (!includeMatchmaking && mode !== 'CUSTOM_ROOM') {
        continue;
      }
      const game = gameSessions.get(room.id);
      roomList.push({
        roomId: room.id,
        roomName: room.name,
        mode,
        memberCount: room.members.size,
        maxMembers: room.targetPlayers || MAX_MEMBERS_PER_ROOM,
        gameState: game ? game.state : GAME_STATES.IDLE,
        createdAt: room.createdAt
      });
      if (roomList.length >= maxLimit) break;
    }
    res.json({ rooms: roomList });
  });

  // 7. Stream trực tiếp audio bản thu của người chơi (hoặc redirect sang CDN gốc đối với AI Bot)
  app.get('/api/attempts/:roomId/:socketId', (req: Request, res: Response) => {
    const roomId = String(req.params.roomId || '').toUpperCase();
    const socketId = String(req.params.socketId || '');
    const game = gameSessions.get(roomId);
    if (!game) {
      res.status(404).json({
        success: false,
        code: ErrorCode.ROOM_NOT_FOUND,
        error: ErrorCode.ROOM_NOT_FOUND,
        message: ErrorCode.ROOM_NOT_FOUND
      });
      return;
    }

    const audioRecord = game.getAttemptAudio(socketId);
    if (audioRecord && audioRecord.buffer) {
      res.setHeader('Content-Type', audioRecord.mimeType || 'audio/webm');
      res.setHeader('Content-Length', audioRecord.buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(audioRecord.buffer);
      return;
    }

    const player = game.players.get(socketId);
    if (player && player.isBot && player.currentAttempt?.botAudioEffects?.baseSoundUrl) {
      res.redirect(302, player.currentAttempt.botAudioEffects.baseSoundUrl);
      return;
    }

    res.status(404).json({
      success: false,
      code: ErrorCode.ATTEMPT_AUDIO_NOT_FOUND,
      error: ErrorCode.ATTEMPT_AUDIO_NOT_FOUND,
      message: ErrorCode.ATTEMPT_AUDIO_NOT_FOUND
    });
  });

  // 8. Lấy danh sách file âm thanh có sẵn từ các folder pack trong catalog.json
  app.get('/api/sounds', (req: Request, res: Response) => {
    try {
      const packFilter = typeof req.query.pack === 'string' ? req.query.pack : null;
      const soundList = getAllDownloadedSounds(packFilter);
      const packCounts: Record<string, number> = {};
      for (const s of soundList) {
        packCounts[s.pack] = (packCounts[s.pack] || 0) + 1;
      }
      res.json({
        count: soundList.length,
        packCounts,
        sounds: soundList
      });
    } catch {
      res.status(500).json({
        success: false,
        code: ErrorCode.SOUNDS_DIRECTORY_READ_ERROR,
        error: ErrorCode.SOUNDS_DIRECTORY_READ_ERROR,
        message: ErrorCode.SOUNDS_DIRECTORY_READ_ERROR
      });
    }
  });
}
