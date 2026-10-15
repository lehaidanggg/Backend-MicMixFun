import { Server, Socket } from 'socket.io';
import {
  ROOM_CLEANUP_DELAY_MS,
  CHALLENGE_TTL_MS,
  MAX_MEMBERS_PER_ROOM,
  DEFAULT_MATCHMAKING_WAIT_MS,
  MATCHMAKING_EXTEND_MS,
  MATCHMAKING_MAX_WAIT_CAP_MS,
  DEFAULT_MIN_PLAYERS_WITH_BOTS,
  RACE_1V1_PLAYERS,
  MAX_CHAT_HISTORY_SIZE
} from '../config/constants';
import { ErrorCode, RoomCloseReasonCode, SystemMessageCode } from '../config/messages';
import { challengeNonces } from './auth.service';
import { normalizeBotDifficulty } from './audio.service';
import { MimicGameSession } from '../game/MimicGameSession';
import { BotDifficulty, GameModeType, MatchmakingQueueEntry, RoomData, RoomMember } from '../types';

// In-Memory Database Quản Lý Phòng, Game Sessions & Hàng Đợi Ghép Trận Nhanh (Matchmaking Queue)
export const rooms = new Map<string, RoomData>();
export const gameSessions = new Map<string, MimicGameSession>();
export const matchmakingQueue = new Map<string, MatchmakingQueueEntry>();

let ioInstance: Server | null = null;

export function setIoInstance(io: Server): void {
  ioInstance = io;
}

/**
 * Hủy và xóa 1 socket khỏi hàng đợi tìm trận nhanh (dọn sạch timer chờ)
 */
export function cancelMatchmakingForSocket(socketId: string): MatchmakingQueueEntry | null {
  const entry = matchmakingQueue.get(socketId);
  if (!entry) return null;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry.tickTimer) {
    clearInterval(entry.tickTimer);
    entry.tickTimer = null;
  }
  entry.sessionState.isSearchingMatch = false;
  matchmakingQueue.delete(socketId);
  return entry;
}

export const BOT_PRESETS: Array<{ name: string; avatar: string }> = [
  { name: 'Bot Alpha', avatar: '🤖' },
  { name: 'Bot Meow', avatar: '🐱' },
  { name: 'Bot Shib', avatar: '🐶' },
  { name: 'Bot Cyber', avatar: '👾' },
  { name: 'Bot DJ', avatar: '🎧' },
  { name: 'Bot Panda', avatar: '🐼' },
  { name: 'Bot Fox', avatar: '🦊' },
  { name: 'Bot Dino', avatar: '🦖' },
  { name: 'Bot Ninja', avatar: '🥷' },
  { name: 'Bot Duck', avatar: '🦆' },
  { name: 'Bot Astro', avatar: '🧑‍🚀' }
];

export function isBotMember(member?: Partial<RoomMember> | null): boolean {
  if (!member) return false;
  return Boolean(member.isBot || String(member.socketId || '').startsWith('bot_'));
}

/**
 * Thêm 1 AI Bot vào phòng chơi
 */
export function addBotToRoom(
  roomId: string,
  options: { difficulty?: BotDifficulty | string; botName?: string; avatar?: string } = {}
): {
  success: boolean;
  code?: ErrorCode;
  message?: ErrorCode;
  messageParams?: Record<string, unknown>;
  bot?: RoomMember;
  members?: RoomMember[];
} {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room) {
    return {
      success: false,
      code: ErrorCode.ROOM_NOT_FOUND,
      message: ErrorCode.ROOM_NOT_FOUND
    };
  }

  if (room.members.size >= MAX_MEMBERS_PER_ROOM) {
    return {
      success: false,
      code: ErrorCode.ROOM_FULL,
      message: ErrorCode.ROOM_FULL,
      messageParams: { maxMembers: MAX_MEMBERS_PER_ROOM }
    };
  }

  const difficulty: BotDifficulty = normalizeBotDifficulty(options.difficulty);

  const existingNames = new Set(Array.from(room.members.values()).map(m => m.userName));
  const availablePreset =
    BOT_PRESETS.find(p => !existingNames.has(p.name)) ||
    BOT_PRESETS[room.members.size % BOT_PRESETS.length];

  const uniqueSuffix = Math.random().toString(36).substring(2, 7);
  const botSocketId = `bot_${uniqueSuffix}`;
  const botName = options.botName
    ? String(options.botName).trim().slice(0, 24)
    : existingNames.has(availablePreset.name)
      ? `${availablePreset.name} #${room.members.size}`
      : availablePreset.name;
  const botAvatar = options.avatar || availablePreset.avatar || '🤖';

  const botMember: RoomMember = {
    socketId: botSocketId,
    userId: botSocketId,
    userName: botName,
    avatar: botAvatar,
    role: 'PLAYER',
    isReady: true,
    isBot: true,
    botDifficulty: difficulty,
    isAuthenticated: false,
    joinedAt: Date.now()
  };

  room.members.set(botSocketId, botMember);

  let game = gameSessions.get(targetId);
  if (!game && ioInstance) {
    game = new MimicGameSession(targetId, ioInstance);
    game.hostId = room.hostId;
    gameSessions.set(targetId, game);
  }
  if (game) {
    game.addPlayer(botSocketId, botName, botAvatar, 'PLAYER', botSocketId, false, true, difficulty);
  }

  const membersList = getRoomMembersArray(room);

  if (ioInstance) {
    const payload = {
      user: botMember,
      bot: botMember,
      members: membersList,
      systemMessage: SystemMessageCode.SYS_BOT_JOINED_ROOM,
      messageCode: SystemMessageCode.SYS_BOT_JOINED_ROOM,
      messageParams: { botName, userName: botName, difficulty }
    };
    ioInstance.to(targetId).emit('bot_added', payload);
    ioInstance.to(targetId).emit('user_joined', payload);
  }

  console.log(`[Bot] 🤖 Đã thêm ${botName} (${botSocketId} - ${difficulty}) vào phòng: ${targetId}`);
  return {
    success: true,
    bot: botMember,
    members: membersList
  };
}

