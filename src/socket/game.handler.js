const { rooms, gameSessions } = require('../services/room.service');

function registerGameHandlers(io, socket, sessionState, checkRateLimit) {
  const { currentUser } = sessionState;

  // 1. BẮT ĐẦU TRẬN ĐẤU (game_start)
  socket.on('game_start', ({ roomId, requireAllReady = false } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom) {
      if (callback) callback({ success: false, message: 'Chưa vào phòng!' });
      return;
    }
    const room = rooms.get(targetRoom);
    if (!room) {
      if (callback) callback({ success: false, message: 'Phòng không tồn tại!' });
      return;
    }

    if (room.hostId !== socket.id) {
      const errorMsg = 'Chỉ có Chủ phòng (Host) mới có quyền bắt đầu trận đấu!';
      socket.emit('game_error', { message: errorMsg });
      if (callback) callback({ success: false, message: errorMsg });
      return;
    }

    if (requireAllReady) {
      const unreadyMembers = Array.from(room.members.values()).filter(m => m.socketId !== room.hostId && !m.isReady);
      if (unreadyMembers.length > 0) {
        const names = unreadyMembers.map(m => m.userName).join(', ');
        const errorMsg = `Chưa thể bắt đầu! Còn thành viên chưa sẵn sàng: ${names}`;
        socket.emit('game_error', { message: errorMsg });
        if (callback) callback({ success: false, message: errorMsg });
        return;
      }
    }

    const game = gameSessions.get(targetRoom);
    if (game) {
      console.log(`[MimicParty] 🚀 Host ${socket.id} (${currentUser.userName}) khởi động trận đấu trong phòng ${targetRoom}`);
      const started = game.startGame({ requireAllReady });
      if (callback) callback({ success: started });
    }
  });

  // 2. CẬP NHẬT CẤU HÌNH TRẬN ĐẤU (game_update_config)
  socket.on('game_update_config', ({ roomId, totalRounds, recordDuration, useCustomRecordDuration } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const room = rooms.get(targetRoom);
    if (!room || room.hostId !== socket.id) {
      const err = 'Chỉ có Chủ phòng mới có quyền cấu hình trận đấu!';
      socket.emit('game_error', { message: err });
      if (callback) callback({ success: false, message: err });
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
          systemMessage: `⚙️ Chủ phòng đã cập nhật: ${game.totalRounds} vòng, thời gian nhại ${game.recordDuration}s!`
        });
        if (callback) callback({ success: true, totalRounds: game.totalRounds, recordDuration: game.recordDuration });
      } else {
        if (callback) callback({ success: false, message: 'Không thể đổi cấu hình khi game đang diễn ra!' });
      }
    }
  });

  // 3. NỘP BÀI THU ÂM NHẠI GIỌNG (game_submit_audio)
  socket.on('game_submit_audio', ({ roomId, audioData, mimeType, metrics } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom) {
      if (callback) callback({ success: false, message: 'Chưa vào phòng!' });
      return;
    }
    const game = gameSessions.get(targetRoom);
    if (game) {
      const res = game.submitMimicAudio(socket.id, audioData, mimeType, metrics);
      if (callback) callback(res);
    } else {
      if (callback) callback({ success: false, message: 'Trận đấu không tồn tại!' });
    }
  });

  // 4. BÁO PHÁT XONG AUDIO MẪU (sample_playback_done)
  socket.on('sample_playback_done', ({ roomId } = {}) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom) return;
    const game = gameSessions.get(targetRoom);
    if (game) {
      game.handleSamplePlaybackDone(socket.id);
    }
  });

  // 5. THẢ EMOJI REACTION (game_emoji_reaction)
  socket.on('game_emoji_reaction', ({ roomId, emoji } = {}) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    if (!targetRoom || !emoji) return;
    if (!checkRateLimit('emoji', 5, 1000)) return;
    socket.to(targetRoom).emit('game_reaction_broadcast', String(emoji).slice(0, 8));
  });

  // 6. XÁC NHẬN SẴN SÀNG QUA VÒNG MỚI (confirm_next_round_ready)
  socket.on('confirm_next_round_ready', ({ roomId } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const game = gameSessions.get(targetRoom);
    if (game) {
      const res = game.confirmRoundReady(socket.id);
      if (callback) callback(res);
    } else {
      if (callback) callback({ success: false, message: 'Trận đấu không tồn tại!' });
    }
  });

  // 7. BỎ QUA SHOWDOWN SỚM (skip_to_round_result & confirm_showdown_skip)
  socket.on('skip_to_round_result', ({ roomId } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const game = gameSessions.get(targetRoom);
    if (game) {
      const res = game.confirmShowdownSkip(socket.id);
      if (callback) callback(res);
    } else {
      if (callback) callback({ success: false, message: 'Trận đấu không tồn tại!' });
    }
  });

  socket.on('confirm_showdown_skip', ({ roomId } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const game = gameSessions.get(targetRoom);
    if (game) {
      const res = game.confirmShowdownSkip(socket.id);
      if (callback) callback(res);
    } else {
      if (callback) callback({ success: false, message: 'Trận đấu không tồn tại!' });
    }
  });

  // 8. LẤY SNAPSHOT STATE HIỆN TẠI (get_game_state)
  socket.on('get_game_state', ({ roomId } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const game = gameSessions.get(targetRoom);
    if (callback) {
      callback(game ? game.getStateSnapshot() : null);
    }
  });
}

module.exports = {
  registerGameHandlers
};
