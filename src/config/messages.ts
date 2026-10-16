/**
 * Định nghĩa toàn bộ Constant Enums cho Message / Error / System Notification / AI Remark
 * Giúp Client (Android / iOS / Web) tự động Localize (đa ngôn ngữ) dựa trên mã Enum cố định.
 */

export enum ErrorCode {
  // Common & System
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SOUNDS_DIRECTORY_READ_ERROR = 'SOUNDS_DIRECTORY_READ_ERROR',

  // Auth & Security
  AUTH_FIREBASE_TOKEN_INVALID = 'AUTH_FIREBASE_TOKEN_INVALID',
  AUTH_CHALLENGE_SIGNATURE_INVALID = 'AUTH_CHALLENGE_SIGNATURE_INVALID',
  AUTH_TOKEN_INVALID_OR_EXPIRED = 'AUTH_TOKEN_INVALID_OR_EXPIRED',
  AUTH_IP_CONNECTION_LIMIT_EXCEEDED = 'AUTH_IP_CONNECTION_LIMIT_EXCEEDED',

  // Room Management
  ROOM_ID_REQUIRED = 'ROOM_ID_REQUIRED',
  ROOM_ID_ALREADY_EXISTS = 'ROOM_ID_ALREADY_EXISTS',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_NOT_JOINED = 'ROOM_NOT_JOINED',
  ROOM_FULL = 'ROOM_FULL',
  ROOM_HOST_ONLY_CLOSE = 'ROOM_HOST_ONLY_CLOSE',
  ROOM_HOST_ONLY_KICK = 'ROOM_HOST_ONLY_KICK',
  ROOM_CANNOT_KICK_SELF = 'ROOM_CANNOT_KICK_SELF',
  ROOM_KICKED_BY_HOST = 'ROOM_KICKED_BY_HOST',
  PLAYER_NOT_IN_ROOM = 'PLAYER_NOT_IN_ROOM',

  // Media & Rate Limit
  RATE_LIMIT_CHAT_EXCEEDED = 'RATE_LIMIT_CHAT_EXCEEDED',
  RATE_LIMIT_SOUND_EXCEEDED = 'RATE_LIMIT_SOUND_EXCEEDED',
  ATTEMPT_AUDIO_NOT_FOUND = 'ATTEMPT_AUDIO_NOT_FOUND',

  // Mimic Game Engine
  GAME_NOT_FOUND = 'GAME_NOT_FOUND',
  GAME_HOST_ONLY_START = 'GAME_HOST_ONLY_START',
  GAME_PLAYERS_NOT_READY = 'GAME_PLAYERS_NOT_READY',
  GAME_HOST_ONLY_CONFIG = 'GAME_HOST_ONLY_CONFIG',
  GAME_CONFIG_LOCKED_IN_PROGRESS = 'GAME_CONFIG_LOCKED_IN_PROGRESS',
  GAME_NOT_IN_RECORDING_PHASE = 'GAME_NOT_IN_RECORDING_PHASE',
  GAME_ALREADY_SUBMITTED_THIS_ROUND = 'GAME_ALREADY_SUBMITTED_THIS_ROUND',
  GAME_NOT_IN_SHOWDOWN_PHASE = 'GAME_NOT_IN_SHOWDOWN_PHASE',
  GAME_NOT_IN_READY_PHASE = 'GAME_NOT_IN_READY_PHASE',

  // AI Bot Management
  BOT_HOST_ONLY_MANAGE = 'BOT_HOST_ONLY_MANAGE',
  BOT_CANNOT_MANAGE_IN_PROGRESS = 'BOT_CANNOT_MANAGE_IN_PROGRESS',
  BOT_NOT_FOUND = 'BOT_NOT_FOUND',
  BOT_LIMIT_EXCEEDED = 'BOT_LIMIT_EXCEEDED'
}

export enum SystemMessageCode {
  SYS_HOST_JOINED_ROOM = 'SYS_HOST_JOINED_ROOM',
  SYS_PLAYER_JOINED_ROOM = 'SYS_PLAYER_JOINED_ROOM',
  SYS_USER_LEFT_ROOM = 'SYS_USER_LEFT_ROOM',
  SYS_HOST_CHANGED = 'SYS_HOST_CHANGED',
  SYS_HOST_CLOSED_ROOM = 'SYS_HOST_CLOSED_ROOM',
  SYS_PLAYER_READY = 'SYS_PLAYER_READY',
  SYS_PLAYER_UNREADY = 'SYS_PLAYER_UNREADY',
  SYS_SOUND_TRIGGERED = 'SYS_SOUND_TRIGGERED',
  SYS_AUDIO_CLIP_SHARED = 'SYS_AUDIO_CLIP_SHARED',
  SYS_GAME_CONFIG_UPDATED = 'SYS_GAME_CONFIG_UPDATED',
  SYS_BOT_JOINED_ROOM = 'SYS_BOT_JOINED_ROOM',
  SYS_BOT_REMOVED_FROM_ROOM = 'SYS_BOT_REMOVED_FROM_ROOM',
  SYS_MATCHMAKING_BOTS_FILLED = 'SYS_MATCHMAKING_BOTS_FILLED',
  SYS_MATCHMAKING_SEARCHING = 'SYS_MATCHMAKING_SEARCHING',
  SYS_MATCHMAKING_CANCELLED = 'SYS_MATCHMAKING_CANCELLED'
}