/**
 * Xóa 1 AI Bot khỏi phòng chơi (theo botSocketId hoặc xóa Bot cuối cùng nếu không truyền botSocketId)
 */
export function removeBotFromRoom(
  roomId: string,
  botSocketId?: string | null
): {
  success: boolean;
  code?: ErrorCode;
  message?: ErrorCode;
  removedBot?: RoomMember;
  members?: RoomMember[];
} {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room) {
    return {
      success: false,
      code: ErrorCode.ROOM_NOT_FOUND,
      message: ErrorCode.ROOM_NOT_FOUND
    };
  }

  let targetBot: RoomMember | undefined;
  if (botSocketId) {
    const candidate = room.members.get(botSocketId);
    if (candidate && isBotMember(candidate)) {
      targetBot = candidate;
    }
  } else {
    const allBots = Array.from(room.members.values()).filter(m => isBotMember(m));
    targetBot = allBots[allBots.length - 1];
  }

  if (!targetBot) {
    return {
      success: false,
      code: ErrorCode.BOT_NOT_FOUND,
      message: ErrorCode.BOT_NOT_FOUND
    };
  }

  room.members.delete(targetBot.socketId);
  const game = gameSessions.get(targetId);
  if (game) {
    game.removePlayer(targetBot.socketId);
  }

  const membersList = getRoomMembersArray(room);

  if (ioInstance) {
    const payload = {
      user: targetBot,
      bot: targetBot,
      members: membersList,
      systemMessage: SystemMessageCode.SYS_BOT_REMOVED_FROM_ROOM,
      messageCode: SystemMessageCode.SYS_BOT_REMOVED_FROM_ROOM,
      messageParams: { botName: targetBot.userName, userName: targetBot.userName }
    };
    ioInstance.to(targetId).emit('bot_removed', payload);
    ioInstance.to(targetId).emit('user_left', payload);
  }

  console.log(`[Bot] 🗑️ Đã xóa ${targetBot.userName} (${targetBot.socketId}) khỏi phòng: ${targetId}`);
  return {
    success: true,
    removedBot: targetBot,
    members: membersList
  };
}

/**
 * Tự động thêm nhiều AI Bot vào phòng khi thiếu người chơi (xoay vòng độ khó EASY / NORMAL / HARD)
 */
export function fillRoomWithBots(
  roomId: string,
  options: {
    botCount?: number;
    minPlayers?: number;
    difficulty?: BotDifficulty | string;
  } = {}
): {
  botsAdded: number;
  addedBots: RoomMember[];
  totalPlayers: number;
  members: RoomMember[];
} {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room) {
    return { botsAdded: 0, addedBots: [], totalPlayers: 0, members: [] };
  }

  const difficultiesCycle: BotDifficulty[] = ['NORMAL', 'EASY', 'HARD'];
  const addedBots: RoomMember[] = [];

  let countToAdd = 0;
  if (typeof options.botCount === 'number' && options.botCount > 0) {
    countToAdd = Math.min(options.botCount, MAX_MEMBERS_PER_ROOM - room.members.size);
  } else {
    const targetMin = Math.min(
      MAX_MEMBERS_PER_ROOM,
      Math.max(2, Number(options.minPlayers) || 4)
    );
    countToAdd = Math.max(0, targetMin - room.members.size);
  }

  for (let i = 0; i < countToAdd; i++) {
    const diff: BotDifficulty = options.difficulty
      ? normalizeBotDifficulty(options.difficulty)
      : difficultiesCycle[i % difficultiesCycle.length];

    const res = addBotToRoom(targetId, { difficulty: diff });
    if (!res.success || !res.bot) break;
    addedBots.push(res.bot);
  }

  const membersList = getRoomMembersArray(room);

  if (addedBots.length > 0 && ioInstance) {
    ioInstance.to(targetId).emit('bots_auto_filled', {
      roomId: targetId,
      botsAdded: addedBots.length,
      addedBots,
      totalPlayers: room.members.size,
      members: membersList,
      systemMessage: SystemMessageCode.SYS_MATCHMAKING_BOTS_FILLED,
      messageCode: SystemMessageCode.SYS_MATCHMAKING_BOTS_FILLED,
      messageParams: {
        botsAdded: addedBots.length,
        totalPlayers: room.members.size
      }
    });
  }

  return {
    botsAdded: addedBots.length,
    addedBots,
    totalPlayers: room.members.size,
    members: membersList
  };
}

