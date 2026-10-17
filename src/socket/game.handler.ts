import { Server } from 'socket.io';
import { DEFAULT_MIN_PLAYERS_WITH_BOTS } from '../config/constants';
import { ErrorCode, SystemMessageCode } from '../config/messages';
import { rooms, gameSessions, fillRoomWithBots, isBotMember } from '../services/room.service';
import { AuthenticatedSocket, BotDifficulty, SocketSessionState } from '../types';

export function registerGameHandlers(
  io: Server,
  socket: AuthenticatedSocket,
  sessionState: SocketSessionState,
  checkRateLimit: (action: string, maxCount: number, windowMs: number) => boolean
): void {
  const { currentUser } = sessionState;

  // 1. BẮT ĐẦU TRẬN ĐẤU (game_start / fill_bots_and_start / matchmaking_timeout)
  // Mặc định nếu không tìm thấy đủ người chơi, tự động thêm vài AI Bot (cho đủ 4 người chơi) để bắt đầu gameplay
  const handleStartGameWithBots = (
    {
      roomId,
      requireAllReady = false,
      autoFillBots,
      minPlayers = DEFAULT_MIN_PLAYERS_WITH_BOTS,
      botCount,
      botDifficulty
    }: Record<string, any> = {},
    callback?: (res: Record<string, unknown>) => void,
    forceFillDefault = false
  ): void => {
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
    room.lastActivityAt = Date.now();

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
        m => m.socketId !== room.hostId && !isBotMember(m) && !m.isReady
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

    // Với CUSTOM_ROOM đã có từ 2 thành viên trở lên (VD: nhóm bạn 2-3 người tự đấu với nhau):
    // chỉ tự bù thêm AI Bot nếu Host truyền rõ autoFillBots=true, botCount > 0 hoặc gọi qua fill_bots_and_start.
    // Ngược lại nếu chỉ có 1 mình Host (room.members.size < 2) và không tắt autoFillBots thì tự thêm Bot cho đủ 4 người.
    const isCustomRoomWithMultipleMembers =
      (room.mode || 'CUSTOM_ROOM') === 'CUSTOM_ROOM' && room.members.size >= 2;
    const shouldAutoFill =
      typeof autoFillBots === 'boolean'
        ? autoFillBots
        : (forceFillDefault || !isCustomRoomWithMultipleMembers);

    let botsAdded = 0;
    const difficulty = botDifficulty ? (String(botDifficulty).toUpperCase() as BotDifficulty) : undefined;
    if (typeof botCount === 'number' && botCount > 0) {
      const filled = fillRoomWithBots(targetRoom, { botCount, difficulty });
      botsAdded = filled.botsAdded;
    } else if (shouldAutoFill) {
      const filled = fillRoomWithBots(targetRoom, {
        minPlayers: Number(minPlayers) || DEFAULT_MIN_PLAYERS_WITH_BOTS,
        difficulty
      });
      botsAdded = filled.botsAdded;
    }

    const game = gameSessions.get(targetRoom);
    if (game) {
      console.log(
        `[MimicParty] 🚀 Host ${socket.id} (${currentUser.userName}) khởi động trận đấu trong phòng ${targetRoom} (Tổng: ${room.members.size} người, đã tự thêm ${botsAdded} Bot)`
      );
      const started = game.startGame({ requireAllReady: Boolean(requireAllReady) });
      if (callback) {
        callback({
          success: started,
          botsAdded,
          totalPlayers: room.members.size
        });
      }
    }
  };

  socket.on('game_start', (data, cb) => handleStartGameWithBots(data, cb, false));
  socket.on('fill_bots_and_start', (data, cb) => handleStartGameWithBots(data, cb, true));
  socket.on('matchmaking_timeout', (data, cb) => handleStartGameWithBots(data, cb, true));

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

  // 3. NỘP BÀI THU ÂM NHẠI GIỌNG CỦA USER HOẶC BOT (game_submit_audio)
  socket.on(
    'game_submit_audio',
    (
      { roomId, botSocketId, audioData, mimeType, metrics }: Record<string, any> = {},
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
        // Nếu Client gửi kèm botSocketId trong game_submit_audio -> tự động chấm điểm & lưu audio cho Bot đó
        if (botSocketId) {
          const botRes = game.submitBotAudio(socket.id, String(botSocketId), audioData, mimeType, metrics);
          if (callback) callback(botRes);
          return;
        }
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

  // 3b. NỘP BÀI AUDIO ĐÃ RENDER HỘ CHO AI BOT ĐƯỢC PHÂN CÔNG & CHẤM ĐIỂM TRÊN SERVER (game_submit_bot_audio)
  socket.on(
    'game_submit_bot_audio',
    (
      { roomId, botSocketId, audioData, mimeType, metrics }: Record<string, any> = {},
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
        const res = game.submitBotAudio(socket.id, String(botSocketId || ''), audioData, mimeType, metrics);
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

  // 6. XÁC NHẬN SẴN SÀNG QUA VÒNG MỚI / BẤM "FINISH ROUND" / "NEW ROUND NOW" (confirm_next_round_ready & new_round_now)
  const handleConfirmNextRoundReady = (
    { roomId }: Record<string, any> = {},
    callback?: (res: Record<string, unknown>) => void
  ): void => {
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
  };

  socket.on('confirm_next_round_ready', handleConfirmNextRoundReady);
  socket.on('new_round_now', handleConfirmNextRoundReady);

  // 7. BẤM "FINISH ROUND ▶" TẠI MÀN SHOWDOWN REVEAL (confirm_showdown_skip / skip_to_round_result / finish_round)
  const handleConfirmShowdownSkip = (
    { roomId }: Record<string, any> = {},
    callback?: (res: Record<string, unknown>) => void
  ): void => {
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
  };

  socket.on('skip_to_round_result', handleConfirmShowdownSkip);
  socket.on('confirm_showdown_skip', handleConfirmShowdownSkip);
  socket.on('finish_round', handleConfirmShowdownSkip);

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