export enum RoomCloseReasonCode {
  ROOM_CLOSED = 'ROOM_CLOSED',
  HOST_CLOSED = 'HOST_CLOSED',
  ALL_MEMBERS_LEFT = 'ALL_MEMBERS_LEFT',
  EMPTY_ROOM_TIMEOUT = 'EMPTY_ROOM_TIMEOUT',
  GC_ORPHAN_ROOM = 'GC_ORPHAN_ROOM'
}

export enum GameMessageCode {
  GAME_MSG_PREPARE_RECORDING = 'GAME_MSG_PREPARE_RECORDING',
  GAME_MSG_USER_RECORDING = 'GAME_MSG_USER_RECORDING',
  GAME_MSG_UPLOADING_SOUND = 'GAME_MSG_UPLOADING_SOUND',
  GAME_MSG_LISTENING_NOW_PLAYING = 'GAME_MSG_LISTENING_NOW_PLAYING',
  GAME_MSG_AI_SCORING = 'GAME_MSG_AI_SCORING',
  GAME_MSG_BREAK_TIME = 'GAME_MSG_BREAK_TIME',
  GAME_MSG_ALL_SKIP_CONFIRMED = 'GAME_MSG_ALL_SKIP_CONFIRMED',
  GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN = 'GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN',
  GAME_MSG_GAME_OVER_CHAMPION = 'GAME_MSG_GAME_OVER_CHAMPION',
  GAME_MSG_GAME_OVER_FINISHED = 'GAME_MSG_GAME_OVER_FINISHED'
}

export enum StateLabelCode {
  STATE_LABEL_IDLE = 'STATE_LABEL_IDLE',
  STATE_LABEL_THEME_SELECTION = 'STATE_LABEL_THEME_SELECTION',
  STATE_LABEL_PLAYING_SAMPLE = 'STATE_LABEL_PLAYING_SAMPLE',
  STATE_LABEL_PREPARE_RECORDING = 'STATE_LABEL_PREPARE_RECORDING',
  STATE_LABEL_USER_RECORDING = 'STATE_LABEL_USER_RECORDING',
  STATE_LABEL_UPLOADING_SOUND = 'STATE_LABEL_UPLOADING_SOUND',
  STATE_LABEL_LISTENING_NOW_PLAYING = 'STATE_LABEL_LISTENING_NOW_PLAYING',
  STATE_LABEL_SHOWDOWN_REVEAL = 'STATE_LABEL_SHOWDOWN_REVEAL',
  STATE_LABEL_AI_SCORING = 'STATE_LABEL_AI_SCORING',
  STATE_LABEL_ROUND_RESULT = 'STATE_LABEL_ROUND_RESULT',
  STATE_LABEL_BREAK_TIME = 'STATE_LABEL_BREAK_TIME',
  STATE_LABEL_GAME_OVER = 'STATE_LABEL_GAME_OVER'
}

export enum AiRemarkCode {
  AI_REMARK_LEGENDARY_1 = 'AI_REMARK_LEGENDARY_1',
  AI_REMARK_LEGENDARY_2 = 'AI_REMARK_LEGENDARY_2',
  AI_REMARK_LEGENDARY_3 = 'AI_REMARK_LEGENDARY_3',
  AI_REMARK_GOOD_1 = 'AI_REMARK_GOOD_1',
  AI_REMARK_GOOD_2 = 'AI_REMARK_GOOD_2',
  AI_REMARK_GOOD_3 = 'AI_REMARK_GOOD_3',
  AI_REMARK_FUNNY_1 = 'AI_REMARK_FUNNY_1',
  AI_REMARK_FUNNY_2 = 'AI_REMARK_FUNNY_2',
  AI_REMARK_FUNNY_3 = 'AI_REMARK_FUNNY_3',
  AI_REMARK_FUNNY_4 = 'AI_REMARK_FUNNY_4',
  AI_REMARK_TERRIBLE_1 = 'AI_REMARK_TERRIBLE_1',
  AI_REMARK_TERRIBLE_2 = 'AI_REMARK_TERRIBLE_2',
  AI_REMARK_TERRIBLE_3 = 'AI_REMARK_TERRIBLE_3',
  AI_REMARK_MISSED_RECORDING = 'AI_REMARK_MISSED_RECORDING'
}

export enum SoundPackNameCode {
  PACK_NAME_ANIMALS = 'PACK_NAME_ANIMALS',
  PACK_NAME_MEME = 'PACK_NAME_MEME',
  PACK_NAME_VOICE1 = 'PACK_NAME_VOICE1',
  PACK_NAME_ANIME = 'PACK_NAME_ANIME',
  PACK_NAME_VOICES = 'PACK_NAME_VOICES',
  PACK_NAME_ROBOTS = 'PACK_NAME_ROBOTS',
  PACK_NAME_YANKEE = 'PACK_NAME_YANKEE',
  PACK_NAME_VEHICLES = 'PACK_NAME_VEHICLES',
  PACK_NAME_FUNNY = 'PACK_NAME_FUNNY'
}

export enum SoundPackDescCode {
  PACK_DESC_ANIMALS = 'PACK_DESC_ANIMALS',
  PACK_DESC_MEME = 'PACK_DESC_MEME',
  PACK_DESC_VOICE1 = 'PACK_DESC_VOICE1',
  PACK_DESC_ANIME = 'PACK_DESC_ANIME',
  PACK_DESC_VOICES = 'PACK_DESC_VOICES',
  PACK_DESC_ROBOTS = 'PACK_DESC_ROBOTS',
  PACK_DESC_YANKEE = 'PACK_DESC_YANKEE',
  PACK_DESC_VEHICLES = 'PACK_DESC_VEHICLES',
  PACK_DESC_FUNNY = 'PACK_DESC_FUNNY'
}