export function clearRoomMatchmakingTimers(room?: RoomData | null): void {
  if (!room) return;
  if (room.matchmakingTimer) {
    clearTimeout(room.matchmakingTimer);
    room.matchmakingTimer = null;
  }
  if (room.matchmakingTickTimer) {
    clearInterval(room.matchmakingTickTimer);
    room.matchmakingTickTimer = null;
  }
  room.matchmakingStartedAt = null;
  room.matchmakingEndsAt = null;
  room.matchmakingWaitMs = null;
}

/**
 * Hoàn tất tìm trận của phòng: điền thêm AI Bot nếu chưa đủ targetPlayers rồi bắt đầu trận đấu
 */
export function finalizeRoomMatchmakingAndStart(
  roomId: string,
  options: { autoStart?: boolean; difficulty?: BotDifficulty } = {}
): void {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room) return;

  clearRoomMatchmakingTimers(room);

  const humanMembers = Array.from(room.members.values()).filter(m => !isBotMember(m));
  if (humanMembers.length === 0) return;

  const mode: GameModeType = room.mode || 'QUICK_MATCH';
  const targetPlayers = room.targetPlayers || (mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);

  let game = gameSessions.get(targetId);
  if (!game && ioInstance) {
    game = new MimicGameSession(targetId, ioInstance, { gameMode: mode, targetPlayers });
    game.hostId = room.hostId;
    game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
    gameSessions.set(targetId, game);
  }

  let botsAdded = 0;
  if (room.members.size < targetPlayers) {
    const filled = fillRoomWithBots(targetId, {
      minPlayers: targetPlayers,
      difficulty: options.difficulty
    });
    botsAdded = filled.botsAdded;
  }

  let autoStarted = false;
  if (game && options.autoStart !== false) {
    game.gameMode = mode;
    game.targetPlayers = targetPlayers;
    game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
    autoStarted = game.startGame({ requireAllReady: false });
  }

  if (ioInstance && game) {
    const roomSnapshot = {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      mode,
      targetPlayers,
      members: getRoomMembersArray(room),
      messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
    };
    ioInstance.to(targetId).emit('match_found', {
      success: true,
      searching: false,
      mode,
      targetPlayers,
      matchedWithHumans: humanMembers.length > 1,
      timedOutToBots: botsAdded > 0,
      botsAdded,
      autoStarted,
      roomId: room.id,
      room: roomSnapshot,
      gameState: game.getStateSnapshot()
    });
  }
}

/**
 * Bắt đầu đếm ngược tìm người chơi mới cho một phòng (hỗ trợ cả Quick Match 4P & 1vs1 Race 2P,
 * kèm cộng giờ mềm Dynamic Queue Extension +5s khi có người mới vào, trần tối đa 16s)
 */
