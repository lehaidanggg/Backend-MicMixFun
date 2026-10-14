import { Socket } from 'socket.io';

export type UserRole = 'HOST' | 'PLAYER';

export type GameStateType =
  | 'IDLE'
  | 'THEME_SELECTION'
  | 'PLAYING_SAMPLE'
  | 'PREPARE_RECORDING'
  | 'USER_RECORDING'
  | 'AI_SCORING'
  | 'SHOWDOWN_REVEAL'
  | 'ROUND_RESULT'
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
  rhythmScore?: number;
  energyScore?: number;
  activeRatio?: number;
}

export interface EvaluationResult {
  totalScore: number;
  pitchScore: number;
  rhythmScore: number;
  energyScore: number;
  grade: string;
  remark: string;
}

export interface PlayerAttempt {
  audioUrl: string | null;
  audioStreamUrl?: string | null;
  mimeType?: string;
  botSoundId?: string | null;
  botSoundFileName?: string | null;
  botPitch?: number | null;
  botSpeed?: number | null;
  evaluation: EvaluationResult;
  submittedAt?: number;
}

export type BotDifficulty = 'EASY' | 'NORMAL' | 'HARD';

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

export interface RoomData {
  id: string;
  name: string;
  createdAt: number;
  hostId: string;
  hostUserId: string | null;
  members: Map<string, RoomMember>;
  messages: ChatMessage[];
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

export interface MatchmakingQueueEntry {
  socket: AuthenticatedSocket;
  sessionState: SocketSessionState;
  userId: string;
  userName: string;
  avatar: string;
  botCount: number;
  botDifficulty?: BotDifficulty;
  autoStart: boolean;
  waitMs: number;
  joinedQueueAt: number;
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
}