export interface EnumDocItem {
  code: string;
  vi: string;
  en: string;
  params?: string[];
  context: string;
}

/**
 * Bảng ánh xạ chi tiết từ mã Enum sang nội dung hiển thị (Tiếng Việt / Tiếng Anh) và ngữ cảnh sử dụng
 */
export const ERROR_CODE_DESCRIPTIONS: Record<ErrorCode, EnumDocItem> = {
  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    code: ErrorCode.INTERNAL_SERVER_ERROR,
    vi: 'Đã xảy ra lỗi hệ thống ngoài ý muốn. Vui lòng thử lại!',
    en: 'An unexpected internal server error occurred.',
    context: 'Lỗi ngoại lệ không xác định tại REST API hoặc Socket handler (HTTP 500).'
  },
  [ErrorCode.SOUNDS_DIRECTORY_READ_ERROR]: {
    code: ErrorCode.SOUNDS_DIRECTORY_READ_ERROR,
    vi: 'Không thể đọc danh mục âm thanh trên máy chủ.',
    en: 'Failed to read sound catalog on server.',
    context: 'Lỗi đọc file sounds/catalog.json tại GET /api/sounds (HTTP 500).'
  },
  [ErrorCode.AUTH_FIREBASE_TOKEN_INVALID]: {
    code: ErrorCode.AUTH_FIREBASE_TOKEN_INVALID,
    vi: 'Firebase ID Token không hợp lệ hoặc đã hết hạn!',
    en: 'Firebase ID Token is invalid or expired.',
    context: 'POST /api/auth/firebase khi JWT sai định dạng, hết hạn hoặc sai chữ ký RS256 (HTTP 401).'
  },
  [ErrorCode.AUTH_CHALLENGE_SIGNATURE_INVALID]: {
    code: ErrorCode.AUTH_CHALLENGE_SIGNATURE_INVALID,
    vi: 'Chữ ký xác thực thiết bị (Challenge-Response) không hợp lệ hoặc bị giả mạo qua trung gian!',
    en: 'Device challenge-response signature is invalid or replayed.',
    context: 'POST /api/auth/firebase khi nonce hết hạn, bị dùng lại (replay) hoặc sai HMAC signature (HTTP 403).'
  },
  [ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED]: {
    code: ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED,
    vi: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn!',
    en: 'Session token is invalid, expired, or fingerprint mismatched.',
    context: 'GET /api/auth/verify khi thiếu token, token hết hạn hoặc lệch Client Fingerprint (HTTP 401).'
  },
  [ErrorCode.AUTH_IP_CONNECTION_LIMIT_EXCEEDED]: {
    code: ErrorCode.AUTH_IP_CONNECTION_LIMIT_EXCEEDED,
    vi: 'Vượt quá số kết nối tối đa cho phép trên cùng 1 địa chỉ IP!',
    en: 'Maximum simultaneous connections per IP address exceeded.',
    context: 'Socket.IO Handshake Middleware khi 1 IP mở quá MAX_CONNECTIONS_PER_IP (15) kết nối.'
  },
  [ErrorCode.ROOM_ID_REQUIRED]: {
    code: ErrorCode.ROOM_ID_REQUIRED,
    vi: 'Vui lòng cung cấp mã phòng!',
    en: 'Room ID is required.',
    context: 'Socket event join_room khi roomId rỗng.'
  },
  [ErrorCode.ROOM_ID_ALREADY_EXISTS]: {
    code: ErrorCode.ROOM_ID_ALREADY_EXISTS,
    vi: 'Mã phòng đã tồn tại. Hãy thử mã khác!',
    en: 'Room ID already exists. Please try another code.',
    context: 'Socket event create_room khi mã phòng bị trùng.'
  },
  [ErrorCode.ROOM_NOT_FOUND]: {
    code: ErrorCode.ROOM_NOT_FOUND,
    vi: 'Phòng chơi không tồn tại hoặc đã giải tán!',
    en: 'Room does not exist or has been closed.',
    context: 'GET /api/attempts/:roomId/:socketId (404), close_room hoặc game_start khi không tìm thấy phòng.'
  },
  [ErrorCode.ROOM_NOT_JOINED]: {
    code: ErrorCode.ROOM_NOT_JOINED,
    vi: 'Bạn chưa tham gia phòng nào!',
    en: 'You have not joined any room.',
    context: 'Gửi chat, phát soundboard, chia sẻ audio hoặc nộp bài khi socket chưa vào phòng.'
  },
  [ErrorCode.ROOM_FULL]: {
    code: ErrorCode.ROOM_FULL,
    vi: 'Phòng đã đầy ({maxMembers}/{maxMembers} người)!',
    en: 'Room is full ({maxMembers}/{maxMembers} members).',
    params: ['maxMembers'],
    context: 'Socket event join_room khi số thành viên đạt ngưỡng MAX_MEMBERS_PER_ROOM (12).'
  },
  [ErrorCode.ROOM_HOST_ONLY_CLOSE]: {
    code: ErrorCode.ROOM_HOST_ONLY_CLOSE,
    vi: 'Chỉ có Chủ phòng (Host) mới có quyền đóng phòng!',
    en: 'Only the room Host can close the room.',
    context: 'Socket event close_room được gọi bởi thành viên không phải Host.'
  },
  [ErrorCode.ROOM_HOST_ONLY_KICK]: {
    code: ErrorCode.ROOM_HOST_ONLY_KICK,
    vi: 'Chỉ có Chủ phòng mới có quyền mời thành viên ra khỏi phòng!',
    en: 'Only the room Host can kick a member.',
    context: 'Socket event kick_player được gọi bởi thành viên không phải Host.'
  },
  [ErrorCode.ROOM_CANNOT_KICK_SELF]: {
    code: ErrorCode.ROOM_CANNOT_KICK_SELF,
    vi: 'Bạn không thể tự mời chính mình ra khỏi phòng!',
    en: 'You cannot kick yourself from the room.',
    context: 'Socket event kick_player khi targetSocketId trùng với socket.id của Host.'
  },
  [ErrorCode.ROOM_KICKED_BY_HOST]: {
    code: ErrorCode.ROOM_KICKED_BY_HOST,
    vi: 'Bạn đã bị Chủ phòng mời ra khỏi phòng!',
    en: 'You have been removed from the room by the Host.',
    context: 'Sự kiện kicked_from_room gửi tới người chơi bị Host kick.'
  },
  [ErrorCode.PLAYER_NOT_IN_ROOM]: {
    code: ErrorCode.PLAYER_NOT_IN_ROOM,
    vi: 'Người chơi không còn trong phòng!',
    en: 'Player is no longer in the room.',
    context: 'Khi kick_player, submitMimicAudio, confirmShowdownSkip hoặc confirmRoundReady mà không tìm thấy người chơi.'
  },
  [ErrorCode.RATE_LIMIT_CHAT_EXCEEDED]: {
    code: ErrorCode.RATE_LIMIT_CHAT_EXCEEDED,
    vi: 'Bạn nhắn quá nhanh! Vui lòng đợi giây lát.',
    en: 'You are sending messages too fast. Please wait a moment.',
    context: 'Socket event send_message vượt quá 6 tin nhắn / 3 giây.'
  },
  [ErrorCode.RATE_LIMIT_SOUND_EXCEEDED]: {
    code: ErrorCode.RATE_LIMIT_SOUND_EXCEEDED,
    vi: 'Thao tác phát âm thanh quá nhanh! Vui lòng đợi giây lát.',
    en: 'You are triggering sounds too fast. Please slow down.',
    context: 'Socket event trigger_sound vượt quá 5 lần / 2 giây.'
  },
  [ErrorCode.ATTEMPT_AUDIO_NOT_FOUND]: {
    code: ErrorCode.ATTEMPT_AUDIO_NOT_FOUND,
    vi: 'Không tìm thấy bản thu âm hoặc bản thu đã được giải phóng sau vòng đấu.',
    en: 'Attempt audio recording not found or already cleared.',
    context: 'GET /api/attempts/:roomId/:socketId khi không có bản thu trong audioStore (HTTP 404).'
  },
  [ErrorCode.GAME_NOT_FOUND]: {
    code: ErrorCode.GAME_NOT_FOUND,
    vi: 'Trận đấu không tồn tại!',
    en: 'Game session does not exist.',
    context: 'Khi gọi game_submit_audio, confirm_next_round_ready hoặc confirm_showdown_skip cho phòng chưa có phiên game.'
  },
  [ErrorCode.GAME_HOST_ONLY_START]: {
    code: ErrorCode.GAME_HOST_ONLY_START,
    vi: 'Chỉ có Chủ phòng (Host) mới có quyền bắt đầu trận đấu!',
    en: 'Only the room Host can start the game.',
    context: 'Socket event game_start được gọi bởi người chơi không phải Host.'
  },
  [ErrorCode.GAME_PLAYERS_NOT_READY]: {
    code: ErrorCode.GAME_PLAYERS_NOT_READY,
    vi: 'Chưa thể bắt đầu! Còn thành viên chưa sẵn sàng: {unreadyPlayers}',
    en: 'Cannot start! Some players are not ready: {unreadyPlayers}',
    params: ['unreadyPlayers'],
    context: 'Socket event game_start với requireAllReady=true khi còn thành viên chưa bấm Sẵn sàng.'
  },
  [ErrorCode.GAME_HOST_ONLY_CONFIG]: {
    code: ErrorCode.GAME_HOST_ONLY_CONFIG,
    vi: 'Chỉ có Chủ phòng mới có quyền cấu hình trận đấu!',
    en: 'Only the room Host can update game configuration.',
    context: 'Socket event game_update_config được gọi bởi người chơi không phải Host.'
  },
  [ErrorCode.GAME_CONFIG_LOCKED_IN_PROGRESS]: {
    code: ErrorCode.GAME_CONFIG_LOCKED_IN_PROGRESS,
    vi: 'Không thể đổi cấu hình khi trận đấu đang diễn ra!',
    en: 'Cannot change game configuration while a match is in progress.',
    context: 'Socket event game_update_config khi trạng thái game khác IDLE và GAME_OVER.'
  },
  [ErrorCode.GAME_NOT_IN_RECORDING_PHASE]: {
    code: ErrorCode.GAME_NOT_IN_RECORDING_PHASE,
    vi: 'Hiện không trong thời gian thu âm!',
    en: 'Not currently in the voice recording phase.',
    context: 'Nộp bài thu âm (submitMimicAudio) khi game không ở trạng thái USER_RECORDING hoặc AI_SCORING.'
  },
  [ErrorCode.GAME_ALREADY_SUBMITTED_THIS_ROUND]: {
    code: ErrorCode.GAME_ALREADY_SUBMITTED_THIS_ROUND,
    vi: 'Bạn đã nộp bài trong vòng này rồi!',
    en: 'You have already submitted your recording for this round.',
    context: 'Chặn nộp bài trùng lặp nhiều lần trong cùng 1 vòng đấu.'
  },
  [ErrorCode.GAME_NOT_IN_SHOWDOWN_PHASE]: {
    code: ErrorCode.GAME_NOT_IN_SHOWDOWN_PHASE,
    vi: 'Chưa tới giai đoạn Showdown Reveal!',
    en: 'Not currently in the Showdown Reveal phase.',
    context: 'Gọi confirmShowdownSkip khi game không ở trạng thái SHOWDOWN_REVEAL.'
  },
  [ErrorCode.GAME_NOT_IN_READY_PHASE]: {
    code: ErrorCode.GAME_NOT_IN_READY_PHASE,
    vi: 'Chưa tới giai đoạn xác nhận sẵn sàng qua vòng!',
    en: 'Not currently in the Round Result or Game Over ready phase.',
    context: 'Gọi confirmRoundReady khi game không ở trạng thái ROUND_RESULT hoặc GAME_OVER.'
  },
  [ErrorCode.BOT_HOST_ONLY_MANAGE]: {
    code: ErrorCode.BOT_HOST_ONLY_MANAGE,
    vi: 'Chỉ có Chủ phòng mới có quyền thêm hoặc xóa Bot AI!',
    en: 'Only the room Host can add or remove AI Bots.',
    context: 'Socket event add_bot hoặc remove_bot được gọi bởi người chơi không phải Host.'
  },
  [ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS]: {
    code: ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS,
    vi: 'Không thể thêm hoặc xóa Bot khi trận đấu đang diễn ra!',
    en: 'Cannot add or remove AI Bots while a match is in progress.',
    context: 'Socket event add_bot hoặc remove_bot khi trạng thái game khác IDLE và GAME_OVER.'
  },
  [ErrorCode.BOT_NOT_FOUND]: {
    code: ErrorCode.BOT_NOT_FOUND,
    vi: 'Không tìm thấy Bot AI trong phòng!',
    en: 'AI Bot not found in the room.',
    context: 'Socket event remove_bot khi phòng không có Bot nào hoặc botSocketId không tồn tại.'
  },
  [ErrorCode.BOT_LIMIT_EXCEEDED]: {
    code: ErrorCode.BOT_LIMIT_EXCEEDED,
    vi: 'Phòng đã đạt giới hạn tối đa {maxBots} Bot AI!',
    en: 'Room has reached the maximum limit of {maxBots} AI Bots.',
    params: ['maxBots'],
    context: 'Socket event add_bot khi số lượng Bot trong phòng đã đạt trần MAX_BOTS_PER_ROOM.'
  }
};