export function startRoomMatchmakingCountdown(
  roomId: string,
  options: {
    waitMs?: number;
    mode?: GameModeType;
    targetPlayers?: number;
    autoStart?: boolean;
    difficulty?: BotDifficulty;
  } = {}
): void {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room || !ioInstance) return;

  clearRoomMatchmakingTimers(room);

  const mode: GameModeType = options.mode || room.mode || 'QUICK_MATCH';
  const targetPlayers =
    options.targetPlayers || room.targetPlayers || (mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);
  room.mode = mode;
  room.targetPlayers = targetPlayers;

  const humanCount = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;
  if (humanCount >= targetPlayers) {
    finalizeRoomMatchmakingAndStart(targetId, { autoStart: options.autoStart, difficulty: options.difficulty });
    return;
  }

  const initialWaitMs =
    typeof options.waitMs === 'number' && options.waitMs >= 0 ? options.waitMs : DEFAULT_MATCHMAKING_WAIT_MS;
  if (initialWaitMs <= 0) {
    finalizeRoomMatchmakingAndStart(targetId, { autoStart: options.autoStart, difficulty: options.difficulty });
    return;
  }

  const now = Date.now();
  room.matchmakingStartedAt = now;
  room.matchmakingWaitMs = initialWaitMs;
  room.matchmakingEndsAt = now + initialWaitMs;

  const totalWaitSeconds = Math.max(1, Math.ceil(initialWaitMs / 1000));
  const initialMembers = getRoomMembersArray(room);

  ioInstance.to(targetId).emit('matchmaking_searching', {
    searching: true,
    state: 'FINDING_MATCH',
    roomId: targetId,
    mode,
    currentPlayers: humanCount,
    targetPlayers,
    members: initialMembers,
    waitMs: initialWaitMs,
    remainingMs: initialWaitMs,
    timeRemaining: totalWaitSeconds,
    elapsedSeconds: 0,
    totalWaitSeconds,
    totalDuration: totalWaitSeconds,
    progressPercent: 0,
    startedAt: now,
    endsAt: room.matchmakingEndsAt,
    timestamp: now,
    systemMessage: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
    messageCode: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
    messageParams: { waitSeconds: totalWaitSeconds, waitMs: initialWaitMs }
  });

  const emitRoomTick = () => {
    if (!room.matchmakingEndsAt || !room.matchmakingStartedAt || !ioInstance) return;
    const currentNow = Date.now();
    const remainingMs = Math.max(0, room.matchmakingEndsAt - currentNow);
    const timeRemaining = Math.ceil(remainingMs / 1000);
    const totalMs = Math.max(1000, room.matchmakingEndsAt - room.matchmakingStartedAt);
    const totalSec = Math.ceil(totalMs / 1000);
    const elapsedSeconds = Math.max(0, totalSec - timeRemaining);
    const currentHumans = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;

    ioInstance.to(targetId).emit('matchmaking_tick', {
      searching: true,
      state: 'FINDING_MATCH',
      roomId: targetId,
      mode,
      currentPlayers: currentHumans,
      targetPlayers,
      members: getRoomMembersArray(room),
      waitMs: totalMs,
      remainingMs,
      timeRemaining,
      elapsedSeconds,
      totalWaitSeconds: totalSec,
      totalDuration: totalSec,
      progressPercent: Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalSec) * 100))),
      startedAt: room.matchmakingStartedAt,
      endsAt: room.matchmakingEndsAt,
      timestamp: currentNow
    });
  };

  emitRoomTick();

  const scheduleEndTimeout = () => {
    if (room.matchmakingTimer) {
      clearTimeout(room.matchmakingTimer);
      room.matchmakingTimer = null;
    }
    const delayMs = Math.max(0, (room.matchmakingEndsAt || Date.now()) - Date.now());
    room.matchmakingTimer = setTimeout(() => {
      finalizeRoomMatchmakingAndStart(targetId, { autoStart: options.autoStart, difficulty: options.difficulty });
    }, delayMs);
    if (typeof room.matchmakingTimer.unref === 'function') {
      room.matchmakingTimer.unref();
    }
  };

  scheduleEndTimeout();

  if (initialWaitMs >= 1000) {
    room.matchmakingTickTimer = setInterval(emitRoomTick, 1000);
    if (typeof room.matchmakingTickTimer.unref === 'function') {
      room.matchmakingTickTimer.unref();
    }
  }
}

/**
 * Cộng giờ mềm (Dynamic Queue Extension) khi có thêm người chơi thật mới vào phòng đang tìm trận:
 * - Nếu đã đủ targetPlayers (4 người ở Quick Match, 2 người ở 1vs1 Race) -> Bắt đầu ngay lập tức!
 * - Nếu chưa đủ và đồng hồ còn < 5s (MATCHMAKING_EXTEND_MS) -> Đẩy đồng hồ lên 5s (nhưng tổng thời gian chờ không quá 16s MATCHMAKING_MAX_WAIT_CAP_MS).
 */
