const { MAX_MEMBERS_PER_ROOM, MAX_CHAT_HISTORY_SIZE } = require('../config/constants');
const { MimicGameSession } = require('../game/MimicGameSession');
const {
  sanitizeUserName,
  verifyFirebaseIdToken,
  verifyAuthToken,
  issueAuthToken,
  generateSecureUserId
} = require('../services/auth.service');
const {
  rooms,
  gameSessions,
  getRoomMembersArray,
  destroyRoomData,
  leaveCurrentRoom
} = require('../services/room.service');

function registerRoomHandlers(io, socket, sessionState) {
  const { currentUser } = sessionState;

  // 0. XÁC THỰC USER QUA SOCKET (auth_guest & auth_firebase)
  async function handleSocketAuth({ userName, avatar, authToken, firebaseIdToken } = {}, callback) {
    let fbDecoded = null;
    if (firebaseIdToken) {
      fbDecoded = await verifyFirebaseIdToken(firebaseIdToken);
    }
    const verified = verifyAuthToken(authToken, socket.clientFingerprint) || socket.authSession;
    const uid = fbDecoded ? fbDecoded.uid : (verified ? verified.uid : generateSecureUserId());
    const fbUid = fbDecoded ? fbDecoded.firebaseUid : (verified ? verified.fbUid : null);
    const provider = fbDecoded ? 'firebase_anonymous' : (verified ? (verified.provider || 'guest') : 'guest');
    const cleanName = sanitizeUserName(userName || (verified && verified.name), uid);
    const cleanAvatar = avatar || (verified && verified.avatar) || '🎧';

    const issued = issueAuthToken({
      userId: uid,
      firebaseUid: fbUid,
      provider,
      userName: cleanName,
      avatar: cleanAvatar,
      fingerprint: socket.clientFingerprint
    });
    socket.authSession = issued.payload;
    currentUser.userId = issued.payload.uid;
    currentUser.firebaseUid = issued.payload.fbUid;
    currentUser.userName = issued.payload.name;
    currentUser.avatar = issued.payload.avatar;
    currentUser.isAuthenticated = true;

    if (callback) {
      callback({
        success: true,
        userId: issued.payload.uid,
        firebaseUid: issued.payload.fbUid,
        provider: issued.payload.provider,
        authToken: issued.token,
        expiresAt: issued.payload.exp,
        user: {
          userId: issued.payload.uid,
          firebaseUid: issued.payload.fbUid,
          userName: issued.payload.name,
          avatar: issued.payload.avatar
        }
      });
    }
  }

  socket.on('auth_guest', handleSocketAuth);
  socket.on('auth_firebase', handleSocketAuth);

  // 1. TẠO PHÒNG (create_room)
  socket.on('create_room', ({ roomId, roomName, userName } = {}, callback) => {
    try {
      const generatedRoomId = (roomId || Math.random().toString(36).substring(2, 8)).trim().toUpperCase().slice(0, 16);
      const cleanUserName = sanitizeUserName(userName, socket.id);
      const safeRoomName = String(roomName || `Phòng của ${cleanUserName}`).trim().slice(0, 40);

      if (rooms.has(generatedRoomId)) {
        if (callback) callback({ success: false, message: 'Mã phòng đã tồn tại. Hãy thử mã khác!' });
        return;
      }

      const newRoom = {
        id: generatedRoomId,
        name: safeRoomName,
        createdAt: Date.now(),
        hostId: socket.id,
        hostUserId: currentUser.userId || null,
        members: new Map(),
        messages: [],
        cleanupTimer: null
      };
      rooms.set(generatedRoomId, newRoom);

      console.log(`[Room] 🏠 Đã tạo phòng mới: ${generatedRoomId} - "${safeRoomName}" (Host: ${socket.id})`);
      if (callback) callback({ success: true, roomId: generatedRoomId, roomName: safeRoomName, hostId: socket.id });
    } catch (err) {
      console.error('[Error create_room]:', err);
      if (callback) callback({ success: false, message: err.message });
    }
  });

  // 2. THAM GIA PHÒNG (join_room)
  socket.on('join_room', async ({ roomId, userName, avatar, userId, authToken, firebaseIdToken, firebaseToken } = {}, callback) => {
    try {
      const targetRoomId = String(roomId || '').trim().toUpperCase().slice(0, 24);

      if (!targetRoomId) {
        if (callback) callback({ success: false, message: 'Vui lòng cung cấp mã phòng!' });
        return;
      }

      const fbTokenRaw = firebaseIdToken || firebaseToken;
      const fbDecoded = fbTokenRaw ? await verifyFirebaseIdToken(fbTokenRaw) : null;
      const verifiedToken = verifyAuthToken(authToken, socket.clientFingerprint) || socket.authSession;

      let isAuthenticated = false;
      let resolvedUserId = null;
      let resolvedFbUid = null;
      let resolvedProvider = 'guest';

      if (fbDecoded && fbDecoded.uid) {
        isAuthenticated = true;
        resolvedUserId = fbDecoded.uid;
        resolvedFbUid = fbDecoded.firebaseUid;
        resolvedProvider = 'firebase_anonymous';
      } else if (verifiedToken && verifiedToken.uid) {
        isAuthenticated = true;
        resolvedUserId = verifiedToken.uid;
        resolvedFbUid = verifiedToken.fbUid || null;
        resolvedProvider = verifiedToken.provider || 'guest';
      } else {
        const existingRoom = rooms.get(targetRoomId);
        const existingGame = gameSessions.get(targetRoomId);
        const isSpoofingActiveMember = existingRoom && userId &&
          Array.from(existingRoom.members.values()).some(m => m.userId === userId && m.socketId !== socket.id);
        const isSpoofingSavedPlayer = existingGame && userId &&
          existingGame.disconnectedPlayers.has(userId) && existingGame.disconnectedPlayers.get(userId).requireToken;

        if (userId && !isSpoofingActiveMember && !isSpoofingSavedPlayer) {
          resolvedUserId = String(userId).slice(0, 64);
          isAuthenticated = true;
        } else {
          resolvedUserId = generateSecureUserId();
          isAuthenticated = true;
        }
      }

      const cleanName = sanitizeUserName(userName || (verifiedToken && verifiedToken.name), socket.id);
      const cleanAvatar = avatar || (verifiedToken && verifiedToken.avatar) || '🎧';
      const issuedAuth = issueAuthToken({
        userId: resolvedUserId,
        firebaseUid: resolvedFbUid,
        provider: resolvedProvider,
        userName: cleanName,
        avatar: cleanAvatar,
        fingerprint: socket.clientFingerprint
      });
      socket.authSession = issuedAuth.payload;

      if (!rooms.has(targetRoomId)) {
        rooms.set(targetRoomId, {
          id: targetRoomId,
          name: `Phòng ${targetRoomId}`,
          createdAt: Date.now(),
          hostId: socket.id,
          hostUserId: resolvedUserId,
          members: new Map(),
          messages: [],
          cleanupTimer: null
        });
        console.log(`[Room] 🏠 Tự động khởi tạo phòng mới: ${targetRoomId} (Host: ${socket.id})`);
      }

      const room = rooms.get(targetRoomId);

      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }

      // Dọn dẹp ghost socket nếu cùng 1 userId đã xác thực kết nối lại trên socket mới
      if ((verifiedToken || fbDecoded) && resolvedUserId) {
        for (const [oldSockId, member] of room.members.entries()) {
          if (member.userId === resolvedUserId && oldSockId !== socket.id) {
            const oldSock = io.sockets.sockets.get(oldSockId);
            if (oldSock) oldSock.leave(targetRoomId);
            room.members.delete(oldSockId);
            const g = gameSessions.get(targetRoomId);
            if (g) g.removePlayer(oldSockId);
          }
        }
      }

      if (!room.members.has(socket.id) && room.members.size >= MAX_MEMBERS_PER_ROOM) {
        if (callback) callback({ success: false, message: `Phòng đã đầy (${MAX_MEMBERS_PER_ROOM}/${MAX_MEMBERS_PER_ROOM} người)!` });
        return;
      }

      if (!room.hostId || (room.members.size === 0 && !room.members.has(room.hostId))) {
        room.hostId = socket.id;
        room.hostUserId = resolvedUserId;
      }

      if (sessionState.currentRoomId && sessionState.currentRoomId !== targetRoomId) {
        leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
      }

      const isHost = (room.hostId === socket.id);
      sessionState.currentRoomId = targetRoomId;
      currentUser.socketId = socket.id;
      currentUser.userId = resolvedUserId;
      currentUser.firebaseUid = resolvedFbUid;
      currentUser.userName = cleanName;
      currentUser.avatar = cleanAvatar;
      currentUser.role = isHost ? 'HOST' : 'PLAYER';
      currentUser.isReady = isHost;
      currentUser.isAuthenticated = isAuthenticated;
      currentUser.joinedAt = Date.now();

      socket.join(targetRoomId);
      room.members.set(socket.id, currentUser);

      let game = gameSessions.get(targetRoomId);
      if (!game) {
        game = new MimicGameSession(targetRoomId, io);
        game.hostId = room.hostId;
        gameSessions.set(targetRoomId, game);
      } else if (!game.hostId) {
        game.hostId = room.hostId;
      }

      const restoreInfo = game.addPlayer(
        socket.id,
        currentUser.userName,
        currentUser.avatar,
        currentUser.role,
        currentUser.userId,
        isAuthenticated
      );

      console.log(`[Room] 👤 [${currentUser.role}] ${currentUser.userName} (${socket.id}, UID: ${currentUser.userId}) đã vào phòng: ${targetRoomId}${restoreInfo.restored ? ` [Khôi phục ${restoreInfo.totalScore}đ]` : ''}`);

      socket.to(targetRoomId).emit('user_joined', {
        user: currentUser,
        members: getRoomMembersArray(room),
        systemMessage: `${currentUser.role === 'HOST' ? '👑 Chủ phòng' : '🎧'} ${currentUser.userName} đã tham gia phòng!`
      });

      const responseData = {
        success: true,
        authToken: issuedAuth.token,
        expiresAt: issuedAuth.payload.exp,
        restoredSession: restoreInfo.restored,
        room: {
          id: room.id,
          name: room.name,
          hostId: room.hostId,
          members: getRoomMembersArray(room),
          messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
        },
        user: currentUser,
        gameState: game ? game.getStateSnapshot() : null
      };

      if (callback) callback(responseData);
      socket.emit('joined_room_success', responseData);
    } catch (err) {
      console.error('[Error join_room]:', err);
      if (callback) callback({ success: false, message: err.message });
    }
  });

  // 3. RỜI PHÒNG (leave_room)
  socket.on('leave_room', (data, callback) => {
    if (sessionState.currentRoomId) {
      leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
      sessionState.currentRoomId = null;
      if (callback) callback({ success: true });
    } else if (callback) {
      callback({ success: true });
    }
  });

  // 4. ĐÓNG PHÒNG XÓA SẠCH DATA (close_room)
  socket.on('close_room', ({ roomId } = {}, callback) => {
    const targetRoomId = String(roomId || sessionState.currentRoomId || '').trim().toUpperCase();
    const room = rooms.get(targetRoomId);
    if (!room) {
      if (callback) callback({ success: false, message: 'Phòng không tồn tại!' });
      return;
    }

    if (room.hostId !== socket.id) {
      const errMsg = 'Chỉ có Chủ phòng (Host) mới có quyền đóng phòng!';
      socket.emit('game_error', { message: errMsg });
      if (callback) callback({ success: false, message: errMsg });
      return;
    }

    destroyRoomData(
      targetRoomId,
      'HOST_CLOSED',
      `👑 Chủ phòng ${currentUser.userName} đã đóng phòng đấu!`
    );
    sessionState.currentRoomId = null;

    if (callback) callback({ success: true, roomId: targetRoomId, cleared: true });
  });

  // 5. ĐỔI TRẠNG THÁI SẴN SÀNG (player_ready_toggle)
  socket.on('player_ready_toggle', ({ roomId, isReady } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const room = rooms.get(targetRoom);
    if (!room) return;

    const member = room.members.get(socket.id);
    if (member) {
      if (room.hostId === socket.id) {
        member.isReady = true;
      } else {
        member.isReady = typeof isReady === 'boolean' ? isReady : !member.isReady;
      }

      const game = gameSessions.get(targetRoom);
      if (game) {
        game.setPlayerReady(socket.id, member.isReady);
      }

      io.to(targetRoom).emit('player_ready_changed', {
        socketId: socket.id,
        userName: member.userName,
        isReady: member.isReady,
        members: getRoomMembersArray(room),
        systemMessage: `${member.userName} ${member.isReady ? 'đã SẴN SÀNG ✅' : 'đã hủy sẵn sàng ⏳'}`
      });

      if (callback) callback({ success: true, isReady: member.isReady });
    }
  });

  // 6. KICK THÀNH VIÊN (kick_player)
  socket.on('kick_player', ({ roomId, targetSocketId } = {}, callback) => {
    const targetRoom = (roomId || sessionState.currentRoomId || '').toUpperCase();
    const room = rooms.get(targetRoom);
    if (!room || room.hostId !== socket.id) {
      const err = 'Chỉ có Chủ phòng mới có quyền mời thành viên ra khỏi phòng!';
      socket.emit('game_error', { message: err });
      if (callback) callback({ success: false, message: err });
      return;
    }

    if (targetSocketId === socket.id) {
      if (callback) callback({ success: false, message: 'Bạn không thể tự kick chính mình!' });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('kicked_from_room', {
        message: 'Bạn đã bị Chủ phòng mời ra khỏi phòng!'
      });
      leaveCurrentRoom(targetSocket, targetRoom, {});
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: false, message: 'Người chơi không còn trong phòng!' });
    }
  });
}

module.exports = {
  registerRoomHandlers
};
