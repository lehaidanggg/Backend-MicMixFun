import { Server } from 'socket.io';
import {
  MAX_MEMBERS_PER_ROOM,
  MAX_CHAT_HISTORY_SIZE,
  DEFAULT_MATCHMAKING_BOT_COUNT,
  DEFAULT_MATCHMAKING_WAIT_MS,
  DEFAULT_MIN_PLAYERS_WITH_BOTS,
  RACE_1V1_PLAYERS,
  MATCHMAKING_EXTEND_MS,
  MATCHMAKING_MAX_WAIT_CAP_MS
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
  startRoomMatchmakingCountdown,
  extendRoomMatchmakingOnPlayerJoin,
  drainMatchmakingQueueIntoRoom,
  reopenRoomForMatchmaking,
  isBotMember
} from '../services/room.service';
import { AuthenticatedSocket, BotDifficulty, GameModeType, MatchmakingQueueEntry, RoomData, SocketSessionState } from '../types';

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

  // 1. TẠO PHÒNG RIÊNG (create_room) — Tự động đưa người tạo vào phòng với vai trò HOST & khởi tạo MimicGameSession
  socket.on(
    'create_room',
    (
      { roomId, roomName, userName, avatar }: Record<string, any> = {},
      callback?: (res: Record<string, unknown>) => void
    ) => {
      try {
        cancelMatchmakingForSocket(socket.id);
        const generatedRoomId = String(roomId || Math.random().toString(36).substring(2, 8))
          .trim()
          .toUpperCase()
          .slice(0, 16);
        const cleanUserName = sanitizeUserName(userName || currentUser.userName, socket.id);
        const cleanAvatar = avatar || currentUser.avatar || '🎧';
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

        if (sessionState.currentRoomId && sessionState.currentRoomId !== generatedRoomId) {
          leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
        }

        const resolvedUserId =
          (socket.authSession && socket.authSession.uid) || currentUser.userId || generateSecureUserId();

        const newRoom: RoomData = {
          id: generatedRoomId,
          name: safeRoomName,
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          hostId: socket.id,
          hostUserId: resolvedUserId,
          mode: 'CUSTOM_ROOM',
          targetPlayers: MAX_MEMBERS_PER_ROOM,
          members: new Map(),
          messages: [],
          cleanupTimer: null
        };
        rooms.set(generatedRoomId, newRoom);

        sessionState.currentRoomId = generatedRoomId;
        currentUser.socketId = socket.id;
        currentUser.userId = resolvedUserId;
        currentUser.userName = cleanUserName;
        currentUser.avatar = cleanAvatar;
        currentUser.role = 'HOST';
        currentUser.isReady = true;
        currentUser.isAuthenticated = true;
        currentUser.joinedAt = Date.now();

        socket.join(generatedRoomId);
        newRoom.members.set(socket.id, currentUser);

        const game = new MimicGameSession(generatedRoomId, io, {
          gameMode: 'CUSTOM_ROOM',
          targetPlayers: MAX_MEMBERS_PER_ROOM
        });
        game.hostId = socket.id;
        game.addPlayer(socket.id, currentUser.userName, currentUser.avatar, 'HOST', currentUser.userId, true);
        gameSessions.set(generatedRoomId, game);

        const roomSnapshot = {
          id: generatedRoomId,
          name: safeRoomName,
          hostId: socket.id,
          mode: 'CUSTOM_ROOM' as const,
          targetPlayers: MAX_MEMBERS_PER_ROOM,
          members: getRoomMembersArray(newRoom),
          messages: []
        };

        const responseData = {
          success: true,
          roomId: generatedRoomId,
          roomName: safeRoomName,
          hostId: socket.id,
          mode: 'CUSTOM_ROOM',
          room: roomSnapshot,
          user: currentUser,
          gameState: game.getStateSnapshot()
        };

        console.log(`[Room] 🏠 Đã tạo phòng mới & đưa Host vào phòng: ${generatedRoomId} - "${safeRoomName}" (Host: ${socket.id})`);
        socket.emit('joined_room_success', responseData);
        if (callback) {
          callback(responseData);
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
    }
  );

  // 2. THAM GIA PHÒNG (join_room)
  socket.on(
    'join_room',
    async (
      {
        roomId,
        userName,
        avatar,
        userId,
        authToken,
        firebaseIdToken,
        firebaseToken,
        createIfNotExists = false
      }: Record<string, any> = {},
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

        // Nếu phòng không tồn tại: chỉ tạo mới nếu createIfNotExists=true, ngược lại báo lỗi ROOM_NOT_FOUND
        if (!rooms.has(targetRoomId)) {
          if (!createIfNotExists) {
            socket.emit('game_error', {
              code: ErrorCode.ROOM_NOT_FOUND,
              message: ErrorCode.ROOM_NOT_FOUND
            });
            if (callback) {
              callback({
                success: false,
                code: ErrorCode.ROOM_NOT_FOUND,
                message: ErrorCode.ROOM_NOT_FOUND
              });
            }
            return;
          }

          rooms.set(targetRoomId, {
            id: targetRoomId,
            name: targetRoomId,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            hostId: socket.id,
            hostUserId: resolvedUserId,
            mode: 'CUSTOM_ROOM',
            targetPlayers: MAX_MEMBERS_PER_ROOM,
            members: new Map(),
            messages: [],
            cleanupTimer: null
          });
          console.log(`[Room] 🏠 Tự động khởi tạo phòng mới: ${targetRoomId} (Host: ${socket.id})`);
        }

        const room = rooms.get(targetRoomId)!;
        room.lastActivityAt = Date.now();
        const existingGameForRoom = gameSessions.get(targetRoomId);

        // Chặn người lạ bên ngoài tự ý gọi join_room vào phòng QUICK_MATCH hoặc RACE_1V1 (trừ khi là thành viên của phòng đó đang reconnect)
        if (room.mode === 'QUICK_MATCH' || room.mode === 'RACE_1V1') {
          const isExistingOrReconnectingMember =
            room.members.has(socket.id) ||
            Boolean(
              resolvedUserId &&
                (Array.from(room.members.values()).some(m => m.userId === resolvedUserId) ||
                  existingGameForRoom?.disconnectedPlayers.has(resolvedUserId))
            );
          if (!isExistingOrReconnectingMember) {
            socket.emit('game_error', {
              code: ErrorCode.ROOM_NOT_FOUND,
              message: ErrorCode.ROOM_NOT_FOUND
            });
            if (callback) {
              callback({
                success: false,
                code: ErrorCode.ROOM_NOT_FOUND,
                message: ErrorCode.ROOM_NOT_FOUND
              });
            }
            return;
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

        const maxAllowedMembers = room.targetPlayers || MAX_MEMBERS_PER_ROOM;
        if (!room.members.has(socket.id) && room.members.size >= maxAllowedMembers) {
          if (callback) {
            callback({
              success: false,
              code: ErrorCode.ROOM_FULL,
              message: ErrorCode.ROOM_FULL,
              messageParams: { maxMembers: maxAllowedMembers }
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

  // 9. TÌM TRẬN NHANH / GHÉP PHÒNG TỰ ĐỘNG (find_match, quick_match, race_1v1, find_1v1_match)
  // Luồng hoạt động:
  // - Hỗ trợ 2 chế độ Matchmaking:
  //     + QUICK_MATCH (4P, targetPlayers = 4, bù tối đa 3 Bot khi hết giờ).
  //     + RACE_1V1 (2P Solo 1v1, targetPlayers = 2, bù 1 Bot khi hết giờ).
  // - Khi ở Quick Match ghép được thêm người thật mới (2/4 hoặc 3/4) mà đồng hồ còn < 5s -> Cộng giờ mềm +5s (trần tối đa 16s) rồi hết giờ tự bù Bot.
  const createBotFallbackRoomAndStart = (entry: MatchmakingQueueEntry): Record<string, unknown> => {
    cancelMatchmakingForSocket(entry.socket.id);

    const resolvedMode: GameModeType = entry.mode === 'RACE_1V1' ? 'RACE_1V1' : 'QUICK_MATCH';
    const resolvedTargetPlayers =
      entry.targetPlayers || (resolvedMode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS);

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room: RoomData = {
      id: newRoomId,
      name: entry.userName,
      createdAt: Date.now(),
      hostId: entry.socket.id,
      hostUserId: entry.userId,
      mode: resolvedMode,
      targetPlayers: resolvedTargetPlayers,
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

    const game = new MimicGameSession(room.id, io, {
      gameMode: resolvedMode,
      targetPlayers: resolvedTargetPlayers
    });
    game.hostId = room.hostId;
    game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
    gameSessions.set(room.id, game);
    game.addPlayer(entry.socket.id, userObj.userName, userObj.avatar, 'HOST', userObj.userId, true);

    const filled = fillRoomWithBots(room.id, {
      botCount: entry.botCount,
      minPlayers: resolvedTargetPlayers,
      difficulty: entry.botDifficulty
    });
    const botsAdded = filled.botsAdded;

    let autoStarted = false;
    if (entry.autoStart !== false) {
      autoStarted = game.startGame({ requireAllReady: false });
    }

    console.log(
      `[Matchmaking] ⏰ Hết thời gian chờ (${entry.waitMs}ms) [${resolvedMode}] -> Tạo phòng ${room.id}, thêm ${botsAdded} Bot AI & autoStart=${autoStarted}`
    );

    const responseData = {
      success: true,
      searching: false,
      mode: resolvedMode,
      targetPlayers: resolvedTargetPlayers,
      matchedWithHumans: false,
      timedOutToBots: true,
      botsAdded,
      autoStarted,
      roomId: room.id,
      room: {
        id: room.id,
        name: room.name,
        hostId: room.hostId,
        mode: resolvedMode,
        targetPlayers: resolvedTargetPlayers,
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
      mode,
      botCount,
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

      const rawMode = String(mode || 'QUICK_MATCH').trim().toUpperCase();
      const resolvedMode: GameModeType =
        rawMode === 'RACE_1V1' || rawMode === '1V1' || rawMode === '1VS1' ? 'RACE_1V1' : 'QUICK_MATCH';
      const resolvedTargetPlayers =
        resolvedMode === 'RACE_1V1' ? RACE_1V1_PLAYERS : DEFAULT_MIN_PLAYERS_WITH_BOTS;
      const defaultBotsForMode = resolvedMode === 'RACE_1V1' ? 1 : DEFAULT_MATCHMAKING_BOT_COUNT;
      const resolvedBotCount =
        typeof botCount === 'number' && botCount > 0
          ? Math.min(resolvedTargetPlayers - 1, Math.max(1, botCount))
          : defaultBotsForMode;
      const resolvedDiff = botDifficulty ? (String(botDifficulty).toUpperCase() as BotDifficulty) : undefined;

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

      // 1A (Best-Fit + FIFO Priority). Ưu tiên tìm phòng cùng mode đang chờ gom người (3/4 -> 2/4 chờ lâu nhất) TRƯỚC khi ghép người đứng lẻ 1/4 trong Queue!
      const existingRoom = findAvailableMatchmakingRoom(socket.id, resolvedMode);
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
          game = new MimicGameSession(room.id, io, {
            gameMode: resolvedMode,
            targetPlayers: resolvedTargetPlayers
          });
          game.hostId = room.hostId;
          game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
          gameSessions.set(room.id, game);
        }
        game.addPlayer(socket.id, currentUser.userName, currentUser.avatar, currentUser.role, currentUser.userId, true);

        // Tự động hút thêm các User cùng mode đang đứng lẻ trong matchmakingQueue (nếu còn ghế trống)
        drainMatchmakingQueueIntoRoom(room.id);

        socket.to(room.id).emit('user_joined', {
          user: currentUser,
          members: getRoomMembersArray(room),
          systemMessage: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageCode: SystemMessageCode.SYS_PLAYER_JOINED_ROOM,
          messageParams: { userName: currentUser.userName, role: currentUser.role }
        });

        // Kiểm tra cộng giờ mềm Dynamic Queue Extension (+5s nếu còn < 5s) hoặc bắt đầu ngay nếu đã đủ targetPlayers
        const extResult = extendRoomMatchmakingOnPlayerJoin(room.id);

        const responseData = {
          success: true,
          searching: Boolean(room.matchmakingEndsAt) && !extResult.startedImmediately,
          mode: resolvedMode,
          targetPlayers: resolvedTargetPlayers,
          matchedWithHumans: true,
          extendedQueue: extResult.extended,
          botsAdded: 0,
          autoStarted: extResult.startedImmediately,
          roomId: room.id,
          room: {
            id: room.id,
            name: room.name,
            hostId: room.hostId,
            mode: resolvedMode,
            targetPlayers: resolvedTargetPlayers,
            members: getRoomMembersArray(room),
            messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
          },
          user: currentUser,
          gameState: game.getStateSnapshot()
        };

        console.log(
          `[Matchmaking] 🤝 [Best-Fit] Ghép ${currentUser.userName} vào phòng đang chờ [${resolvedMode}] (${room.members.size}/${resolvedTargetPlayers}): ${room.id}`
        );
        socket.emit('joined_room_success', responseData);
        socket.emit('match_found', responseData);
        if (callback) callback(responseData);
        return;
      }

      // 1B. Nếu chưa có phòng gom dở nào -> Kiểm tra xem có User nào khác cùng chế độ (mode) đang chờ lẻ (1/4) trong matchmakingQueue không
      let waitingPeer: MatchmakingQueueEntry | null = null;
      for (const [peerSockId, entry] of matchmakingQueue.entries()) {
        const entryMode: GameModeType = entry.mode === 'RACE_1V1' ? 'RACE_1V1' : 'QUICK_MATCH';
        if (peerSockId !== socket.id && entryMode === resolvedMode) {
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
          mode: resolvedMode,
          targetPlayers: resolvedTargetPlayers,
          members: new Map(),
          messages: [],
          cleanupTimer: null
        };
        rooms.set(newRoomId, room);

        const game = new MimicGameSession(room.id, io, {
          gameMode: resolvedMode,
          targetPlayers: resolvedTargetPlayers
        });
        game.hostId = room.hostId;
        game.onGameOverRematchReady = (rId) => reopenRoomForMatchmaking(rId);
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

        // Gộp thêm toàn bộ các User khác cùng mode đang rảnh trong matchmakingQueue (nếu còn chỗ)
        const extraPeers: MatchmakingQueueEntry[] = [];
        for (const [otherId, otherEntry] of Array.from(matchmakingQueue.entries())) {
          if (room.members.size >= resolvedTargetPlayers) break;
          if (otherId === socket.id || otherId === hostEntry.socket.id) continue;
          const otherMode: GameModeType = otherEntry.mode === 'RACE_1V1' ? 'RACE_1V1' : 'QUICK_MATCH';
          if (otherMode !== resolvedMode) continue;
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

        // Nếu đã đủ số người mục tiêu (2/2 với RACE_1V1 hoặc 4/4 với QUICK_MATCH) và autoStart=true -> Bắt đầu ngay!
        // Nếu chưa đủ (ví dụ 2/4 ở QUICK_MATCH) -> Bật đồng hồ đếm ngược phòng (cộng giờ mềm +5s nếu còn < 5s, trần 16s) để tìm thêm người thứ 3, 4 hoặc tự bù Bot khi hết giờ!
        let autoStarted = false;
        if (room.members.size >= resolvedTargetPlayers && autoStart !== false && hostEntry.autoStart !== false) {
          autoStarted = game.startGame({ requireAllReady: false });
        } else if (room.members.size < resolvedTargetPlayers) {
          const now = Date.now();
          const hostElapsed = Math.max(0, now - hostEntry.joinedQueueAt);
          let remainingForRoomMs = Math.max(0, hostEntry.waitMs - hostElapsed);
          const maxCapRemaining = Math.max(0, MATCHMAKING_MAX_WAIT_CAP_MS - hostElapsed);
          if (remainingForRoomMs < MATCHMAKING_EXTEND_MS) {
            remainingForRoomMs = Math.min(maxCapRemaining, MATCHMAKING_EXTEND_MS);
          }
          if (remainingForRoomMs > 0) {
            startRoomMatchmakingCountdown(room.id, {
              waitMs: remainingForRoomMs,
              mode: resolvedMode,
              targetPlayers: resolvedTargetPlayers,
              autoStart: autoStart !== false && hostEntry.autoStart !== false,
              difficulty: resolvedDiff || hostEntry.botDifficulty
            });
          }
        }

        const membersList = getRoomMembersArray(room);
        const roomSnapshot = {
          id: room.id,
          name: room.name,
          hostId: room.hostId,
          mode: resolvedMode,
          targetPlayers: resolvedTargetPlayers,
          members: membersList,
          messages: room.messages.slice(-MAX_CHAT_HISTORY_SIZE)
        };
        const stateSnapshot = game.getStateSnapshot();

        // Thông báo cho Host (người đang chờ trong queue)
        const hostPayload = {
          success: true,
          searching: room.members.size < resolvedTargetPlayers && Boolean(room.matchmakingEndsAt),
          mode: resolvedMode,
          targetPlayers: resolvedTargetPlayers,
          matchedWithHumans: true,
          botsAdded: 0,
          autoStarted,
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
          searching: room.members.size < resolvedTargetPlayers && Boolean(room.matchmakingEndsAt),
          mode: resolvedMode,
          targetPlayers: resolvedTargetPlayers,
          matchedWithHumans: true,
          botsAdded: 0,
          autoStarted,
          roomId: room.id,
          room: roomSnapshot,
          user: currentUser,
          gameState: stateSnapshot
        };

        console.log(
          `[Matchmaking] 🤝 Ghép thành công ${room.members.size}/${resolvedTargetPlayers} người chơi [${resolvedMode}] vào phòng mới: ${room.id}`
        );

        socket.emit('joined_room_success', currentPayload);
        socket.emit('match_found', currentPayload);
        if (callback) callback(currentPayload);
        return;
      }

      // 2. KHÔNG tìm thấy phòng hoặc User nào đang rảnh -> Đưa vào hàng đợi và bật Timer chờ!
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
        mode: resolvedMode,
        targetPlayers: resolvedTargetPlayers,
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
      const startedAt = queueEntry.joinedQueueAt;
      const endsAt = startedAt + resolvedWaitMs;
      const soloSlotMembers = [
        {
          socketId: socket.id,
          userId: resolvedUserId,
          userName: cleanName,
          avatar: cleanAvatar,
          role: 'HOST' as const,
          isReady: true,
          isBot: false,
          botDifficulty: null,
          joinedAt: startedAt
        }
      ];

      console.log(
        `[Matchmaking] 🔍 ${cleanName} (${socket.id}) bắt đầu chờ tìm trận [${resolvedMode}] trong ${resolvedWaitMs}ms...`
      );

      socket.emit('matchmaking_searching', {
        searching: true,
        state: 'FINDING_MATCH',
        mode: resolvedMode,
        currentPlayers: 1,
        targetPlayers: resolvedTargetPlayers,
        members: soloSlotMembers,
        waitMs: resolvedWaitMs,
        remainingMs: remainingSeconds * 1000,
        timeRemaining: remainingSeconds,
        elapsedSeconds: 0,
        totalWaitSeconds,
        totalDuration: totalWaitSeconds,
        progressPercent: 0,
        startedAt,
        endsAt,
        timestamp: startedAt,
        systemMessage: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
        messageCode: SystemMessageCode.SYS_MATCHMAKING_SEARCHING,
        messageParams: { waitSeconds: remainingSeconds, waitMs: resolvedWaitMs }
      });

      // Phát ngay tick đầu tiên (t = 0s) và đếm ngược mỗi giây (matchmaking_tick) để UI chỉ việc hiển thị timer từ Server
      socket.emit('matchmaking_tick', {
        searching: true,
        state: 'FINDING_MATCH',
        mode: resolvedMode,
        currentPlayers: 1,
        targetPlayers: resolvedTargetPlayers,
        members: soloSlotMembers,
        waitMs: resolvedWaitMs,
        remainingMs: remainingSeconds * 1000,
        timeRemaining: remainingSeconds,
        elapsedSeconds: 0,
        totalWaitSeconds,
        totalDuration: totalWaitSeconds,
        progressPercent: 0,
        startedAt,
        endsAt,
        timestamp: startedAt
      });

      if (resolvedWaitMs >= 1000) {
        queueEntry.tickTimer = setInterval(() => {
          remainingSeconds = Math.max(0, remainingSeconds - 1);
          const elapsedSeconds = Math.max(0, totalWaitSeconds - remainingSeconds);
          socket.emit('matchmaking_tick', {
            searching: true,
            state: 'FINDING_MATCH',
            mode: resolvedMode,
            currentPlayers: 1,
            targetPlayers: resolvedTargetPlayers,
            members: soloSlotMembers,
            waitMs: resolvedWaitMs,
            remainingMs: remainingSeconds * 1000,
            timeRemaining: remainingSeconds,
            elapsedSeconds,
            totalWaitSeconds,
            totalDuration: totalWaitSeconds,
            progressPercent: Math.max(
              0,
              Math.min(100, Math.round((elapsedSeconds / totalWaitSeconds) * 100))
            ),
            startedAt,
            endsAt,
            timestamp: Date.now()
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
  socket.on('race_1v1', (payload: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) =>
    handleQuickMatch({ ...payload, mode: 'RACE_1V1' }, callback)
  );
  socket.on('find_1v1_match', (payload: Record<string, any> = {}, callback?: (res: Record<string, unknown>) => void) =>
    handleQuickMatch({ ...payload, mode: 'RACE_1V1' }, callback)
  );

  // 10. LẤY TRẠNG THÁI TIMER FIND MATCH HIỆN TẠI TỪ SERVER (get_matchmaking_state)
  socket.on(
    'get_matchmaking_state',
    (_data: unknown, callback?: (res: Record<string, unknown>) => void) => {
      const entry = matchmakingQueue.get(socket.id);
      if (!entry) {
        const activeRoom = sessionState.currentRoomId ? rooms.get(sessionState.currentRoomId) : null;
        if (activeRoom && activeRoom.matchmakingEndsAt && activeRoom.matchmakingStartedAt) {
          const now = Date.now();
          const remainingMs = Math.max(0, activeRoom.matchmakingEndsAt - now);
          const timeRemaining = Math.ceil(remainingMs / 1000);
          const totalMs = Math.max(1000, activeRoom.matchmakingEndsAt - activeRoom.matchmakingStartedAt);
          const totalWaitSeconds = Math.ceil(totalMs / 1000);
          const elapsedSeconds = Math.max(0, totalWaitSeconds - timeRemaining);
          const humanCount = Array.from(activeRoom.members.values()).filter(m => !isBotMember(m)).length;
          const roomPayload = {
            searching: true,
            state: 'FINDING_MATCH',
            roomId: activeRoom.id,
            mode: activeRoom.mode || 'QUICK_MATCH',
            currentPlayers: humanCount,
            targetPlayers: activeRoom.targetPlayers || DEFAULT_MIN_PLAYERS_WITH_BOTS,
            members: getRoomMembersArray(activeRoom),
            waitMs: totalMs,
            remainingMs,
            timeRemaining,
            elapsedSeconds,
            totalWaitSeconds,
            totalDuration: totalWaitSeconds,
            progressPercent: Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalWaitSeconds) * 100))),
            startedAt: activeRoom.matchmakingStartedAt,
            endsAt: activeRoom.matchmakingEndsAt,
            timestamp: now
          };
          if (callback) callback(roomPayload);
          return;
        }

        const idlePayload = {
          searching: false,
          state: 'IDLE',
          waitMs: 0,
          remainingMs: 0,
          timeRemaining: 0,
          elapsedSeconds: 0,
          totalWaitSeconds: 0,
          totalDuration: 0,
          progressPercent: 0
        };
        if (callback) callback(idlePayload);
        return;
      }
      const totalWaitSeconds = Math.max(1, Math.ceil(entry.waitMs / 1000));
      const elapsedMs = Math.max(0, Date.now() - entry.joinedQueueAt);
      const remainingMs = Math.max(0, entry.waitMs - elapsedMs);
      const timeRemaining = Math.ceil(remainingMs / 1000);
      const elapsedSeconds = Math.max(0, totalWaitSeconds - timeRemaining);
      const activePayload = {
        searching: true,
        state: 'FINDING_MATCH',
        mode: entry.mode || 'QUICK_MATCH',
        currentPlayers: 1,
        targetPlayers: entry.targetPlayers || DEFAULT_MIN_PLAYERS_WITH_BOTS,
        members: [
          {
            socketId: entry.socket.id,
            userId: entry.userId,
            userName: entry.userName,
            avatar: entry.avatar,
            role: 'HOST',
            isReady: true,
            isBot: false,
            botDifficulty: null,
            joinedAt: entry.joinedQueueAt
          }
        ],
        waitMs: entry.waitMs,
        remainingMs,
        timeRemaining,
        elapsedSeconds,
        totalWaitSeconds,
        totalDuration: totalWaitSeconds,
        progressPercent: Math.max(0, Math.min(100, Math.round((elapsedSeconds / totalWaitSeconds) * 100))),
        startedAt: entry.joinedQueueAt,
        endsAt: entry.joinedQueueAt + entry.waitMs,
        timestamp: Date.now()
      };
      if (callback) callback(activePayload);
    }
  );

  // 11. HỦY TÌM TRẬN NHANH HỢP NHẤT (Unified Cancel Match: cancel_match & cancel_quick_match)
  // Hỗ trợ hủy cả khi đang đứng lẻ 1/4 trong Queue lẫn khi đã được gom tạm vào phòng 2/4, 3/4 đang đếm ngược trước khi Start Game
  const handleCancelMatchmaking = (
    dataOrCallback?: unknown,
    maybeCallback?: (res: Record<string, unknown>) => void
  ): void => {
    const callback =
      typeof dataOrCallback === 'function'
        ? (dataOrCallback as (res: Record<string, unknown>) => void)
        : maybeCallback;

    let cancelled = Boolean(cancelMatchmakingForSocket(socket.id));
    let cancelledFromPreStartRoom = false;

    if (!cancelled && sessionState.currentRoomId) {
      const activeRoom = rooms.get(sessionState.currentRoomId);
      const activeGame = gameSessions.get(sessionState.currentRoomId);
      const isMatchmakingRoom =
        activeRoom && (activeRoom.mode === 'QUICK_MATCH' || activeRoom.mode === 'RACE_1V1');
      const isPreStart = !activeGame || activeGame.state === 'IDLE';
      if (isMatchmakingRoom && isPreStart) {
        leaveCurrentRoom(socket, sessionState.currentRoomId, currentUser);
        sessionState.currentRoomId = null;
        sessionState.isSearchingMatch = false;
        cancelled = true;
        cancelledFromPreStartRoom = true;
      }
    }

    const payload = {
      success: true,
      cancelled,
      cancelledFromPreStartRoom,
      searching: false,
      state: 'IDLE',
      timeRemaining: 0,
      remainingMs: 0,
      systemMessage: SystemMessageCode.SYS_MATCHMAKING_CANCELLED,
      messageCode: SystemMessageCode.SYS_MATCHMAKING_CANCELLED
    };
    socket.emit('matchmaking_cancelled', payload);
    if (callback) callback(payload);
  };

  socket.on('cancel_match', handleCancelMatchmaking);
  socket.on('cancel_quick_match', handleCancelMatchmaking);
}
