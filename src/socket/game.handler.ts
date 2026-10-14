import { Server } from 'socket.io';
import { ErrorCode, SystemMessageCode } from '../config/messages';
import { rooms, gameSessions } from '../services/room.service';
import { AuthenticatedSocket, SocketSessionState } from '../types';

export function registerGameHandlers(
  io: Server,
  socket: AuthenticatedSocket,
  sessionState: SocketSessionState,
  checkRateLimit: (action: string, maxCount: number, windowMs: number) => boolean
): void {
  const { currentUser } = sessionState;

  // 1. BẮT ĐẦU TRẬN ĐẤU (game_start)
  socket.on(
    'game_start',
    ({ roomId, requireAllReady = false }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      if (!targetRoom) {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_NOT_JOINED,
            message: ErrorCode.ROOM_NOT_JOINED
          });
        }
        return;
      }
      const room = rooms.get(targetRoom);
      if (!room) {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_NOT_FOUND,
            message: ErrorCode.ROOM_NOT_FOUND
          });
        }
        return;
      }

      if (room.hostId !== socket.id) {
        socket.emit('game_error', {
          code: ErrorCode.GAME_HOST_ONLY_START,
          message: ErrorCode.GAME_HOST_ONLY_START
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_HOST_ONLY_START,
            message: ErrorCode.GAME_HOST_ONLY_START
          });
        }
        return;
      }

      if (requireAllReady) {
        const unreadyMembers = Array.from(room.members.values()).filter(
          m => m.socketId !== room.hostId && !m.isReady
        );
        if (unreadyMembers.length > 0) {
          const unreadyUserNames = unreadyMembers.map(m => m.userName);
          const errPayload = {
            code: ErrorCode.GAME_PLAYERS_NOT_READY,
            message: ErrorCode.GAME_PLAYERS_NOT_READY,
            messageParams: { unreadyPlayers: unreadyUserNames }
          };
          socket.emit('game_error', errPayload);
          if (callback) callback({ success: false, ...errPayload });
          return;
        }
      }

      const game = gameSessions.get(targetRoom);
      if (game) {
        console.log(`[MimicParty] 🚀 Host ${socket.id} (${currentUser.userName}) khởi động trận đấu trong phòng ${targetRoom}`);
        const started = game.startGame({ requireAllReady: Boolean(requireAllReady) });
        if (callback) callback({ success: started });
      }
    }
  );

  // 2. CẬP NHẬT CẤU HÌNH TRẬN ĐẤU (game_update_config)
  socket.on(
    'game_update_config',
    (
      { roomId, totalRounds, recordDuration, useCustomRecordDuration }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const room = rooms.get(targetRoom);
      if (!room || room.hostId !== socket.id) {
        socket.emit('game_error', {
          code: ErrorCode.GAME_HOST_ONLY_CONFIG,
          message: ErrorCode.GAME_HOST_ONLY_CONFIG
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_HOST_ONLY_CONFIG,
            message: ErrorCode.GAME_HOST_ONLY_CONFIG
          });
        }
        return;
      }

      const game = gameSessions.get(targetRoom);
      if (game) {
        const ok = game.updateConfig({ totalRounds, recordDuration, useCustomRecordDuration });
        if (ok) {
          io.to(targetRoom).emit('game_config_changed', {
            totalRounds: game.totalRounds,
            recordDuration: game.recordDuration,
            useCustomRecordDuration: game.useCustomRecordDuration,
            updatedBy: socket.id,
            systemMessage: SystemMessageCode.SYS_GAME_CONFIG_UPDATED,
            messageCode: SystemMessageCode.SYS_GAME_CONFIG_UPDATED,
            messageParams: {
              totalRounds: game.totalRounds,
              recordDuration: game.recordDuration
            }
          });
          if (callback) callback({ success: true, totalRounds: game.totalRounds, recordDuration: game.recordDuration });
        } else {
          if (callback) {
            callback({
              success: false,
              code: ErrorCode.GAME_CONFIG_LOCKED_IN_PROGRESS,
              message: ErrorCode.GAME_CONFIG_LOCKED_IN_PROGRESS
            });
          }
        }
      }
    }
  );

  // 3. NỘP BÀI THU ÂM NHẠI GIỌNG (game_submit_audio)
  socket.on(
    'game_submit_audio',
    (
      { roomId, audioData, mimeType, metrics }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      if (!targetRoom) {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_NOT_JOINED,
            message: ErrorCode.ROOM_NOT_JOINED
          });
        }
        return;
      }
      const game = gameSessions.get(targetRoom);
      if (game) {
        const res = game.submitMimicAudio(socket.id, audioData, mimeType, metrics);
        if (callback) callback(res);
      } else {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_NOT_FOUND,
            message: ErrorCode.GAME_NOT_FOUND
          });
        }
      }
    }
  );

  // 4. BÁO PHÁT XONG AUDIO MẪU (sample_playback_done)
  socket.on('sample_playback_done', ({ roomId }: Record<string, any> = {}) => {
    const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom) return;
    const game = gameSessions.get(targetRoom);
    if (game) {
      game.handleSamplePlaybackDone(socket.id);
    }
  });

  // 5. THẢ EMOJI REACTION (game_emoji_reaction)
  socket.on('game_emoji_reaction', ({ roomId, emoji }: Record<string, any> = {}) => {
    const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom || !emoji) return;
    if (!checkRateLimit('emoji', 5, 1000)) return;
    socket.to(targetRoom).emit('game_reaction_broadcast', String(emoji).slice(0, 8));
  });

  // 6. XÁC NHẬN SẴN SÀNG QUA VÒNG MỚI (confirm_next_round_ready)
  socket.on(
    'confirm_next_round_ready',
    ({ roomId }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const game = gameSessions.get(targetRoom);
      if (game) {
        const res = game.confirmRoundReady(socket.id);
        if (callback) callback(res);
      } else {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_NOT_FOUND,
            message: ErrorCode.GAME_NOT_FOUND
          });
        }
      }
    }
  );

  // 7. BỎ QUA SHOWDOWN SỚM (skip_to_round_result & confirm_showdown_skip)
  socket.on(
    'skip_to_round_result',
    ({ roomId }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const game = gameSessions.get(targetRoom);
      if (game) {
        const res = game.confirmShowdownSkip(socket.id);
        if (callback) callback(res);
      } else {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_NOT_FOUND,
            message: ErrorCode.GAME_NOT_FOUND
          });
        }
      }
    }
  );

  socket.on(
    'confirm_showdown_skip',
    ({ roomId }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const game = gameSessions.get(targetRoom);
      if (game) {
        const res = game.confirmShowdownSkip(socket.id);
        if (callback) callback(res);
      } else {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.GAME_NOT_FOUND,
            message: ErrorCode.GAME_NOT_FOUND
          });
        }
      }
    }
  );

  // 8. LẤY SNAPSHOT STATE HIỆN TẠI (get_game_state)
  socket.on(
    'get_game_state',
    ({ roomId }: Record<string, any> = {}, callback?: (res: Record<string, unknown> | null) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const game = gameSessions.get(targetRoom);
      if (callback) {
        callback(game ? game.getStateSnapshot() : null);
      }
    }
  );
}