export const SYSTEM_MESSAGE_DESCRIPTIONS: Record<SystemMessageCode, EnumDocItem> = {
  [SystemMessageCode.SYS_HOST_JOINED_ROOM]: {
    code: SystemMessageCode.SYS_HOST_JOINED_ROOM,
    vi: '👑 Chủ phòng {userName} đã tham gia phòng!',
    en: '👑 Host {userName} joined the room!',
    params: ['userName', 'role'],
    context: 'Broadcast sự kiện user_joined khi người vào là Chủ phòng.'
  },
  [SystemMessageCode.SYS_PLAYER_JOINED_ROOM]: {
    code: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
    vi: '🎧 {userName} đã tham gia phòng!',
    en: '🎧 {userName} joined the room!',
    params: ['userName', 'role'],
    context: 'Broadcast sự kiện user_joined khi người chơi mới tham gia phòng.'
  },
  [SystemMessageCode.SYS_USER_LEFT_ROOM]: {
    code: SystemMessageCode.SYS_USER_LEFT_ROOM,
    vi: '{userName} đã rời phòng.',
    en: '{userName} left the room.',
    params: ['userName'],
    context: 'Broadcast sự kiện user_left khi thành viên thoát hoặc mất kết nối.'
  },
  [SystemMessageCode.SYS_HOST_CHANGED]: {
    code: SystemMessageCode.SYS_HOST_CHANGED,
    vi: '👑 {newHostName} đã trở thành Chủ phòng mới!',
    en: '👑 {newHostName} is now the new room Host!',
    params: ['newHostName'],
    context: 'Broadcast sự kiện host_changed khi Chủ phòng cũ rời đi và quyền Host được chuyển giao.'
  },
  [SystemMessageCode.SYS_HOST_CLOSED_ROOM]: {
    code: SystemMessageCode.SYS_HOST_CLOSED_ROOM,
    vi: '👑 Chủ phòng {hostName} đã đóng phòng đấu!',
    en: '👑 Host {hostName} closed the room!',
    params: ['hostName'],
    context: 'Broadcast sự kiện room_closed khi Host chủ động gọi close_room.'
  },
  [SystemMessageCode.SYS_PLAYER_READY]: {
    code: SystemMessageCode.SYS_PLAYER_READY,
    vi: '{userName} đã SẴN SÀNG ✅',
    en: '{userName} is READY ✅',
    params: ['userName', 'isReady'],
    context: 'Broadcast sự kiện player_ready_changed khi người chơi bật trạng thái Sẵn sàng.'
  },
  [SystemMessageCode.SYS_PLAYER_UNREADY]: {
    code: SystemMessageCode.SYS_PLAYER_UNREADY,
    vi: '{userName} đã hủy sẵn sàng ⏳',
    en: '{userName} is no longer ready ⏳',
    params: ['userName', 'isReady'],
    context: 'Broadcast sự kiện player_ready_changed khi người chơi tắt trạng thái Sẵn sàng.'
  },
  [SystemMessageCode.SYS_SOUND_TRIGGERED]: {
    code: SystemMessageCode.SYS_SOUND_TRIGGERED,
    vi: 'đã phát âm thanh "{soundName}"',
    en: 'played sound "{soundName}"',
    params: ['soundId', 'soundName'],
    context: 'Tin nhắn lịch sử chat (type="sound_trigger") khi người chơi bấm Soundboard.'
  },
  [SystemMessageCode.SYS_AUDIO_CLIP_SHARED]: {
    code: SystemMessageCode.SYS_AUDIO_CLIP_SHARED,
    vi: 'đã chia sẻ một đoạn ghi âm giọng nói 🎙️',
    en: 'shared a voice recording clip 🎙️',
    context: 'Tin nhắn lịch sử chat (type="audio_share") khi người chơi chia sẻ voice clip.'
  },
  [SystemMessageCode.SYS_GAME_CONFIG_UPDATED]: {
    code: SystemMessageCode.SYS_GAME_CONFIG_UPDATED,
    vi: '⚙️ Chủ phòng đã cập nhật: {totalRounds} vòng, thời gian nhại {recordDuration}s!',
    en: '⚙️ Host updated config: {totalRounds} vòng, {recordDuration}s recording time!',
    params: ['totalRounds', 'recordDuration'],
    context: 'Broadcast sự kiện game_config_changed khi Host đổi cấu hình vòng đấu.'
  },
  [SystemMessageCode.SYS_BOT_JOINED_ROOM]: {
    code: SystemMessageCode.SYS_BOT_JOINED_ROOM,
    vi: '🤖 Bot {botName} đã tham gia phòng đấu!',
    en: '🤖 Bot {botName} joined the room!',
    params: ['botName', 'difficulty'],
    context: 'Broadcast sự kiện bot_added / user_joined khi thêm AI Bot vào phòng.'
  },
  [SystemMessageCode.SYS_BOT_REMOVED_FROM_ROOM]: {
    code: SystemMessageCode.SYS_BOT_REMOVED_FROM_ROOM,
    vi: '🤖 Bot {botName} đã rời khỏi phòng.',
    en: '🤖 Bot {botName} was removed from the room.',
    params: ['botName'],
    context: 'Broadcast sự kiện bot_removed / user_left khi xóa AI Bot khỏi phòng.'
  },
  [SystemMessageCode.SYS_MATCHMAKING_BOTS_FILLED]: {
    code: SystemMessageCode.SYS_MATCHMAKING_BOTS_FILLED,
    vi: '🤖 Không tìm thấy người chơi khác — Hệ thống đã tự động thêm {botsAdded} Bot AI vào phòng để bắt đầu trận đấu!',
    en: '🤖 No other players found — Automatically added {botsAdded} AI Bots to start the match!',
    params: ['botsAdded', 'totalPlayers'],
    context: 'Broadcast sự kiện bots_auto_filled khi tìm trận không có người hoặc bắt đầu trận khi thiếu người.'
  },
  [SystemMessageCode.SYS_MATCHMAKING_SEARCHING]: {
    code: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
    vi: '🔍 Đang tìm kiếm người chơi khác đang rảnh ({waitSeconds}s)...',
    en: '🔍 Searching for other idle players ({waitSeconds}s)...',
    params: ['waitSeconds', 'waitMs'],
    context: 'Sự kiện matchmaking_searching / matchmaking_tick khi chưa có user rảnh nào khác và hệ thống đang chạy timer chờ.'
  },
  [SystemMessageCode.SYS_MATCHMAKING_CANCELLED]: {
    code: SystemMessageCode.SYS_MATCHMAKING_CANCELLED,
    vi: 'Đã hủy tìm trận nhanh.',
    en: 'Quick matchmaking cancelled.',
    context: 'Sự kiện matchmaking_cancelled khi người chơi gọi cancel_match / cancel_quick_match.'
  }
};

