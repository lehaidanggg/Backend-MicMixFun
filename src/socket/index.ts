import { Server } from 'socket.io';
import { ipConnectionCounts, extractClientIp } from '../services/auth.service';
import { leaveCurrentRoom, cancelMatchmakingForSocket } from '../services/room.service';
import { socketAuthMiddleware } from './auth.middleware';
import { registerRoomHandlers } from './room.handler';
import { registerMediaHandlers } from './media.handler';
import { registerGameHandlers } from './game.handler';
import { AuthenticatedSocket, SocketSessionState } from '../types';

export function registerSocketServer(io: Server): void {
  // 1. Handshake Middleware (HMAC + Firebase Auth + Anti-Relay Fingerprint & IP Limit)
  io.use(socketAuthMiddleware);

  // 2. Xử lý kết nối Socket.IO
  io.on('connection', (socket: AuthenticatedSocket) => {
    const clientIp = socket.clientIp || extractClientIp(socket);
    ipConnectionCounts.set(clientIp, (ipConnectionCounts.get(clientIp) || 0) + 1);

    console.log(
      `[Socket] 🟢 Kết nối mới: ${socket.id} (IP: ${clientIp})${socket.authSession ? ` (Auth UID: ${socket.authSession.uid})` : ''}`
    );

    const sessionState: SocketSessionState = {
      currentRoomId: null,
      currentUser: {
        socketId: socket.id,
        userId: socket.authSession ? socket.authSession.uid : null,
        firebaseUid: socket.authSession ? (socket.authSession.fbUid || null) : null,
        userName: socket.authSession ? socket.authSession.name : `User_${socket.id.substring(0, 4)}`,
        avatar: socket.authSession ? socket.authSession.avatar : '🎵',
        isAuthenticated: Boolean(socket.authSession)
      }
    };

    // Bộ giới hạn tần suất sự kiện (Rate Limiter per Socket) chống spam/DDoS
    const rateBuckets = new Map<string, { count: number; windowStart: number }>();
    function checkRateLimit(action: string, maxCount: number, windowMs: number): boolean {
      const now = Date.now();
      let bucket = rateBuckets.get(action);
      if (!bucket || now - bucket.windowStart > windowMs) {
        bucket = { count: 0, windowStart: now };
        rateBuckets.set(action, bucket);
      }
      bucket.count++;
      return bucket.count <= maxCount;
    }

    // Đăng ký các nhóm sự kiện theo từng miền nghiệp vụ
    registerRoomHandlers(io, socket, sessionState);
    registerMediaHandlers(io, socket, sessionState, checkRateLimit);
    registerGameHandlers(io, socket, sessionState, checkRateLimit);

    // Xử lý ngắt kết nối (disconnect)
    socket.on('disconnect', () => {
      console.log(`[Socket] 🔴 Mất kết nối: ${socket.id} (${sessionState.currentUser.userName})`);
      cancelMatchmakingForSocket(socket.id);
      const prevCount = ipConnectionCounts.get(clientIp) || 1;
      if (prevCount <= 1) {
        ipConnectionCounts.delete(clientIp);
      } else {
        ipConnectionCounts.set(clientIp, prevCount - 1);
      }
      rateBuckets.clear();
      if (sessionState.currentRoomId) {
        leaveCurrentRoom(socket, sessionState.currentRoomId, sessionState.currentUser);
      }
    });
  });
}
