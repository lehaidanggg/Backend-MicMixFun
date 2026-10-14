const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const SOUNDS_DIR = path.join(SERVER_ROOT, 'sounds');

const PORT = Number(process.env.PORT) || 3000;
const MAX_MEMBERS_PER_ROOM = 12;
const MAX_CHAT_HISTORY_SIZE = 50;
const MAX_USERNAME_LENGTH = 20;
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP) || 15;
const ROOM_CLEANUP_DELAY_MS = 30000; // 30s ân hạn reconnect trước khi xóa hẳn phòng trống
const CHALLENGE_TTL_MS = 30000;      // 30s hạn dùng cho One-Time Challenge Nonce
const AUTH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const AUTH_SECRET = process.env.AUTH_SECRET || 'micmixfun_hmac_secret_key_2026_v1';
const APP_SIGNING_SECRET = process.env.APP_SIGNING_SECRET || 'micmixfun_client_app_secret_2026';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || null;
const ALLOW_DEV_MOCK_FIREBASE = process.env.ALLOW_DEV_MOCK_FIREBASE === 'true';
const ASSET_CDN_URL = (process.env.ASSET_CDN_URL || 'https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev').replace(/\/+$/, '');

module.exports = {
  SERVER_ROOT,
  SOUNDS_DIR,
  PORT,
  MAX_MEMBERS_PER_ROOM,
  MAX_CHAT_HISTORY_SIZE,
  MAX_USERNAME_LENGTH,
  MAX_CONNECTIONS_PER_IP,
  ROOM_CLEANUP_DELAY_MS,
  CHALLENGE_TTL_MS,
  AUTH_TOKEN_TTL_MS,
  AUTH_SECRET,
  APP_SIGNING_SECRET,
  FIREBASE_PROJECT_ID,
  ALLOW_DEV_MOCK_FIREBASE,
  ASSET_CDN_URL
};
