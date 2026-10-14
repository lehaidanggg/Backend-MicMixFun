import { Server, Socket } from 'socket.io';
import { ROOM_CLEANUP_DELAY_MS, CHALLENGE_TTL_MS, MAX_MEMBERS_PER_ROOM } from '../config/constants';
import { ErrorCode, RoomCloseReasonCode, SystemMessageCode } from '../config/messages';
import { challengeNonces } from './auth.service';
import { MimicGameSession } from '../game/MimicGameSession';
import { BotDifficulty, MatchmakingQueueEntry, RoomData, RoomMember } from '../types';

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
  options: { difficulty?: BotDifficulty; botName?: string; avatar?: string } = {}
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

  const rawDiff = String(options.difficulty || 'NORMAL').toUpperCase();
  const difficulty: BotDifficulty =
    rawDiff === 'EASY' || rawDiff === 'HARD' ? (rawDiff as BotDifficulty) : 'NORMAL';

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
    difficulty?: BotDifficulty;
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
    const diff: BotDifficulty =
      options.difficulty && ['EASY', 'NORMAL', 'HARD'].includes(String(options.difficulty).toUpperCase())
        ? (String(options.difficulty).toUpperCase() as BotDifficulty)
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

/**
 * Tìm phòng đang chờ (IDLE) có người chơi thật và còn chỗ trống để ghép trận nhanh (Matchmaking)
 */
export function findAvailableMatchmakingRoom(excludeSocketId?: string): RoomData | null {
  for (const room of rooms.values()) {
    if (room.members.size >= MAX_MEMBERS_PER_ROOM) continue;
    if (excludeSocketId && room.members.has(excludeSocketId)) continue;

    const game = gameSessions.get(room.id);
    const isIdle = !game || game.state === 'IDLE';
    if (!isIdle) continue;

    const humanCount = Array.from(room.members.values()).filter(m => !isBotMember(m)).length;
    if (humanCount > 0) {
      return room;
    }
  }
  return null;
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

  // 3. Hủy timer dọn phòng và xóa sạch mảng lịch sử tin nhắn/audio chat
  if (room) {
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

  sock.to(roomId).emit('user_left', {
    user: leavingMember,
    members: getRoomMembersArray(room),
    systemMessage: SystemMessageCode.SYS_USER_LEFT_ROOM,
    messageCode: SystemMessageCode.SYS_USER_LEFT_ROOM,
    messageParams: { userName: leavingMember.userName || sock.id }
  });

  if (newHostInfo && ioInstance) {
    ioInstance.to(roomId).emit('host_changed', {
      newHostId: newHostInfo.newHostId,
      newHostName: newHostInfo.newHostName,
      members: getRoomMembersArray(room),
      systemMessage: SystemMessageCode.SYS_HOST_CHANGED,
      messageCode: SystemMessageCode.SYS_HOST_CHANGED,
      messageParams: { newHostName: newHostInfo.newHostName }
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
