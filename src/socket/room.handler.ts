import { Server } from 'socket.io';
import {
  MAX_MEMBERS_PER_ROOM,
  MAX_CHAT_HISTORY_SIZE,
  DEFAULT_MATCHMAKING_BOT_COUNT,
  DEFAULT_MATCHMAKING_WAIT_MS
} from '../config/constants';
import { ErrorCode, RoomCloseReasonCode, SystemMessageCode } from '../config/messages';
import { MimicGameSession } from '../game/MimicGameSession';
import {
  sanitizeUserName,
  verifyFirebaseIdToken,
  verifyAuthToken,
  issueAuthToken,
  generateSecureUserId
} from '../services/auth.service';
import {
  rooms,
  gameSessions,
  matchmakingQueue,
  cancelMatchmakingForSocket,
  getRoomMembersArray,
  destroyRoomData,
  leaveCurrentRoom,
  addBotToRoom,
  removeBotFromRoom,
  fillRoomWithBots,
  findAvailableMatchmakingRoom,
  isBotMember
} from '../services/room.service';
import { AuthenticatedSocket, BotDifficulty, MatchmakingQueueEntry, RoomData, SocketSessionState } from '../types';

export function registerRoomHandlers(
  io: Server,
  socket: AuthenticatedSocket,
  sessionState: SocketSessionState
): void {
  const { currentUser } = sessionState;

  // 0. XÁC THỰC USER QUA SOCKET (auth_guest & auth_firebase)
  async function handleSocketAuth(
    { userName, avatar, authToken, firebaseIdToken }: Record<string, any> = {},
    callback?: (res: Record<string, unknown>) => void
  ): Promise<void> {
    let fbDecoded = null;
    if (firebaseIdToken) {
      fbDecoded = await verifyFirebaseIdToken(firebaseIdToken);
    }
    const verified = verifyAuthToken(authToken, socket.clientFingerprint || null) || socket.authSession || null;
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
      fingerprint: socket.clientFingerprint || null
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
  socket.on(
    'create_room',
    ({ roomId, roomName, userName }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      try {
        cancelMatchmakingForSocket(socket.id);
        const generatedRoomId = String(roomId || Math.random().toString(36).substring(2, 8))
          .trim()
          .toUpperCase()
          .slice(0, 16);
        const cleanUserName = sanitizeUserName(userName, socket.id);
        const safeRoomName = String(roomName || cleanUserName).trim().slice(0, 40);

        if (rooms.has(generatedRoomId)) {
          if (callback) {
            callback({
              success: false,
              code: ErrorCode.ROOM_ID_ALREADY_EXISTS,
              message: ErrorCode.ROOM_ID_ALREADY_EXISTS
            });
          }
          return;
        }

        const newRoom: RoomData = {
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
      } catch {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: ErrorCode.INTERNAL_SERVER_ERROR
          });
        }
      }
    }
  );

  // 2. THAM GIA PHÒNG (join_room)
  socket.on(
    'join_room',
    async (
      { roomId, userName, avatar, userId, authToken, firebaseIdToken, firebaseToken }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      try {
        cancelMatchmakingForSocket(socket.id);
        const targetRoomId = String(roomId || '').trim().toUpperCase().slice(0, 24);

        if (!targetRoomId) {
          if (callback) {
            callback({
              success: false,
              code: ErrorCode.ROOM_ID_REQUIRED,
              message: ErrorCode.ROOM_ID_REQUIRED
            });
          }
          return;
        }

        const fbTokenRaw = firebaseIdToken || firebaseToken;
        const fbDecoded = fbTokenRaw ? await verifyFirebaseIdToken(fbTokenRaw) : null;
        const verifiedToken = verifyAuthToken(authToken, socket.clientFingerprint || null) || socket.authSession || null;

        let isAuthenticated = false;
        let resolvedUserId: string;
        let resolvedFbUid: string | null = null;
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
          const isSpoofingActiveMember = Boolean(
            existingRoom &&
              userId &&
              Array.from(existingRoom.members.values()).some(m => m.userId === userId && m.socketId !== socket.id)
          );
          const savedPlayer = existingGame && userId ? existingGame.disconnectedPlayers.get(userId) : undefined;
          const isSpoofingSavedPlayer = Boolean(savedPlayer && savedPlayer.requireToken);

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
          fingerprint: socket.clientFingerprint || null
        });
        socket.authSession = issuedAuth.payload;

        if (!rooms.has(targetRoomId)) {
          rooms.set(targetRoomId, {
            id: targetRoomId,
            name: targetRoomId,
            createdAt: Date.now(),
            hostId: socket.id,
            hostUserId: resolvedUserId,
            members: new Map(),
            messages: [],
            cleanupTimer: null
          });
          console.log(`[Room] 🏠 Tự động khởi tạo phòng mới: ${targetRoomId} (Host: ${socket.id})`);
        }

        const room = rooms.get(targetRoomId)!;

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
          if (callback) {
            callback({
              success: false,
              code: ErrorCode.ROOM_FULL,
              message: ErrorCode.ROOM_FULL,
              messageParams: { maxMembers: MAX_MEMBERS_PER_ROOM }
            });
          }
          return;
        }

        if (!room.hostId || (room.members.size === 0 && !room.members.has(room.hostId))) {
          room.hostId = socket.id;
          room.hostUserId = resolvedUserId;
        }

        if (sessionState.currentRoomId && sessionState.currentRoomId !== targetRoomId) {
          leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
        }

        const isHost = room.hostId === socket.id;
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

        console.log(
          `[Room] 👤 [${currentUser.role}] ${currentUser.userName} (${socket.id}, UID: ${currentUser.userId}) đã vào phòng: ${targetRoomId}${restoreInfo.restored ? ` [Khôi phục ${restoreInfo.totalScore}đ]` : ''}`
        );

        const joinSysCode =
          currentUser.role === 'HOST'
            ? SystemMessageCode.SYS_HOST_JOINED_ROOM
            : SystemMessageCode.SYS_PLAYER_JOINED_ROOM;

        socket.to(targetRoomId).emit('user_joined', {
          user: currentUser,
          members: getRoomMembersArray(room),
          systemMessage: joinSysCode,
          messageCode: joinSysCode,
          messageParams: { userName: currentUser.userName, role: currentUser.role }
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
      } catch {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.INTERNAL_SERVER_ERROR,
            message: ErrorCode.INTERNAL_SERVER_ERROR
          });
        }
      }
    }
  );

  // 3. RỜI PHÒNG (leave_room)
  socket.on('leave_room', (_data: unknown, callback?: (res: Record<string, unknown>) => void) => {
    if (sessionState.currentRoomId) {
      leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
      sessionState.currentRoomId = null;
      if (callback) callback({ success: true });
    } else if (callback) {
      callback({ success: true });
    }
  });

  // 4. ĐÓNG PHÒNG XÓA SẠCH DATA (close_room)
  socket.on(
    'close_room',
    ({ roomId }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoomId = String(roomId || sessionState.currentRoomId || '').trim().toUpperCase();
      const room = rooms.get(targetRoomId);
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
          code: ErrorCode.ROOM_HOST_ONLY_CLOSE,
          message: ErrorCode.ROOM_HOST_ONLY_CLOSE
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_HOST_ONLY_CLOSE,
            message: ErrorCode.ROOM_HOST_ONLY_CLOSE
          });
        }
        return;
      }

      destroyRoomData(
        targetRoomId,
        RoomCloseReasonCode.HOST_CLOSED,
        SystemMessageCode.SYS_HOST_CLOSED_ROOM,
        { hostName: currentUser.userName }
      );
      sessionState.currentRoomId = null;

      if (callback) callback({ success: true, roomId: targetRoomId, cleared: true });
    }
  );

  // 5. ĐỔI TRẠNG THÁI SẴN SÀNG (player_ready_toggle)
  socket.on(
    'player_ready_toggle',
    ({ roomId, isReady }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
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
          game.setPlayerReady(socket.id, Boolean(member.isReady));
        }

        const readySysCode = member.isReady
          ? SystemMessageCode.SYS_PLAYER_READY
          : SystemMessageCode.SYS_PLAYER_UNREADY;

        io.to(targetRoom).emit('player_ready_changed', {
          socketId: socket.id,
          userName: member.userName,
          isReady: member.isReady,
          members: getRoomMembersArray(room),
          systemMessage: readySysCode,
          messageCode: readySysCode,
          messageParams: { userName: member.userName, isReady: member.isReady }
        });

        if (callback) callback({ success: true, isReady: member.isReady });
      }
    }
  );

  // 6. KICK THÀNH VIÊN (kick_player)
  socket.on(
    'kick_player',
    ({ roomId, targetSocketId }: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').toUpperCase();
      const room = rooms.get(targetRoom);
      if (!room || room.hostId !== socket.id) {
        socket.emit('game_error', {
          code: ErrorCode.ROOM_HOST_ONLY_KICK,
          message: ErrorCode.ROOM_HOST_ONLY_KICK
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_HOST_ONLY_KICK,
            message: ErrorCode.ROOM_HOST_ONLY_KICK
          });
        }
        return;
      }

      if (targetSocketId === socket.id) {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.ROOM_CANNOT_KICK_SELF,
            message: ErrorCode.ROOM_CANNOT_KICK_SELF
          });
        }
        return;
      }

      // Nếu mục tiêu bị kick là AI Bot thì xóa trực tiếp khỏi phòng
      const targetMember = room.members.get(String(targetSocketId || ''));
      if (targetMember && isBotMember(targetMember)) {
        const res = removeBotFromRoom(targetRoom, targetMember.socketId);
        if (callback) callback(res);
        return;
      }

      const targetSocket = io.sockets.sockets.get(String(targetSocketId || ''));
      if (targetSocket) {
        targetSocket.emit('kicked_from_room', {
          code: ErrorCode.ROOM_KICKED_BY_HOST,
          message: ErrorCode.ROOM_KICKED_BY_HOST
        });
        leaveCurrentRoom(targetSocket, targetRoom, {});
        if (callback) callback({ success: true });
      } else {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.PLAYER_NOT_IN_ROOM,
            message: ErrorCode.PLAYER_NOT_IN_ROOM
          });
        }
      }
    }
  );

  // 7. THÊM AI BOT VÀO PHÒNG (add_bot)
  socket.on(
    'add_bot',
    (
      { roomId, difficulty, botName, avatar }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').trim().toUpperCase();
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
          code: ErrorCode.BOT_HOST_ONLY_MANAGE,
          message: ErrorCode.BOT_HOST_ONLY_MANAGE
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.BOT_HOST_ONLY_MANAGE,
            message: ErrorCode.BOT_HOST_ONLY_MANAGE
          });
        }
        return;
      }

      const game = gameSessions.get(targetRoom);
      if (game && game.state !== 'IDLE' && game.state !== 'GAME_OVER') {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS,
            message: ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS
          });
        }
        return;
      }

      const res = addBotToRoom(targetRoom, { difficulty, botName, avatar });
      if (callback) callback(res);
    }
  );

  // 8. XÓA AI BOT KHỎI PHÒNG (remove_bot)
  socket.on(
    'remove_bot',
    (
      { roomId, botSocketId }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      const targetRoom = String(roomId || sessionState.currentRoomId || '').trim().toUpperCase();
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
          code: ErrorCode.BOT_HOST_ONLY_MANAGE,
          message: ErrorCode.BOT_HOST_ONLY_MANAGE
        });
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.BOT_HOST_ONLY_MANAGE,
            message: ErrorCode.BOT_HOST_ONLY_MANAGE
          });
        }
        return;
      }

      const game = gameSessions.get(targetRoom);
      if (game && game.state !== 'IDLE' && game.state !== 'GAME_OVER') {
        if (callback) {
          callback({
            success: false,
            code: ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS,
            message: ErrorCode.BOT_CANNOT_MANAGE_IN_PROGRESS
          });
        }
        return;
      }

      const res = removeBotFromRoom(targetRoom, botSocketId || null);
      if (callback) callback(res);
    }
  );

      // 9. TÌM TRẬN NHANH / GHÉP PHÒNG TỰ ĐỘNG (find_match & quick_match)
  // Luồng hoạt động:
  // - Bước 1: Tìm tất cả User đang rảnh (IDLE):
  //     + (1a) Có phòng đang ở trạng thái IDLE có người chơi thật và còn chỗ trống -> Ghép ngay vào phòng đó.
  //     + (1b) Có người chơi khác đang chờ trong hàng đợi tìm trận (matchmakingQueue) -> Tạo phòng mới và ghép cả hai vào cùng phòng ngay lập tức.
  // - Bước 2: Nếu KHÔNG tìm thấy bất kỳ User rảnh nào khác -> Bắt đầu chạy 1 Timer chờ (waitMs, mặc định 10s).
  // - Bước 3: Nếu hết thời gian Timer mà vẫn không có User nào khác ghép vào -> Tự động mở 1 phòng mới, thêm AI Bot vào phòng đó và bắt đầu Gameplay ngay!
  const createBotFallbackRoomAndStart = (entry: MatchmakingQueueEntry): Record<string, unknown> => {
    cancelMatchmakingForSocket(entry.socket.id);

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room: RoomData = {
      id: newRoomId,
      name: entry.userName,
      createdAt: Date.now(),
      hostId: entry.socket.id,
      hostUserId: entry.userId,
      members: new Map(),
      messages: [],
      cleanupTimer: null
    };
    rooms.set(newRoomId, room);

    const userObj = entry.sessionState.currentUser;
    entry.sessionState.currentRoomId = room.id;
    userObj.socketId = entry.socket.id;
    userObj.userId = entry.userId;
    userObj.userName = entry.userName;
    userObj.avatar = entry.avatar;
    userObj.role = 'HOST';
    userObj.isReady = true;
    userObj.isAuthenticated = true;
    userObj.joinedAt = Date.now();

    entry.socket.join(room.id);
    room.members.set(entry.socket.id, userObj);

    const game = new MimicGameSession(room.id, io);
    game.hostId = room.hostId;
    gameSessions.set(room.id, game);
    game.addPlayer(entry.socket.id, userObj.userName, userObj.avatar, 'HOST', userObj.userId, true);

    const filled = fillRoomWithBots(room.id, {
      botCount: entry.botCount,
      difficulty: entry.botDifficulty
    });
    const botsAdded = filled.botsAdded;

    let autoStarted = false;
    if (entry.autoStart !== false) {
      autoStarted = game.startGame({ requireAllReady: false });
    }

    console.log(
      `[Matchmaking] ⏰ Hết thời gian chờ (${entry.waitMs}ms) không tìm thấy User khác -> Tạo phòng ${room.id}, thêm ${botsAdded} Bot AI & autoStart=${autoStarted}`
    );

    const responseData = {
      success: true,
      searching: false,
      matchedWithHumans: false,
      timedOutToBots: true,
      botsAdded,
      autoStarted,
      roomId: room.id,
      room: {
        id: room.id,
        name: room.name,
        hostId: room.hostId,
        members: getRoomMembersArray(room),
        messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
      },
      user: userObj,
      gameState: game.getStateSnapshot()
    };

    entry.socket.emit('joined_room_success', responseData);
    entry.socket.emit('match_found', responseData);
    if (entry.onResolved) {
      const cb = entry.onResolved;
      entry.onResolved = undefined;
      cb(responseData);
    }
    return responseData;
  };

  const handleQuickMatch = async (
    {
      userName,
      avatar,
      botCount = DEFAULT_MATCHMAKING_BOT_COUNT,
      botDifficulty,
      autoStart = true,
      waitMs,
      waitForPlayers = true
    }: Record<string, any> = {},
    callback?: (res: Record<string, unknown>) => void
  ): Promise<void> => {
    try {
      // Hủy phiên tìm trận cũ của chính socket này (nếu có)
      cancelMatchmakingForSocket(socket.id);

      const verifiedToken = socket.authSession || null;
      const resolvedUserId = (verifiedToken && verifiedToken.uid) || currentUser.userId || generateSecureUserId();
      const cleanName = sanitizeUserName(userName || (verifiedToken && verifiedToken.name) || currentUser.userName, socket.id);
      const cleanAvatar = avatar || (verifiedToken && verifiedToken.avatar) || currentUser.avatar || '🎧';

      currentUser.socketId = socket.id;
      currentUser.userId = resolvedUserId;
      currentUser.userName = cleanName;
      currentUser.avatar = cleanAvatar;
      currentUser.isAuthenticated = true;

      if (sessionState.currentRoomId) {
        leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
        sessionState.currentRoomId = null;
      }

      // 1A. Kiểm tra xem có User nào khác đang chờ trong hàng đợi tìm trận (matchmakingQueue) không
      let waitingPeer: MatchmakingQueueEntry | null = null;
      for (const [peerSockId, entry] of matchmakingQueue.entries()) {
        if (peerSockId !== socket.id) {
          waitingPeer = entry;
          break;
        }
      }

      if (waitingPeer) {
        cancelMatchmakingForSocket(waitingPeer.socket.id);

        const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const hostEntry = waitingPeer;
        const room: RoomData = {
          id: newRoomId,
          name: hostEntry.userName,
          createdAt: Date.now(),
          hostId: hostEntry.socket.id,
          hostUserId: hostEntry.userId,
          members: new Map(),
          messages: [],
          cleanupTimer: null
        };
        rooms.set(newRoomId, room);

        const game = new MimicGameSession(room.id, io);
        game.hostId = room.hostId;
        gameSessions.set(room.id, game);

        // Đưa người chơi đang chờ (Peer) làm HOST
        const hostUser = hostEntry.sessionState.currentUser;
        hostEntry.sessionState.currentRoomId = room.id;
        hostUser.socketId = hostEntry.socket.id;
        hostUser.userId = hostEntry.userId;
        hostUser.userName = hostEntry.userName;
        hostUser.avatar = hostEntry.avatar;
        hostUser.role = 'HOST';
        hostUser.isReady = true;
        hostUser.isAuthenticated = true;
        hostUser.joinedAt = Date.now();

        hostEntry.socket.join(room.id);
        room.members.set(hostEntry.socket.id, hostUser);
        game.addPlayer(hostEntry.socket.id, hostUser.userName, hostUser.avatar, 'HOST', hostUser.userId, true);

        // Đưa người chơi hiện tại vào phòng làm PLAYER
        sessionState.currentRoomId = room.id;
        currentUser.role = 'PLAYER';
        currentUser.isReady = true;
        currentUser.joinedAt = Date.now();

        socket.join(room.id);
        room.members.set(socket.id, currentUser);
        game.addPlayer(socket.id, currentUser.userName, currentUser.avatar, 'PLAYER', currentUser.userId, true);

        // Gộp thêm toàn bộ các User khác đang rảnh trong matchmakingQueue (nếu còn chỗ)
        const extraPeers: MatchmakingQueueEntry[] = [];
        for (const [otherId, otherEntry] of Array.from(matchmakingQueue.entries())) {
          if (room.members.size >= MAX_MEMBERS_PER_ROOM) break;
          if (otherId === socket.id || otherId === hostEntry.socket.id) continue;
          cancelMatchmakingForSocket(otherId);
          const u = otherEntry.sessionState.currentUser;
          otherEntry.sessionState.currentRoomId = room.id;
          u.socketId = otherEntry.socket.id;
          u.userId = otherEntry.userId;
          u.userName = otherEntry.userName;
          u.avatar = otherEntry.avatar;
          u.role = 'PLAYER';
          u.isReady = true;
          u.isAuthenticated = true;
          u.joinedAt = Date.now();
          otherEntry.socket.join(room.id);
          room.members.set(otherEntry.socket.id, u);
          game.addPlayer(otherEntry.socket.id, u.userName, u.avatar, 'PLAYER', u.userId, true);
          extraPeers.push(otherEntry);
        }

        const membersList = getRoomMembersArray(room);
        const roomSnapshot = {
          id: room.id,
          name: room.name,
          hostId: room.hostId,
          members: membersList,
          messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
        };
        const stateSnapshot = game.getStateSnapshot();

        // Thông báo cho Host (người đang chờ trong queue)
        const hostPayload = {
          success: true,
          searching: false,
          matchedWithHumans: true,
          botsAdded: 0,
          autoStarted: false,
          roomId: room.id,
          room: roomSnapshot,
          user: hostUser,
          gameState: stateSnapshot
        };
        hostEntry.socket.emit('joined_room_success', hostPayload);
        hostEntry.socket.emit('match_found', hostPayload);
        if (hostEntry.onResolved) {
          const cb = hostEntry.onResolved;
          hostEntry.onResolved = undefined;
          cb(hostPayload);
        }

        // Thông báo cho các peer phụ (nếu có)
        for (const ep of extraPeers) {
          const epPayload = {
            ...hostPayload,
            user: ep.sessionState.currentUser
          };
          ep.socket.emit('joined_room_success', epPayload);
          ep.socket.emit('match_found', epPayload);
          if (ep.onResolved) {
            const cb = ep.onResolved;
            ep.onResolved = undefined;
            cb(epPayload);
          }
        }

        // Broadcast sự kiện user_joined cho phòng
        hostEntry.socket.emit('user_joined', {
          user: currentUser,
          members: membersList,
          systemMessage: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageCode: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageParams: { userName: currentUser.userName, role: currentUser.role }
        });

        const currentPayload = {
          success: true,
          searching: false,
          matchedWithHumans: true,
          botsAdded: 0,
          autoStarted: false,
          roomId: room.id,
          room: roomSnapshot,
          user: currentUser,
          gameState: stateSnapshot
        };

        console.log(
          `[Matchmaking] 🤝 Ghép thành công ${room.members.size} người chơi đang rảnh vào phòng mới: ${room.id}`
        );

        socket.emit('joined_room_success', currentPayload);
        socket.emit('match_found', currentPayload);
        if (callback) callback(currentPayload);
        return;
      }

      // 1B. Kiểm tra xem có phòng nào đang ở trạng thái rảnh (IDLE) có người chơi thật và còn chỗ trống không
      const existingRoom = findAvailableMatchmakingRoom(socket.id);
      if (existingRoom) {
        const room = existingRoom;
        const isHost = room.hostId === socket.id;
        sessionState.currentRoomId = room.id;
        currentUser.role = isHost ? 'HOST' : 'PLAYER';
        currentUser.isReady = true;
        currentUser.joinedAt = Date.now();

        socket.join(room.id);
        room.members.set(socket.id, currentUser);

        let game = gameSessions.get(room.id);
        if (!game) {
          game = new MimicGameSession(room.id, io);
          game.hostId = room.hostId;
          gameSessions.set(room.id, game);
        }
        game.addPlayer(socket.id, currentUser.userName, currentUser.avatar, currentUser.role, currentUser.userId, true);

        socket.to(room.id).emit('user_joined', {
          user: currentUser,
          members: getRoomMembersArray(room),
          systemMessage: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageCode: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageParams: { userName: currentUser.userName, role: currentUser.role }
        });

        const responseData = {
          success: true,
          searching: false,
          matchedWithHumans: true,
          botsAdded: 0,
          autoStarted: false,
          roomId: room.id,
          room: {
            id: room.id,
            name: room.name,
            hostId: room.hostId,
            members: getRoomMembersArray(room),
            messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
          },
          user: currentUser,
          gameState: game.getStateSnapshot()
        };

        console.log(`[Matchmaking] 🤝 Ghép ${currentUser.userName} vào phòng IDLE sẵn có: ${room.id}`);
        socket.emit('joined_room_success', responseData);
        socket.emit('match_found', responseData);
        if (callback) callback(responseData);
        return;
      }

      // 2. KHÔNG tìm thấy User nào đang rảnh -> Đưa vào hàng đợi và bật Timer chờ!
      const resolvedBotCount = Math.max(1, Number(botCount) || DEFAULT_MATCHMAKING_BOT_COUNT);
      const resolvedDiff = botDifficulty ? (String(botDifficulty).toUpperCase() as BotDifficulty) : undefined;
      const resolvedWaitMs =
        waitForPlayers === false
          ? 0
          : typeof waitMs === 'number' && waitMs >= 0
            ? Math.min(60000, waitMs)
            : DEFAULT_MATCHMAKING_WAIT_MS;

      const queueEntry: MatchmakingQueueEntry = {
        socket,
        sessionState,
        userId: resolvedUserId,
        userName: cleanName,
        avatar: cleanAvatar,
        botCount: resolvedBotCount,
        botDifficulty: resolvedDiff,
        autoStart: autoStart !== false,
        waitMs: resolvedWaitMs,
        joinedQueueAt: Date.now(),
        timer: null,
        tickTimer: null,
        onResolved: callback
      };

      // Nếu waitMs === 0 (hoặc waitForPlayers === false) -> Mở ngay phòng và thêm Bot
      if (resolvedWaitMs <= 0) {
        createBotFallbackRoomAndStart(queueEntry);
        return;
      }

      sessionState.isSearchingMatch = true;
      matchmakingQueue.set(socket.id, queueEntry);

      const totalWaitSeconds = Math.ceil(resolvedWaitMs / 1000);
      let remainingSeconds = totalWaitSeconds;

      console.log(
        `[Matchmaking] 🔍 ${cleanName} (${socket.id}) bắt đầu chờ tìm người chơi khác trong ${resolvedWaitMs}ms...`
      );

      socket.emit('matchmaking_searching', {
        searching: true,
        waitMs: resolvedWaitMs,
        timeRemaining: remainingSeconds,
        totalWaitSeconds,
        systemMessage: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
        messageCode: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
        messageParams: { waitSeconds: remainingSeconds, waitMs: resolvedWaitMs }
      });

      // Phát sự kiện đếm ngược mỗi giây (matchmaking_tick) để UI hiển thị đồng hồ tìm trận
      if (resolvedWaitMs >= 1000) {
        queueEntry.tickTimer = setInterval(() => {
          remainingSeconds = Math.max(0, remainingSeconds - 1);
          socket.emit('matchmaking_tick', {
            searching: true,
            timeRemaining: remainingSeconds,
            totalWaitSeconds,
            progressPercent: Math.max(
              0,
              Math.min(100, Math.round(((totalWaitSeconds - remainingSeconds) / totalWaitSeconds) * 100))
            )
          });
        }, 1000);
        if (typeof queueEntry.tickTimer.unref === 'function') {
          queueEntry.tickTimer.unref();
        }
      }

      // 3. Khi hết thời gian Timer mà vẫn chưa tìm được User nào khác -> Mở phòng mới & thêm Bot để bắt đầu game!
      queueEntry.timer = setTimeout(() => {
        if (!matchmakingQueue.has(socket.id)) return;
        createBotFallbackRoomAndStart(queueEntry);
      }, resolvedWaitMs);

      if (typeof queueEntry.timer.unref === 'function') {
        queueEntry.timer.unref();
      }
    } catch {
      if (callback) {
        callback({
          success: false,
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: ErrorCode.INTERNAL_SERVER_ERROR
        });
      }
    }
  };

  socket.on('find_match', handleQuickMatch);
  socket.on('quick_match', handleQuickMatch);

  // 10. HỦY TÌM TRẬN NHANH (cancel_match & cancel_quick_match)
  const handleCancelMatchmaking = (
    _data: unknown,
    callback?: (res: Record<string, unknown>) => void
  ): void => {
    const cancelled = cancelMatchmakingForSocket(socket.id);
    const payload = {
      success: true,
      cancelled: Boolean(cancelled),
      searching: false,
      systemMessage: SystemMessageCode.SYS_MATCHMAKING_CANCELLED,
      messageCode: SystemMessageCode.SYS_MATCHMAKING_CANCELLED
    };
    socket.emit('matchmaking_cancelled', payload);
    if (callback) callback(payload);
  };

  socket.on('cancel_match', handleCancelMatchmaking);
  socket.on('cancel_quick_match', handleCancelMatchmaking);
}