export function extendRoomMatchmakingOnPlayerJoin(roomId: string): {
  extended: boolean;
  startedImmediately: boolean;
  remainingMs: number;
} {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room || !room.matchmakingEndsAt || !room.matchmakingStartedAt) {
    return { extended: false, startedImmediately: false, remainingMs: 0 };
  }

  const mode: GameModeType = room.mode || 'QUICK_MATCH';
  const targetPlayers = room.targetPlayers || (mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);
  const humanCount = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;

  if (humanCount >= targetPlayers) {
    finalizeRoomMatchmakingAndStart(targetId, { autoStart: true });
    return { extended: false, startedImmediately: true, remainingMs: 0 };
  }

  const now = Date.now();
  const currentRemainingMs = Math.max(0, room.matchmakingEndsAt - now);
  const maxAllowedEndsAt = room.matchmakingStartedAt + MATCHMAKING_MAX_WAIT_CAP_MS;

  let extended = false;
  let extendedBonusMs = 0;
  if (currentRemainingMs < MATCHMAKING_EXTEND_MS && now < maxAllowedEndsAt) {
    const newEndsAt = Math.min(maxAllowedEndsAt, now + MATCHMAKING_EXTEND_MS);
    if (newEndsAt > room.matchmakingEndsAt) {
      extendedBonusMs = newEndsAt - room.matchmakingEndsAt;
      room.matchmakingEndsAt = newEndsAt;
      extended = true;
      if (room.matchmakingTimer) {
        clearTimeout(room.matchmakingTimer);
      }
      const newDelay = Math.max(0, room.matchmakingEndsAt - now);
      room.matchmakingTimer = setTimeout(() => {
        finalizeRoomMatchmakingAndStart(targetId, { autoStart: true });
      }, newDelay);
      if (typeof room.matchmakingTimer.unref === 'function') {
        room.matchmakingTimer.unref();
      }
    }
  }

  const finalRemainingMs = Math.max(0, room.matchmakingEndsAt - now);
  if (ioInstance) {
    const timeRemaining = Math.ceil(finalRemainingMs / 1000);
    const totalMs = Math.max(1000, room.matchmakingEndsAt - room.matchmakingStartedAt);
    const totalSec = Math.ceil(totalMs / 1000);
    const elapsedSeconds = Math.max(0, totalSec - timeRemaining);
    const membersList = getRoomMembersArray(room);
    const tickPayload = {
      searching: true,
      state: 'FINDING_MATCH',
      roomId: targetId,
      mode,
      extended,
      extendedBonusSeconds: extended ? Math.ceil(extendedBonusMs / 1000) : 0,
      currentPlayers: humanCount,
      targetPlayers,
      members: membersList,
      waitMs: totalMs,
      remainingMs: finalRemainingMs,
      timeRemaining,
      elapsedSeconds,
      totalWaitSeconds: totalSec,
      totalDuration: totalSec,
      progressPercent: Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalSec) * 100))),
      startedAt: room.matchmakingStartedAt,
      endsAt: room.matchmakingEndsAt,
      timestamp: now
    };
    ioInstance.to(targetId).emit('matchmaking_tick', tickPayload);
    ioInstance.to(targetId).emit('matchmaking_player_joined', tickPayload);
  }

  return { extended, startedImmediately: false, remainingMs: finalRemainingMs };
}

/**
 * Tự động hút (drain) các User đang đứng chờ sẵn trong matchmakingQueue (cùng mode) vào ghế trống của phòng
 */
export function drainMatchmakingQueueIntoRoom(roomId: string): number {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  if (!room) return 0;

  const mode: GameModeType = room.mode || 'QUICK_MATCH';
  if (mode !== 'QUICK_MATCH' && mode !== 'RACE_1V1') return 0;

  const targetPlayers =
    room.targetPlayers || (mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);
  if (room.members.size >= targetPlayers) return 0;

  let game = gameSessions.get(targetId);
  if (!game && ioInstance) {
    game = new MimicGameSession(targetId, ioInstance, { gameMode: mode, targetPlayers });
    game.hostId = room.hostId;
    game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
    gameSessions.set(targetId, game);
  }

  let drainedCount = 0;
  for (const [peerSockId, entry] of Array.from(matchmakingQueue.entries())) {
    if (room.members.size >= targetPlayers) break;
    if (room.members.has(peerSockId)) continue;
    const entryMode: GameModeType = entry.mode === 'RACE_1V1' ? 'RACE_1V1' : 'QUICK_MATCH';
    if (entryMode !== mode) continue;

    cancelMatchmakingForSocket(peerSockId);
    const u = entry.sessionState.currentUser;
    entry.sessionState.currentRoomId = room.id;
    u.socketId = entry.socket.id;
    u.userId = entry.userId;
    u.userName = entry.userName;
    u.avatar = entry.avatar;
    u.role = room.members.size === 0 ? 'HOST' : 'PLAYER';
    u.isReady = true;
    u.isAuthenticated = true;
    u.joinedAt = Date.now();

    entry.socket.join(room.id);
    room.members.set(entry.socket.id, u);
    if (game) {
      game.addPlayer(entry.socket.id, u.userName, u.avatar, u.role, u.userId, true);
    }
    drainedCount++;

    const membersList = getRoomMembersArray(room);
    const roomSnapshot = {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      mode,
      targetPlayers,
      members: membersList,
      messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
    };
    const payload = {
      success: true,
      searching: room.members.size < targetPlayers,
      mode,
      targetPlayers,
      matchedWithHumans: true,
      botsAdded: 0,
      autoStarted: false,
      roomId: room.id,
      room: roomSnapshot,
      user: u,
      gameState: game ? game.getStateSnapshot() : null
    };
    entry.socket.emit('joined_room_success', payload);
    entry.socket.emit('match_found', payload);
    if (entry.onResolved) {
      const cb = entry.onResolved;
      entry.onResolved = undefined;
      cb(payload);
    }
    if (ioInstance) {
      ioInstance.to(room.id).emit('user_joined', {
        user: u,
        members: membersList,
        systemMessage: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
        messageCode: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
        messageParams: { userName: u.userName, role: u.role }
      });
    }
  }

  return drainedCount;
}

