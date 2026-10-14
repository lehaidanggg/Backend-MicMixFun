import path from 'path';

export const SERVER_ROOT: string = path.resolve(__dirname, '../..');
export const SOUNDS_DIR: string = path.join(SERVER_ROOT, 'sounds');

export const PORT: number = Number(process.env.PORT) || 3000;
export const MAX_MEMBERS_PER_ROOM = 12;
export const MAX_CHAT_HISTORY_SIZE = 50;
export const MAX_USERNAME_LENGTH = 20;
export const MAX_CONNECTIONS_PER_IP: number = Number(process.env.MAX_CONNECTIONS_PER_IP) || 15;
export const ROOM_CLEANUP_DELAY_MS = 30000; // 30s ân hạn reconnect trước khi xóa hẳn phòng trống
export const CHALLENGE_TTL_MS = 30000;      // 30s hạn dùng cho One-Time Challenge Nonce
export const AUTH_TOKEN_TTL_MS: number = 7 * 24 * 60 * 60 * 1000; // 7 ngày

export const AUTH_SECRET: string = process.env.AUTH_SECRET || 'micmixfun_hmac_secret_key_2026_v1';
export const APP_SIGNING_SECRET: string = process.env.APP_SIGNING_SECRET || 'micmixfun_client_app_secret_2026';
export const FIREBASE_PROJECT_ID: string | null = process.env.FIREBASE_PROJECT_ID || null;
export const ALLOW_DEV_MOCK_FIREBASE: boolean = process.env.ALLOW_DEV_MOCK_FIREBASE === 'true';
export const ASSET_CDN_URL: string = (process.env.ASSET_CDN_URL || 'https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev').replace(/\/+$/, '');
