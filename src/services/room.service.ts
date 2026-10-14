import { Server, Socket } from 'socket.io';
import { ROOM_CLEANUP_DELAY_MS, CHALLENGE_TTL_MS } from '../config/constants';
import { RoomCloseReasonCode, SystemMessageCode } from '../config/messages';
import { challengeNonces } from './auth.service';
import { MimicGameSession } from '../game/MimicGameSession';
import { RoomData, RoomMember } from '../types';

// In-Memory Database Quản Lý Phòng & Game Sessions
export const rooms = new Map<string, RoomData>();
export const gameSessions = new Map<string, MimicGameSession>();

let ioInstance: Server | null = null;

export function setIoInstance(io: Server): void {
  ioInstance = io;
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
    isReady: m.socketId === room.hostId ? true : (m.isReady || false),
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

  // Nếu phòng trống (0 người): xóa ngay audio buffer & chat, lên lịch hủy phòng
  if (room.members.size === 0) {
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
      if (checkRoom && checkRoom.members.size === 0) {
        destroyRoomData(roomId, RoomCloseReasonCode.EMPTY_ROOM_TIMEOUT);
      }
    }, ROOM_CLEANUP_DELAY_MS);
    return;
  }

  // Host Migration (chuyển giao quyền Chủ phòng khi phòng vẫn còn người)
  let newHostInfo: { newHostId: string; newHostName: string } | null = null;
  if (room.hostId === sock.id && room.members.size > 0) {
    const nextHost = room.members.values().next().value;
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
      if (!room || (room.members.size === 0 && !room.cleanupTimer)) {
        destroyRoomData(roomId, RoomCloseReasonCode.GC_ORPHAN_ROOM);
      }
    }
  }, 60000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}
