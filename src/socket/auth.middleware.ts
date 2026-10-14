import { MAX_CONNECTIONS_PER_IP } from '../config/constants';
import {
  ipConnectionCounts,
  extractClientIp,
  computeClientFingerprint,
  verifyAuthToken,
  verifyFirebaseIdToken
} from '../services/auth.service';
import { AuthenticatedSocket } from '../types';

/**
 * Socket.IO Handshake Middleware:
 * - Giới hạn số lượng kết nối đồng thời trên 1 IP (MAX_CONNECTIONS_PER_IP) chống Server Trung Gian
 * - Tính toán Client Fingerprint (IP + User-Agent / deviceId)
 * - Tự động giải mã HMAC Token hoặc Firebase ID Token ngay khi bắt tay
 */
export async function socketAuthMiddleware(
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const clientIp = extractClientIp(socket);
    const activeOnIp = ipConnectionCounts.get(clientIp) || 0;
    if (activeOnIp >= MAX_CONNECTIONS_PER_IP) {
      next(new Error(`Vượt quá số kết nối tối đa cho phép trên cùng 1 địa chỉ IP (${MAX_CONNECTIONS_PER_IP})!`));
      return;
    }

    const authObj: Record<string, any> = socket.handshake.auth || {};
    const socketFp = computeClientFingerprint({
      ip: clientIp,
      userAgent: socket.handshake.headers && socket.handshake.headers['user-agent'],
      deviceId: authObj.deviceId
    });
    socket.clientFingerprint = socketFp;
    socket.clientIp = clientIp;

    const queryObj = socket.handshake.query || {};
    const rawToken =
      authObj.token ||
      authObj.firebaseToken ||
      authObj.firebaseIdToken ||
      (socket.handshake.headers && socket.handshake.headers.authorization) ||
      queryObj.token ||
      queryObj.firebaseToken;

    if (rawToken) {
      const hmacDecoded = verifyAuthToken(rawToken, socketFp);
      if (hmacDecoded) {
        socket.authSession = hmacDecoded;
      } else {
        const fbDecoded = await verifyFirebaseIdToken(rawToken);
        if (fbDecoded) {
          socket.authSession = {
            uid: fbDecoded.uid,
            fbUid: fbDecoded.firebaseUid,
            provider: 'firebase_anonymous',
            fp: socketFp,
            name: `User_${fbDecoded.firebaseUid.slice(0, 4)}`,
            avatar: '🎧',
            exp: fbDecoded.exp
          };
        }
      }
    }
  } catch {
    // Bỏ qua lỗi handshake auth không bắt buộc
  }
  next();
}