/**
 * Mở lại phòng sau khi kết thúc trận (GAME_OVER) ở chế độ Quick Match hoặc 1vs1 Race:
 * - Xóa các AI Bot cũ để giải phóng ghế trống cho người chơi thật mới vào.
 * - Tự động hút ngay các User đang chờ sẵn trong matchmakingQueue vào ghế trống (Queue Draining).
 * - Đặt lại trạng thái game về IDLE và bật đồng hồ đếm ngược tìm người chơi mới (nếu hết giờ chờ thì tự bù Bot và bắt đầu ván mới).
 */
export function reopenRoomForMatchmaking(roomId: string, waitMs: number = DEFAULT_MATCHMAKING_WAIT_MS): void {
  const targetId = String(roomId || '').trim().toUpperCase();
  const room = rooms.get(targetId);
  const game = gameSessions.get(targetId);
  if (!room || !game) return;

  const mode: GameModeType = room.mode || game.gameMode || 'QUICK_MATCH';
  if (mode !== 'QUICK_MATCH' && mode !== 'RACE_1V1') return;

  const humanMembers = Array.from(room.members.values()).filter(m => !isBotMember(m));
  if (humanMembers.length === 0) return;

  // Xóa các Bot cũ để nhường ghế tìm người chơi thật mới
  for (const [memberId, member] of Array.from(room.members.entries())) {
    if (isBotMember(member)) {
      room.members.delete(memberId);
      game.players.delete(memberId);
    }
  }

  game.stopTimer();
  game.state = 'IDLE';

  const targetPlayers = mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS;
  room.mode = mode;
  room.targetPlayers = targetPlayers;

  // Hút ngay các User đang chờ sẵn trong matchmakingQueue vào ghế trống của phòng vừa mở lại!
  const drained = drainMatchmakingQueueIntoRoom(targetId);
  const currentHumans = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;

  console.log(
    `[Matchmaking] 🔄 Phòng ${targetId} (${mode}) mở lại sau trận (Đã hút ${drained} người từ Queue -> ${currentHumans}/${targetPlayers} người thật, chờ ${waitMs}ms)...`
  );

  startRoomMatchmakingCountdown(targetId, {
    waitMs,
    mode,
    targetPlayers,
    autoStart: true
  });
}

/**
 * Tìm phòng đang chờ (IDLE) có người chơi thật và còn chỗ trống để ghép trận nhanh (Smart Matchmaking):
 * - Cách ly tuyệt đối phòng riêng (CUSTOM_ROOM) khỏi bể ghép ngẫu nhiên (QUICK_MATCH / RACE_1V1).
 * - Sắp xếp ưu tiên Best-Fit + FIFO:
 *     1. Ưu tiên phòng có nhiều người thật nhất trước (3/4 > 2/4 > 1/4) để chốt đủ 4 người nhanh nhất.
 *     2. Nếu bằng số người thì ưu tiên phòng đã chờ lâu hơn trước (FIFO).
 */