export const GAME_MESSAGE_DESCRIPTIONS: Record<GameMessageCode, EnumDocItem> = {
  [GameMessageCode.GAME_MSG_PREPARE_RECORDING]: {
    code: GameMessageCode.GAME_MSG_PREPARE_RECORDING,
    vi: 'Lấy hơi! Chuẩn bị micro để nhại lại trong {countdown} giây...',
    en: 'Take a breath! Get your mic ready in {countdown} seconds...',
    params: ['countdown'],
    context: 'Payload message của trạng thái PREPARE_RECORDING (3s đếm ngược).'
  },
  [GameMessageCode.GAME_MSG_USER_RECORDING]: {
    code: GameMessageCode.GAME_MSG_USER_RECORDING,
    vi: '🎙️ TỚI LƯỢT BẠN! HÃY NHẠI LẠI NGAY VÀO MICRO!',
    en: '🎙️ YOUR TURN! MIMIC THE SOUND INTO YOUR MIC NOW!',
    params: ['duration'],
    context: 'Payload message của trạng thái USER_RECORDING.'
  },
  [GameMessageCode.GAME_MSG_UPLOADING_SOUND]: {
    code: GameMessageCode.GAME_MSG_UPLOADING_SOUND,
    vi: '📨 Đang gửi bản thu âm của bạn lên máy chủ...',
    en: '📨 Uploading your sound recording to the server...',
    params: ['duration'],
    context: 'Payload message của trạng thái UPLOADING_SOUND.'
  },
  [GameMessageCode.GAME_MSG_LISTENING_NOW_PLAYING]: {
    code: GameMessageCode.GAME_MSG_LISTENING_NOW_PLAYING,
    vi: '🔊 Đang phát các bản thu âm trên sân khấu...',
    en: '🔊 Playing players\' recordings on stage...',
    params: ['duration'],
    context: 'Payload message của trạng thái LISTENING_NOW_PLAYING.'
  },
  [GameMessageCode.GAME_MSG_AI_SCORING]: {
    code: GameMessageCode.GAME_MSG_AI_SCORING,
    vi: '🤖 AI Voice Detector đang phân tích & đối chiếu phổ âm thanh...',
    en: '🤖 AI Voice Detector is analyzing audio spectrum...',
    context: 'Payload message của trạng thái AI_SCORING.'
  },
  [GameMessageCode.GAME_MSG_BREAK_TIME]: {
    code: GameMessageCode.GAME_MSG_BREAK_TIME,
    vi: '☕ Giờ giải lao! Vòng {nextRound} sẽ tự động bắt đầu sau {countdown} giây...',
    en: '☕ Break Time! Round {nextRound} starts in {countdown} seconds...',
    params: ['nextRound', 'countdown'],
    context: 'Payload message của trạng thái BREAK_TIME.'
  },
  [GameMessageCode.GAME_MSG_ALL_SKIP_CONFIRMED]: {
    code: GameMessageCode.GAME_MSG_ALL_SKIP_CONFIRMED,
    vi: '🚀 Tất cả đã đồng ý! Đang mở Bảng Điểm Vòng...',
    en: '🚀 All players agreed to skip! Opening Round Leaderboard...',
    context: 'Sự kiện all_players_ready khi 100% người chơi vote bỏ qua Showdown sớm.'
  },
  [GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN]: {
    code: GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN,
    vi: '🎉 Tất cả người chơi đã SẴN SÀNG! Bắt đầu trong {countdown} giây...',
    en: '🎉 All players READY! Starting in {countdown} seconds...',
    params: ['countdown'],
    context: 'Sự kiện all_players_ready khi 100% người chơi bấm Sẵn sàng qua vòng mới.'
  },
  [GameMessageCode.GAME_MSG_GAME_OVER_CHAMPION]: {
    code: GameMessageCode.GAME_MSG_GAME_OVER_CHAMPION,
    vi: '🏆 Chúc mừng {championName} đã trở thành Vua Nhại Giọng!',
    en: '🏆 Congratulations to {championName} for becoming the Mimic Champion!',
    params: ['championName', 'totalScore'],
    context: 'Payload message của trạng thái GAME_OVER khi có nhà vô địch.'
  },
  [GameMessageCode.GAME_MSG_GAME_OVER_FINISHED]: {
    code: GameMessageCode.GAME_MSG_GAME_OVER_FINISHED,
    vi: 'Trận đấu kết thúc!',
    en: 'Match finished!',
    context: 'Payload message của trạng thái GAME_OVER khi không có người chơi.'
  }
};

