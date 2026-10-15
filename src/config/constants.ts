import path from 'path';

export const SERVER_ROOT: string = path.resolve(__dirname, '../..');
export const SOUNDS_DIR: string = path.join(SERVER_ROOT, 'sounds');

export const PORT: number = Number(process.env.PORT) || 3000;
export const MAX_MEMBERS_PER_ROOM = 12;
export const DEFAULT_MIN_PLAYERS_WITH_BOTS = 4; // Mặc định ghép thêm Bot cho đủ 4 người chơi (1 người + 3 Bot)
export const RACE_1V1_PLAYERS = 2; // Chế độ 1vs1 Race luôn cố định 2 người chơi (1 vs 1)
export const DEFAULT_MATCHMAKING_BOT_COUNT = 3; // Mặc định thêm 3 Bot khi tìm trận không có người chơi khác
export const DEFAULT_MATCHMAKING_WAIT_MS: number = Number(process.env.MATCHMAKING_WAIT_MS) || 10000; // Thời gian chờ tìm người chơi thật (10s) trước khi tự tạo phòng với Bot
export const MATCHMAKING_EXTEND_MS = 5000; // Khi có thêm người thật vào hàng đợi mà đồng hồ còn < 5s thì đẩy lên 5s (Dynamic Queue Extension)
export const MATCHMAKING_MAX_WAIT_CAP_MS = 16000; // Trần thời gian chờ tối đa (16s) khi cộng giờ mềm
export const DEFAULT_TOTAL_ROUNDS = 3;
export const DEFAULT_RECORD_DURATION_SEC = 5;

// Thời lượng chuẩn của toàn bộ các Step trong 1 Round do Server quản lý tập trung (đơn vị: giây)
export const GAME_STEP_DURATIONS = {
  THEME_SELECTION: 3.5,
  PREPARE_RECORDING: 3,
  UPLOADING_SOUND: 3,
  LISTENING_NOW_PLAYING: 5,
  SHOWDOWN_REVEAL: 10,
  AI_SCORING: 4,
  ROUND_RESULT: 8,
  BREAK_TIME: 11,
  READY_COUNTDOWN: 3,
  GAME_OVER_REMATCH_DELAY: 8
} as const;
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