export function findAvailableMatchmakingRoom(
  excludeSocketId?: string,
  requestedMode: GameModeType = 'QUICK_MATCH'
): RoomData | null {
  const candidates: Array<{ room: RoomData; humanCount: number; waitStart: number }> = [];

  for (const room of rooms.values()) {
    // Cách ly phòng riêng (CUSTOM_ROOM): chỉ ghép vào phòng có mode khớp chính xác với requestedMode
    const roomMode: GameModeType = room.mode || 'CUSTOM_ROOM';
    if (roomMode !== requestedMode) continue;

    const maxForRoom =
      room.targetPlayers ||
      (roomMode === 'RACE_1V1' ? RACE_1V1_PLAYERS : MAX_MEMBERS_PER_ROOM);
    if (room.members.size >= maxForRoom) continue;
    if (excludeSocketId && room.members.has(excludeSocketId)) continue;

    const game = gameSessions.get(room.id);
    const isIdle = !game || game.state === 'IDLE';
    if (!isIdle) continue;

    const humanCount = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;
    if (humanCount > 0) {
      candidates.push({
        room,
        humanCount,
        waitStart: room.matchmakingStartedAt || room.createdAt || 0
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.humanCount !== a.humanCount) {
      return b.humanCount - a.humanCount; // Best-Fit: 3/4 > 2/4 > 1/4
    }
    return a.waitStart - b.waitStart; // FIFO: phòng chờ lâu hơn được ưu tiên trước
  });

  return candidates[0].room;
}

/**
 * Lấy danh sách thành viên trong phòng dưới dạng mảng an toàn để gửi qua Socket
 */
export function getRoomMembersArray(room?: RoomData | null): RoomMember[] {
  if (!room || !room.members) return [];
  return Array.from(room.members.values()).map(m => ({
    socketId: m.socketId,
    userId: m.userId || null,
    userName: m.userName,
    avatar: m.avatar,
    role: m.socketId === room.hostId ? 'HOST' : (m.role || 'PLAYER'),
    isReady: m.socketId === room.hostId || m.isBot ? true : (m.isReady || false),
    isBot: Boolean(m.isBot),
    botDifficulty: m.botDifficulty || null,
    joinedAt: m.joinedAt
  }));
}

/**
 * XÓA SẠCH TOÀN BỘ DỮ LIỆU CỦA PHÒNG KHỎI RAM (Khi đóng phòng hoặc phòng giải tán)
 */
export function destroyRoomData(
  roomId: string,
  reason: string = RoomCloseReasonCode.ROOM_CLOSED,
  notifyMessage: string | null = null,
  notifyParams: Record<string, unknown> = {}
): boolean {
  const targetId = String(roomId || '').trim().toUpperCase();
  if (!targetId) return false;

  const room = rooms.get(targetId);
  const game = gameSessions.get(targetId);

  if (!room && !game) return false;

  // 1. Thông báo cho tất cả thành viên còn trong phòng (nếu có) trước khi đóng
  if (notifyMessage && ioInstance) {
    ioInstance.to(targetId).emit('room_closed', {
      roomId: targetId,
      reason,
      message: notifyMessage,
      messageCode: notifyMessage,
      messageParams: notifyParams,
      timestamp: Date.now()
    });
  }

  // 2. Tách tất cả các socket đang kết nối ra khỏi room
  if (room && room.members && ioInstance) {
    for (const [sockId] of room.members.entries()) {
      const sock = ioInstance.sockets.sockets.get(sockId);
      if (sock) {
        sock.leave(targetId);
      }
    }
    room.members.clear();
  } else if (room && room.members) {
    room.members.clear();
  }

  // 3. Hủy timer dọn phòng, timer matchmaking và xóa sạch mảng lịch sử tin nhắn/audio chat
  if (room) {
    clearRoomMatchmakingTimers(room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    if (Array.isArray(room.messages)) {
      room.messages.length = 0;
    }
    rooms.delete(targetId);
  }

  // 4. Hủy toàn bộ trạng thái Game Engine, Timer và giải phóng Buffer âm thanh
  if (game) {
    game.destroy();
    gameSessions.delete(targetId);
  }

  console.log(`[RoomCleanup] 🧹 Đã xóa sạch toàn bộ dữ liệu phòng "${targetId}" khỏi RAM (Lý do: ${reason})`);
  return true;
}

/**
 * Xử lý khi 1 socket rời khỏi phòng hiện tại (hỗ trợ Host Migration & Empty Room Cleanup)
 */
export function leaveCurrentRoom(sock: Socket, roomId: string, fallbackUser: Partial<RoomMember> = {}): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const leavingMember = room.members.get(sock.id) || fallbackUser;

  sock.leave(roomId);
  room.members.delete(sock.id);

  const game = gameSessions.get(roomId);
  if (game) {
    game.removePlayer(sock.id);
  }

  console.log(`[Room] 🚪 ${leavingMember.userName || sock.id} (${sock.id}) đã rời phòng: ${roomId}`);

  // Kiểm tra số người chơi thật (không tính AI Bot) còn lại trong phòng
  const remainingHumans = Array.from(room.members.values()).filter(m => !isBotMember(m));

  // Nếu không còn người chơi thật nào trong phòng: xóa toàn bộ Bot, audio buffer & chat, lên lịch hủy phòng
  if (remainingHumans.length === 0) {
    clearRoomMatchmakingTimers(room);
    for (const [botId] of room.members.entries()) {
      room.members.delete(botId);
      if (game) game.removePlayer(botId);
    }
    room.messages.length = 0;
    if (game) {
      game.stopTimer();
      game.clearRoundAudioData();
      if (game.disconnectedPlayers.size === 0) {
        destroyRoomData(roomId, RoomCloseReasonCode.ALL_MEMBERS_LEFT);
        return;
      }
    }

    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      const checkRoom = rooms.get(roomId);
      const checkHumans = checkRoom
        ? Array.from(checkRoom.members.values()).filter(m => !isBotMember(m))
        : [];
      if (checkRoom && checkHumans.length === 0) {
        destroyRoomData(roomId, RoomCloseReasonCode.EMPTY_ROOM_TIMEOUT);
      }
    }, ROOM_CLEANUP_DELAY_MS);
    return;
  }

  // Host Migration (chỉ chuyển giao quyền Chủ phòng cho người chơi thật, không chuyển cho Bot)
  let newHostInfo: { newHostId: string; newHostName: string } | null = null;
  if (room.hostId === sock.id && remainingHumans.length > 0) {
    const nextHost = remainingHumans[0];
    if (nextHost) {
      room.hostId = nextHost.socketId;
      room.hostUserId = nextHost.userId || null;
      nextHost.role = 'HOST';
      nextHost.isReady = true;

      if (game) {
        game.setHost(room.hostId);
      }

      newHostInfo = {
        newHostId: room.hostId,
        newHostName: nextHost.userName
      };
      console.log(`[Room] 👑 Host Migration: ${nextHost.userName} (${room.hostId}) trở thành Chủ phòng mới!`);
    }
  }

  const updatedMembers = getRoomMembersArray(room);

  sock.to(roomId).emit('user_left', {
    user: leavingMember,
    members: updatedMembers,
    systemMessage: SystemMessageCode.SYS_USER_LEFT_ROOM,
    messageCode: SystemMessageCode.SYS_USER_LEFT_ROOM,
    messageParams: { userName: leavingMember.userName || sock.id }
  });

  if (newHostInfo && ioInstance) {
    ioInstance.to(roomId).emit('host_changed', {
      newHostId: newHostInfo.newHostId,
      newHostName: newHostInfo.newHostName,
      members: updatedMembers,
      systemMessage: SystemMessageCode.SYS_HOST_CHANGED,
      messageCode: SystemMessageCode.SYS_HOST_CHANGED,
      messageParams: { newHostName: newHostInfo.newHostName }
    });
  }

  // Nếu phòng đang trong giai đoạn đếm ngược tìm trận (FINDING_MATCH), cập nhật ngay số lượng người chơi mới xuống Client
  if (room.matchmakingEndsAt && room.matchmakingStartedAt && ioInstance) {
    const now = Date.now();
    const remainingMs = Math.max(0, room.matchmakingEndsAt - now);
    const timeRemaining = Math.ceil(remainingMs / 1000);
    const totalMs = Math.max(1000, room.matchmakingEndsAt - room.matchmakingStartedAt);
    const totalSec = Math.ceil(totalMs / 1000);
    const elapsedSeconds = Math.max(0, totalSec - timeRemaining);
    const mode: GameModeType = room.mode || 'QUICK_MATCH';
    const targetPlayers = room.targetPlayers || (mode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);
    ioInstance.to(roomId).emit('matchmaking_tick', {
      searching: true,
      state: 'FINDING_MATCH',
      roomId,
      mode,
      currentPlayers: remainingHumans.length,
      targetPlayers,
      members: updatedMembers,
      waitMs: totalMs,
      remainingMs,
      timeRemaining,
      elapsedSeconds,
      totalWaitSeconds: totalSec,
      totalDuration: totalSec,
      progressPercent: Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalSec) * 100))),
      startedAt: room.matchmakingStartedAt,
      endsAt: room.matchmakingEndsAt,
      timestamp: now
    });
  }
}