export const STATE_LABEL_DESCRIPTIONS: Record<StateLabelCode, { vi: string; en: string }> = {
  [StateLabelCode.STATE_LABEL_IDLE]: {
    vi: 'Đang chờ tại sảnh',
    en: 'Waiting in Lobby'
  },
  [StateLabelCode.STATE_LABEL_THEME_SELECTION]: {
    vi: 'Đang quay chọn chủ đề âm thanh',
    en: 'Spinning Sound Theme Roulette'
  },
  [StateLabelCode.STATE_LABEL_PLAYING_SAMPLE]: {
    vi: 'Đang phát âm thanh mẫu',
    en: 'Playing Sample Audio'
  },
  [StateLabelCode.STATE_LABEL_PREPARE_RECORDING]: {
    vi: 'Chuẩn bị lấy hơi & sẵn sàng micro (3s)',
    en: 'Get Ready to Record (3s)'
  },
  [StateLabelCode.STATE_LABEL_USER_RECORDING]: {
    vi: 'Tới lượt người chơi nhại lại',
    en: 'Player Recording Turn'
  },
  [StateLabelCode.STATE_LABEL_UPLOADING_SOUND]: {
    vi: 'Đang gửi bản thu âm lên máy chủ',
    en: 'Uploading Sound to Server'
  },
  [StateLabelCode.STATE_LABEL_LISTENING_NOW_PLAYING]: {
    vi: 'Đang phát bản thu trên sân khấu',
    en: 'Now Playing on Stage'
  },
  [StateLabelCode.STATE_LABEL_SHOWDOWN_REVEAL]: {
    vi: 'Showdown & Nghe lại các bản thu',
    en: 'Showdown & Playback Reveal'
  },
  [StateLabelCode.STATE_LABEL_AI_SCORING]: {
    vi: 'AI đang phân tích & chấm điểm',
    en: 'AI Analyzing & Scoring'
  },
  [StateLabelCode.STATE_LABEL_ROUND_RESULT]: {
    vi: 'Bảng xếp hạng vòng đấu',
    en: 'Round Leaderboard'
  },
  [StateLabelCode.STATE_LABEL_BREAK_TIME]: {
    vi: 'Giờ giải lao giữa hiệp',
    en: 'Break Time Voice Chat'
  },
  [StateLabelCode.STATE_LABEL_GAME_OVER]: {
    vi: 'Trận đấu kết thúc',
    en: 'Game Over'
  }
};

