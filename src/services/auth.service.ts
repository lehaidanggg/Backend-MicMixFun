import https from 'https';
import crypto from 'crypto';
import {
  MAX_USERNAME_LENGTH,
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_NONCES,
  AUTH_TOKEN_TTL_MS,
  AUTH_SECRET,
  APP_SIGNING_SECRET,
  FIREBASE_PROJECT_ID,
  ALLOW_DEV_MOCK_FIREBASE
} from '../config/constants';
import {
  AuthTokenPayload,
  ChallengeRecord,
  FirebaseDecodedToken,
  IssuedAuthToken
} from '../types';

// Lưu trữ One-Time Challenge Nonce (Chống Replay Attack & Server Trung Gian)
export const challengeNonces = new Map<string, ChallengeRecord>(); // nonce -> { ip, createdAt }
export const ipConnectionCounts = new Map<string, number>(); // ip -> active socket count

/**
 * Chuẩn hóa tên người dùng (cắt giới hạn MAX_USERNAME_LENGTH)
 */
export function sanitizeUserName(rawName?: string | null, fallbackId: string | null = '0000'): string {
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return `User_${String(fallbackId || '0000').substring(0, 4)}`;
  return trimmed.slice(0, MAX_USERNAME_LENGTH);
}

/**
 * Trích xuất địa chỉ IP chuẩn hóa của Client
 */
export function extractClientIp(reqOrSocket: any): string {
  if (!reqOrSocket) return '0.0.0.0';
  const rawIp =
    (reqOrSocket.handshake && reqOrSocket.handshake.address) ||
    (reqOrSocket.socket && reqOrSocket.socket.remoteAddress) ||
    reqOrSocket.ip ||
    '0.0.0.0';
  return String(rawIp).replace(/^::ffff:/, '');
}

/**
 * Tạo dấu vân tay kết nối (Client Fingerprint) gắn chặt với Token
 * Nếu Hacker lấy Token đem lên 1 Server Trung Gian (khác IP / khác User-Agent) để móc vào Server -> Fingerprint sẽ lệch và bị từ chối!
 */