/**
 * Định kỳ mỗi 60s dọn dẹp các dữ liệu rớt mạng quá hạn (> 120s), Challenge Nonce hết hạn và phòng mồ côi
 */
export function startPeriodicGcTimer(): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    const now = Date.now();

    // 1. Dọn dẹp Challenge Nonce quá hạn (> 30s)
    for (const [nonce, record] of challengeNonces.entries()) {
      if (now - record.createdAt > CHALLENGE_TTL_MS) {
        challengeNonces.delete(nonce);
      }
    }

    // 2. Dọn dẹp dữ liệu người chơi rớt mạng quá hạn (> 120s) và phòng mồ côi
    for (const [roomId, game] of gameSessions.entries()) {
      if (game && game.disconnectedPlayers) {
        for (const [uid, saved] of game.disconnectedPlayers.entries()) {
          if (now - saved.disconnectedAt > 120000) {
            game.disconnectedPlayers.delete(uid);
          }
        }
      }
      const room = rooms.get(roomId);
      const humanCount = room
        ? Array.from(room.members.values()).filter(m => !isBotMember(m)).length
        : 0;
      if (!room || (humanCount === 0 && !room.cleanupTimer)) {
        destroyRoomData(roomId, RoomCloseReasonCode.GC_ORPHAN_ROOM);
      }
    }
  }, 60000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}