export const AI_REMARK_DESCRIPTIONS: Record<AiRemarkCode, { gradeRange: string; vi: string; en: string }> = {
  [AiRemarkCode.AI_REMARK_LEGENDARY_1]: {
    gradeRange: 'S (>= 90)',
    vi: '🔥 THÁNH NHẠI ÂM! Giống đến mức bản gốc phải xin chữ ký!',
    en: '🔥 MIMIC GOD! Even the original would ask for your autograph!'
  },
  [AiRemarkCode.AI_REMARK_LEGENDARY_2]: {
    gradeRange: 'S (>= 90)',
    vi: '🌟 10 điểm không có nhưng! Quá xuất thần!',
    en: '🌟 10 out of 10! Absolutely phenomenal!'
  },
  [AiRemarkCode.AI_REMARK_LEGENDARY_3]: {
    gradeRange: 'S (>= 90)',
    vi: '👑 Đỉnh cao thanh nhạc đường phố! Giống y đúc!',
    en: '👑 Peak vocal mastery! Identical to the sample!'
  },
  [AiRemarkCode.AI_REMARK_GOOD_1]: {
    gradeRange: 'A (75 - 89)',
    vi: '👏 Rất mượt mà! Khá giống bản gốc đấy!',
    en: '👏 Very smooth! Pretty close to the original!'
  },
  [AiRemarkCode.AI_REMARK_GOOD_2]: {
    gradeRange: 'A (75 - 89)',
    vi: '✨ Ấn tượng đấy, chỉ lệch một xíu cao độ thôi!',
    en: '✨ Impressive, just a tiny pitch difference!'
  },
  [AiRemarkCode.AI_REMARK_GOOD_3]: {
    gradeRange: 'A (75 - 89)',
    vi: '🎉 Khá lắm, nghe có nét rất riêng!',
    en: '🎉 Nice job, it has your own unique flair!'
  },
  [AiRemarkCode.AI_REMARK_FUNNY_1]: {
    gradeRange: 'B / C (35 - 74)',
    vi: '😂 Âm thanh này nghe giống tiếng bị nghẹt mũi hơn!',
    en: '😂 That sounded more like a stuffy nose!'
  },
  [AiRemarkCode.AI_REMARK_FUNNY_2]: {
    gradeRange: 'B / C (35 - 74)',
    vi: '🤔 Có gì đó sai sai... nhưng rất giải trí!',
    en: '🤔 Something went wrong... but very entertaining!'
  },
  [AiRemarkCode.AI_REMARK_FUNNY_3]: {
    gradeRange: 'B / C (35 - 74)',
    vi: '🤣 Nghe như phiên bản remix bị lỗi vậy!',
    en: '🤣 Sounds like a glitched remix version!'
  },
  [AiRemarkCode.AI_REMARK_FUNNY_4]: {
    gradeRange: 'B / C (35 - 74)',
    vi: '🚑 Cần gọi cấp cứu cho thanh quản của bạn không?',
    en: '🚑 Should we call an ambulance for your vocal cords?'
  },
  [AiRemarkCode.AI_REMARK_TERRIBLE_1]: {
    gradeRange: 'F (< 35)',
    vi: '💀 Tiếng gì đây trời?! AI xin phép từ chối nhận dạng!',
    en: '💀 What was that sound?! AI refuses to recognize it!'
  },
  [AiRemarkCode.AI_REMARK_TERRIBLE_2]: {
    gradeRange: 'F (< 35)',
    vi: '👻 Đang giả tiếng sinh vật ngoài hành tinh à?',
    en: '👻 Are you mimicking an alien creature?'
  },
  [AiRemarkCode.AI_REMARK_TERRIBLE_3]: {
    gradeRange: 'F (< 35)',
    vi: '🤐 Quên bật tiếng hay đang nhai micro vậy?',
    en: '🤐 Did you forget to unmute or are you chewing the mic?'
  },
  [AiRemarkCode.AI_REMARK_MISSED_RECORDING]: {
    gradeRange: 'F (0 - Missed)',
    vi: '😴 Không kịp thu âm nhại lại!',
    en: '😴 Missed the recording window!'
  }
};