export function computeClientFingerprint({
  ip = '',
  userAgent = '',
  deviceId = ''
}: {
  ip?: string;
  userAgent?: string | string[];
  deviceId?: string | string[];
} = {}): string {
  const normIp = String(ip || '').replace(/^::ffff:/, '').trim();
  const uaStr = Array.isArray(deviceId) ? deviceId[0] : (deviceId || (Array.isArray(userAgent) ? userAgent[0] : userAgent));
  const normUa = String(uaStr || '').trim().slice(0, 120);
  return crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${normIp}|${normUa}`)
    .digest('base64url')
    .slice(0, 16);
}

/**
 * Phát hành One-Time Challenge Nonce (Hiệu lực 30 giây, dùng 1 lần duy nhất)
 */
export function createAuthChallenge(clientIp = '0.0.0.0'): { nonce: string; expiresInMs: number } {
  if (challengeNonces.size >= MAX_CHALLENGE_NONCES) {
    const oldestKey = challengeNonces.keys().next().value;
    if (oldestKey !== undefined) {
      challengeNonces.delete(oldestKey);
    }
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  challengeNonces.set(nonce, { ip: clientIp, createdAt: Date.now() });
  return { nonce, expiresInMs: CHALLENGE_TTL_MS };
}

/**
 * Xác thực Challenge-Response (Proof-of-Possession) từ App chính chủ
 * Signature = HMAC_SHA256(nonce + ":" + timestamp + ":" + uid, APP_SIGNING_SECRET)
 */
export function verifyAppChallenge({
  nonce,
  timestamp,
  uid = '',
  signature,
  clientIp = null
}: {
  nonce?: string;
  timestamp?: number | string;
  uid?: string;
  signature?: string;
  clientIp?: string | null;
}): boolean {
  if (!nonce || !timestamp || !signature) return false;
  const record = challengeNonces.get(nonce);
  if (!record) return false;

  // Xóa ngay lập tức để chống Replay Attack (dùng lại gói tin)
  challengeNonces.delete(nonce);

  const now = Date.now();
  if (now - record.createdAt > CHALLENGE_TTL_MS) return false;
  if (Math.abs(now - Number(timestamp)) > CHALLENGE_TTL_MS) return false;
  if (clientIp && record.ip !== '0.0.0.0' && record.ip !== clientIp) return false;

  const expectedSig = crypto
    .createHmac('sha256', APP_SIGNING_SECRET)
    .update(`${nonce}:${timestamp}:${uid}`)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(String(signature), 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

// Bộ nhớ đệm chứng chỉ công khai (Public Keys) của Google Firebase + Singleflight Promise
let googleCertsCache: {
  certs: Record<string, string> | null;
  expiresAt: number;
} = {
  certs: null,
  expiresAt: 0
};
let inflightCertsPromise: Promise<Record<string, string> | null> | null = null;

/**
 * Tải và cache chứng chỉ X.509 của Google để xác thực chữ ký RS256 của Firebase ID Token
 * Sử dụng Singleflight (inflightCertsPromise) để chống Thundering Herd khi nhiều request tới cùng lúc lúc hết hạn cache
 */
export function fetchGooglePublicCerts(): Promise<Record<string, string> | null> {
  if (googleCertsCache.certs && Date.now() < googleCertsCache.expiresAt) {
    return Promise.resolve(googleCertsCache.certs);
  }
  if (inflightCertsPromise) {
    return inflightCertsPromise;
  }
  const url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
  inflightCertsPromise = new Promise<Record<string, string> | null>((resolve) => {
    const req = https.get(url, { timeout: 3500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const certs = JSON.parse(body) as Record<string, string>;
          const cc = String(res.headers['cache-control'] || '');
          const m = cc.match(/max-age=(\d+)/);
          const maxAgeMs = m ? parseInt(m[1], 10) * 1000 : 3600000;
          googleCertsCache = {
            certs,
            expiresAt: Date.now() + maxAgeMs
          };
          resolve(certs);
        } catch {
          resolve(googleCertsCache.certs);
        }
      });
    });
    req.on('error', () => resolve(googleCertsCache.certs));
    req.on('timeout', () => { req.destroy(); resolve(googleCertsCache.certs); });
  }).finally(() => {
    inflightCertsPromise = null;
  });
  return inflightCertsPromise;
}

/**
 * Xác thực Firebase ID Token (Chặn tuyệt đối Fake Auth Server tự ký JWT giả)
 * - Bắt buộc alg === 'RS256' và chữ ký RSA-SHA256 hợp lệ với chứng chỉ X.509 của Google
 * - Kiểm tra hạn dùng (exp), iat, issuer (securetoken.google.com/<projectId>), aud và sub
 */
export async function verifyFirebaseIdToken(idToken?: unknown): Promise<FirebaseDecodedToken | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  const raw = idToken.startsWith('Bearer ') ? idToken.slice(7).trim() : idToken.trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

    const nowSec = Math.floor(Date.now() / 1000);
    if (!header || !payload || typeof payload !== 'object') return null;

    // 1. Bắt buộc thuật toán RS256 chuẩn của Google Firebase
    if (header.alg !== 'RS256' || !header.kid) {
      return null;
    }

    // 2. Kiểm tra hạn sử dụng (exp) và thời điểm phát hành (iat)
    if (typeof payload.exp !== 'number' || nowSec > payload.exp + 60) {
      return null;
    }
    if (typeof payload.iat === 'number' && payload.iat > nowSec + 300) {
      return null;
    }

    // 3. Lấy Firebase UID từ trường 'user_id' hoặc 'sub'
    const firebaseUid = payload.user_id || payload.sub;
    if (!firebaseUid || typeof firebaseUid !== 'string' || firebaseUid.length > 128) {
      return null;
    }

    // 4. Kiểm tra chặt chẽ Issuer và Audience (chống Hacker dùng Firebase Project khác để móc vào)
    if (!payload.iss || !String(payload.iss).startsWith('https://securetoken.google.com/')) {
      return null;
    }
    if (FIREBASE_PROJECT_ID) {
      if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
        return null;
      }
    }

    // 5. Xác thực chữ ký RSA-SHA256 bắt buộc với chứng chỉ Google
    const isDevMock = ALLOW_DEV_MOCK_FIREBASE && header.kid === 'local_dev_kid';
    if (!isDevMock) {
      const certs = await fetchGooglePublicCerts();
      if (!certs || !certs[header.kid]) {
        return null;
      }
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${parts[0]}.${parts[1]}`);
      const isValidSig = verifier.verify(certs[header.kid], parts[2], 'base64url');
      if (!isValidSig) return null;
    }

    const provider = (payload.firebase && payload.firebase.sign_in_provider) || 'anonymous';
    return {
      uid: `fb_${firebaseUid}`,
      firebaseUid,
      provider,
      isAnonymous: provider === 'anonymous',
      exp: payload.exp * 1000
    };
  } catch {
    return null;
  }
}

/**
 * Tạo userId ngẫu nhiên an toàn
 */
export function generateSecureUserId(): string {
  return 'u_' + crypto.randomBytes(8).toString('hex');
}

/**
 * Ký Session Token bằng HMAC-SHA256 kèm Client Fingerprint (fp) chống Relay qua Server Trung Gian
 */
export function issueAuthToken({
  userId,
  firebaseUid = null,
  provider = 'guest',
  userName,
  avatar,
  fingerprint = null
}: {
  userId?: string | null;
  firebaseUid?: string | null;
  provider?: string;
  userName?: string | null;
  avatar?: string | null;
  fingerprint?: string | null;
}): IssuedAuthToken {
  const now = Date.now();
  const resolvedUid = userId || generateSecureUserId();
  const payload: AuthTokenPayload = {
    uid: resolvedUid,
    fbUid: firebaseUid || null,
    provider,
    fp: fingerprint || null,
    name: sanitizeUserName(userName, resolvedUid),
    avatar: String(avatar || '🎧').slice(0, 8),
    iat: now,
    exp: now + AUTH_TOKEN_TTL_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return {
    token: `${payloadB64}.${signatureB64}`,
    payload
  };
}

/**
 * Xác thực chữ ký HMAC-SHA256, hạn sử dụng và Client Fingerprint (fp) của Token
 */
export function verifyAuthToken(token?: unknown, expectedFingerprint: string | null = null): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const rawToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  try {
    const expectedSig = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!decoded || !decoded.uid || typeof decoded.exp !== 'number') return null;
    if (Date.now() > decoded.exp) return null;

    if (expectedFingerprint && decoded.fp && decoded.fp !== expectedFingerprint) {
      console.warn(`[Security] 🚨 Chặn Token bị relay từ môi trường/IP khác! (Token FP: ${decoded.fp} !== Request FP: ${expectedFingerprint})`);
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}
