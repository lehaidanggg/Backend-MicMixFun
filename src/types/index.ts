import { Socket } from 'socket.io';

export type UserRole = 'HOST' | 'PLAYER';

export type GameStateType =
  | 'IDLE'
  | 'THEME_SELECTION'
  | 'PLAYING_SAMPLE'
  | 'PREPARE_RECORDING'
  | 'USER_RECORDING'
  | 'UPLOADING_SOUND'
  | 'LISTENING_NOW_PLAYING'
  | 'SHOWDOWN_REVEAL'
  | 'AI_SCORING'
  | 'ROUND_RESULT'
  | 'BREAK_TIME'
  | 'GAME_OVER';

export interface AuthTokenPayload {
  uid: string;
  fbUid: string | null;
  provider: string;
  fp?: string | null;
  name: string;
  avatar: string;
  iat?: number;
  exp: number;
}

export interface IssuedAuthToken {
  token: string;
  payload: AuthTokenPayload;
}

export interface FirebaseDecodedToken {
  uid: string;
  firebaseUid: string;
  provider: string;
  isAnonymous: boolean;
  exp: number;
}

export interface ChallengeRecord {
  ip: string;
  createdAt: number;
}

export interface SoundCatalogItem {
  id: string;
  pack: string;
  fileName: string;
  relativePath: string;
  name?: string;
  url: string;
}

export interface SoundPackSound {
  id: string;
  name: string;
  fileName: string;
  relativePath: string;
  emoji: string;
  hint: string;
}

export interface SoundPack {
  id: string;
  folder: string;
  name: string;
  emoji: string;
  description: string;
  sounds: SoundPackSound[];
}

export interface ClientMetrics {
  matchPct?: number;
  pitchScore?: number;
  melodyScore?: number;
  rhythmScore?: number;
  energyScore?: number;
  attackScore?: number;
  activeRatio?: number;
}

export interface EvaluationResult {
  totalScore: number;
  pitchScore: number;
  melodyScore?: number;
  rhythmScore: number;
  energyScore: number;
  attackScore?: number;
  grade: string;
  remark: string;
}

export type BotDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export type BotNoiseType = 'clean_mic' | 'room_ambience' | 'mic_static_and_breath';

export type BotGenerationMode = 'CLIENT_UPLOAD' | 'LIVE_PLAYBACK_DSP';

export interface BotAudioEffects {
  difficulty: BotDifficulty;
  baseSoundUrl: string;
  botSeed?: number;
  assignedGeneratorSocketId?: string | null;
  generationMode?: BotGenerationMode;
  requiresClientUpload?: boolean;
  pitch: number;
  pitchSemitones: number;
  speed: number;
  pitchScoopCents: number;
  vibratoRateHz: number;
  noiseLevel: number;
  noiseType: BotNoiseType;
  inhaleBreathMs: number;
  inhaleBreathGain: number;
  distortion: number;
  tremoloDepth: number;
  dropoutCount: number;
  startDelayMs: number;
  bandpassHz: [number, number];
  vocalPresenceHz: number;
  vocalPresenceGainDb: number;
}

export interface PlayerAttempt {
  audioUrl: string | null;
  audioStreamUrl?: string | null;
  mimeType?: string;
  botSoundId?: string | null;
  botSoundFileName?: string | null;
  botPitch?: number | null;
  botSpeed?: number | null;
  botAudioEffects?: BotAudioEffects | null;
  botAudioUploaded?: boolean;
  assignedGeneratorSocketId?: string | null;
  generationMode?: BotGenerationMode;
  requiresClientUpload?: boolean;
  evaluation: EvaluationResult;
  submittedAt?: number;
}

export interface GamePlayer {
  socketId: string;
  userId: string | null;
  userName: string;
  avatar: string;
  role: UserRole;
  isBot?: boolean;
  botDifficulty?: BotDifficulty | null;
  totalScore: number;
  isReady: boolean;
  roundScore: number;
  currentAttempt: PlayerAttempt | null;
  joinedMidRound: boolean;
}

export interface DisconnectedPlayerRecord extends GamePlayer {
  disconnectedAt: number;
  requireToken?: boolean;
}

export interface AudioStoreRecord {
  buffer: Buffer;
  mimeType: string;
  updatedAt: number;
}

export interface RoomMember {
  socketId: string;
  userId: string | null;
  firebaseUid?: string | null;
  userName: string;
  avatar: string;
  role?: UserRole;
  isReady?: boolean;
  isAccepted?: boolean;
  isBot?: boolean;
  botDifficulty?: BotDifficulty | null;
  isAuthenticated?: boolean;
  joinedAt?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  avatar: string;
  message: string;
  type: string;
  audioMeta: unknown;
  timestamp: number;
}

export type GameModeType = 'QUICK_MATCH' | 'RACE_1V1' | 'CUSTOM_ROOM';

export interface RoomData {
  id: string;
  name: string;
  createdAt: number;
  lastActivityAt?: number;
  hostId: string;
  hostUserId: string | null;
  mode?: GameModeType;
  targetPlayers?: number;
  members: Map<string, RoomMember>;
  messages: ChatMessage[];
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  matchmakingTimer?: ReturnType<typeof setTimeout> | null;
  matchmakingTickTimer?: ReturnType<typeof setInterval> | null;
  matchmakingStartedAt?: number | null;
  matchmakingEndsAt?: number | null;
  matchmakingWaitMs?: number | null;
  acceptedSocketIds?: Set<string>;
  matchAcceptTimer?: ReturnType<typeof setTimeout> | null;
  matchAcceptTickTimer?: ReturnType<typeof setInterval> | null;
  matchAcceptStartedAt?: number | null;
  matchAcceptEndsAt?: number | null;
  matchAcceptWaitMs?: number | null;
}

export interface MatchmakingQueueEntry {
  socket: AuthenticatedSocket;
  sessionState: SocketSessionState;
  userId: string;
  userName: string;
  avatar: string;
  mode?: GameModeType;
  targetPlayers?: number;
  botCount: number;
  botDifficulty?: BotDifficulty;
  autoStart: boolean;
  waitMs: number;
  acceptWaitMs?: number;
  requireAccept?: boolean;
  joinedQueueAt: number;
  endsAt?: number;
  maxCapEndsAt?: number;
  timer: ReturnType<typeof setTimeout> | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  onResolved?: (res: Record<string, unknown>) => void;
}

export interface SocketSessionState {
  currentRoomId: string | null;
  currentUser: RoomMember;
  isSearchingMatch?: boolean;
}

export interface AuthenticatedSocket extends Socket {
  clientFingerprint?: string;
  clientIp?: string;
  authSession?: AuthTokenPayload;
  sessionState?: SocketSessionState;
}