export const ROOM_CLOSE_REASON_DESCRIPTIONS: Record<RoomCloseReasonCode, { vi: string; en: string }> = {
  [RoomCloseReasonCode.ROOM_CLOSED]: {
    vi: 'Phòng đấu đã đóng.',
    en: 'Room has been closed.'
  },
  [RoomCloseReasonCode.HOST_CLOSED]: {
    vi: 'Chủ phòng đã chủ động đóng phòng đấu.',
    en: 'Host closed the room.'
  },
  [RoomCloseReasonCode.ALL_MEMBERS_LEFT]: {
    vi: 'Tất cả thành viên đã rời khỏi phòng.',
    en: 'All members have left the room.'
  },
  [RoomCloseReasonCode.EMPTY_ROOM_TIMEOUT]: {
    vi: 'Phòng trống quá thời gian chờ kết nối lại (30s).',
    en: 'Empty room timed out after 30s grace period.'
  },
  [RoomCloseReasonCode.GC_ORPHAN_ROOM]: {
    vi: 'Hệ thống tự động thu hồi phòng trống không còn hoạt động.',
    en: 'Garbage collector cleaned up inactive orphan room.'
  }
};

export const ENUM_DICTIONARY = {
  errorCodes: ERROR_CODE_DESCRIPTIONS,
  systemMessageCodes: SYSTEM_MESSAGE_DESCRIPTIONS,
  gameMessageCodes: GAME_MESSAGE_DESCRIPTIONS,
  stateLabelCodes: STATE_LABEL_DESCRIPTIONS,
  aiRemarkCodes: AI_REMARK_DESCRIPTIONS,
  roomCloseReasonCodes: ROOM_CLOSE_REASON_DESCRIPTIONS
};
