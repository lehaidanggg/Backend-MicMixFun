const { MAX_CHAT_HISTORY_SIZE } = require('../config/constants');
const { rooms } = require('../services/room.service');

function registerMediaHandlers(io, socket, sessionState, checkRateLimit) {
  const { currentUser } = sessionState;

  // 1. CHAT TRONG ROOM (send_message)
  socket.on('send_message', ({ message, type = 'text', audioMeta = null } = {}, callback) => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId || !rooms.has(currentRoomId)) {
      if (callback) callback({ success: false, message: 'Bạn chưa tham gia phòng nào!' });
      return;
    }
    if (!checkRateLimit('chat', 6, 3000)) {
      if (callback) callback({ success: false, message: 'Bạn nhắn quá nhanh! Vui lòng đợi giây lát.' });
      return;
    }

    const room = rooms.get(currentRoomId);
    const chatMsg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: socket.id,
      senderName: currentUser.userName,
      avatar: currentUser.avatar,
      message: String(message || '').slice(0, 1000),
      type,
      audioMeta,
      timestamp: Date.now()
    };

    room.messages.push(chatMsg);
    if (room.messages.length > MAX_CHAT_HISTORY_SIZE) {
      room.messages.shift();
    }

    io.to(currentRoomId).emit('new_message', chatMsg);
    if (callback) callback({ success: true, messageId: chatMsg.id });
  });

  // 2. SOUNDBOARD SYNC TRIGGER (trigger_sound & stop_all_sounds)
  socket.on('trigger_sound', ({ soundId, soundName, soundUrl, volume = 1.0, pitch = 1.0 } = {}, callback) => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId || !rooms.has(currentRoomId)) {
      if (callback) callback({ success: false, message: 'Chưa vào phòng!' });
      return;
    }
    if (!checkRateLimit('sound', 5, 2000)) {
      if (callback) callback({ success: false, message: 'Thao tác quá nhanh!' });
      return;
    }

    console.log(`[Soundboard] 📢 ${currentUser.userName} trigger sound "${soundName || soundId}" trong phòng ${currentRoomId}`);

    const payload = {
      soundId,
      soundName: soundName || soundId,
      soundUrl,
      volume: Math.max(0, Math.min(Number(volume) || 1.0, 1.0)),
      pitch: Math.max(0.5, Math.min(Number(pitch) || 1.0, 2.0)),
      senderId: socket.id,
      senderName: currentUser.userName,
      avatar: currentUser.avatar,
      timestamp: Date.now()
    };

    socket.to(currentRoomId).emit('sync_play_sound', payload);

    const room = rooms.get(currentRoomId);
    const soundChatMsg = {
      id: `msg_sound_${Date.now()}`,
      senderId: socket.id,
      senderName: currentUser.userName,
      avatar: currentUser.avatar,
      message: `đã phát âm thanh "${payload.soundName}"`,
      type: 'sound_trigger',
      audioMeta: payload,
      timestamp: Date.now()
    };
    room.messages.push(soundChatMsg);
    if (room.messages.length > MAX_CHAT_HISTORY_SIZE) room.messages.shift();
    io.to(currentRoomId).emit('new_message', soundChatMsg);

    if (callback) callback({ success: true });
  });

  socket.on('stop_all_sounds', () => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId) return;
    io.to(currentRoomId).emit('sync_stop_sounds', {
      senderId: socket.id,
      senderName: currentUser.userName
    });
  });

  // 3. CHIA SẺ FILE AUDIO / VOICE CLIP (share_audio_clip)
  socket.on('share_audio_clip', ({ audioData, audioName, duration, mimeType = 'audio/webm' } = {}, callback) => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId || !rooms.has(currentRoomId)) {
      if (callback) callback({ success: false, message: 'Chưa vào phòng!' });
      return;
    }

    console.log(`[AudioShare] 🎙️ ${currentUser.userName} chia sẻ audio clip (${duration || 0}s) trong phòng ${currentRoomId}`);

    const audioPayload = {
      id: `audio_${Date.now()}`,
      audioData,
      audioName: audioName || `Bản ghi của ${currentUser.userName}`,
      mimeType,
      duration,
      senderId: socket.id,
      senderName: currentUser.userName,
      avatar: currentUser.avatar,
      timestamp: Date.now()
    };

    io.to(currentRoomId).emit('new_audio_shared', audioPayload);

    const room = rooms.get(currentRoomId);
    const historyMeta = (typeof audioData === 'string' && audioData.length > 262144)
      ? { ...audioPayload, audioData: null, truncatedForMemory: true }
      : audioPayload;

    const chatMsg = {
      id: `msg_clip_${Date.now()}`,
      senderId: socket.id,
      senderName: currentUser.userName,
      avatar: currentUser.avatar,
      message: `đã chia sẻ một đoạn ghi âm giọng nói 🎙️`,
      type: 'audio_share',
      audioMeta: historyMeta,
      timestamp: Date.now()
    };
    room.messages.push(chatMsg);
    if (room.messages.length > MAX_CHAT_HISTORY_SIZE) room.messages.shift();
    io.to(currentRoomId).emit('new_message', { ...chatMsg, audioMeta: audioPayload });

    if (callback) callback({ success: true, audioId: audioPayload.id });
  });

  // 4. REAL-TIME MIC STREAM RELAY (mic_stream_*)
  socket.on('mic_stream_start', ({ sampleRate = 48000, channels = 1 } = {}) => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('user_mic_stream_started', {
      senderId: socket.id,
      senderName: currentUser.userName,
      sampleRate,
      channels
    });
  });

  socket.on('mic_stream_chunk', (chunk) => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('user_mic_stream_chunk', {
      senderId: socket.id,
      chunk
    });
  });

  socket.on('mic_stream_stop', () => {
    const currentRoomId = sessionState.currentRoomId;
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('user_mic_stream_stopped', {
      senderId: socket.id,
      senderName: currentUser.userName
    });
  });
}

module.exports = {
  registerMediaHandlers
};
