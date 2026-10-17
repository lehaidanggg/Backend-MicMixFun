import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, SystemMessageCode } from '../src/config/messages';
import { rooms, gameSessions, destroyRoomData } from '../src/services/room.service';
import { registerRoomHandlers } from '../src/socket/room.handler';
import { registerMediaHandlers } from '../src/socket/media.handler';
import { registerGameHandlers } from '../src/socket/game.handler';
import { SocketSessionState } from '../src/types';

function createFakeSocket(id: string) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const emittedToSelf: Array<{ event: string; payload: any }> = [];
  const emittedToRoom: Array<{ room: string; event: string; payload: any }> = [];

  const socket: any = {
    id,
    clientFingerprint: `fp_${id}`,
    clientIp: '127.0.0.1',
    on(event: string, fn: (...args: any[]) => any) {
      handlers.set(event, fn);
    },
    emit(event: string, payload: any) {
      emittedToSelf.push({ event, payload });
    },
    join(_room: string) {},
    leave(_room: string) {},
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emittedToRoom.push({ room, event, payload });
        }
      };
    }
  };

  return { socket, handlers, emittedToSelf, emittedToRoom };
}

function createFakeIo(socketMap: Map<string, any>) {
  const broadcasted: Array<{ room: string; event: string; payload: any }> = [];
  const io: any = {
    sockets: {
      sockets: socketMap
    },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          broadcasted.push({ room, event, payload });
        }
      };
    }
  };
  return { io, broadcasted };
}

test('Socket Handlers — Decision Matrix: Room, Media & Game Enum Error/Message Codes', async () => {
  const socketMap = new Map<string, any>();
  const { io, broadcasted } = createFakeIo(socketMap);

  const hostMock = createFakeSocket('sock_host_1');
  const playerMock = createFakeSocket('sock_player_2');
  socketMap.set(hostMock.socket.id, hostMock.socket);
  socketMap.set(playerMock.socket.id, playerMock.socket);

  const hostSession: SocketSessionState = {
    currentRoomId: null,
    currentUser: {
      socketId: hostMock.socket.id,
      userId: 'u_host',
      userName: 'HostOne',
      avatar: '👑',
      isAuthenticated: true
    }
  };

  const playerSession: SocketSessionState = {
    currentRoomId: null,
    currentUser: {
      socketId: playerMock.socket.id,
      userId: 'u_player',
      userName: 'PlayerTwo',
      avatar: '🦊',
      isAuthenticated: true
    }
  };

  let allowRate = true;
  const checkRateLimit = () => allowRate;

  registerRoomHandlers(io, hostMock.socket, hostSession);
  registerMediaHandlers(io, hostMock.socket, hostSession, checkRateLimit);
  registerGameHandlers(io, hostMock.socket, hostSession, checkRateLimit);

  registerRoomHandlers(io, playerMock.socket, playerSession);
  registerMediaHandlers(io, playerMock.socket, playerSession, checkRateLimit);
  registerGameHandlers(io, playerMock.socket, playerSession, checkRateLimit);

  // 1. Media before joining room -> ErrorCode.ROOM_NOT_JOINED
  let cbRes: any = null;
  hostMock.handlers.get('send_message')!({ message: 'hi' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_NOT_JOINED);

  // 2. join_room without roomId -> ErrorCode.ROOM_ID_REQUIRED
  await hostMock.handlers.get('join_room')!({ roomId: '' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_ID_REQUIRED);

  // 2b. join_room on a non-existent roomId -> ErrorCode.ROOM_NOT_FOUND
  await playerMock.handlers.get('join_room')!({ roomId: 'TYPO_999' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, false);
  assert.equal(cbRes.code, ErrorCode.ROOM_NOT_FOUND);

  // 3. create_room valid (immediately puts Host into room.members) + duplicate create_room -> ErrorCode.ROOM_ID_ALREADY_EXISTS
  hostMock.handlers.get('create_room')!({ roomId: 'ENUM_RM', roomName: 'Enum Room', userName: 'HostOne' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.room.members.length, 1);
  assert.equal(cbRes.room.members[0].role, 'HOST');
  assert.equal(hostSession.currentRoomId, 'ENUM_RM');

  hostMock.handlers.get('create_room')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_ID_ALREADY_EXISTS);

  // 4. Host & Player join_room 'ENUM_RM' (Host re-join is idempotent, Player joins as 2nd member)
  await hostMock.handlers.get('join_room')!({ roomId: 'ENUM_RM', userName: 'HostOne' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);

  await playerMock.handlers.get('join_room')!({ roomId: 'ENUM_RM', userName: 'PlayerTwo' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.room.members.length, 2);

  // 5. Rate limit exceeded on chat & sound -> RATE_LIMIT_CHAT_EXCEEDED / RATE_LIMIT_SOUND_EXCEEDED
  allowRate = false;
  hostMock.handlers.get('send_message')!({ message: 'spam' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.RATE_LIMIT_CHAT_EXCEEDED);

  hostMock.handlers.get('trigger_sound')!({ soundId: 'cat-two' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.RATE_LIMIT_SOUND_EXCEEDED);
  allowRate = true;

  // 6. Non-host attempts game_start, game_update_config, kick_player, close_room
  playerMock.handlers.get('game_start')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.GAME_HOST_ONLY_START);

  playerMock.handlers.get('game_update_config')!({ roomId: 'ENUM_RM', totalRounds: 5 }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.GAME_HOST_ONLY_CONFIG);

  playerMock.handlers.get('kick_player')!({ roomId: 'ENUM_RM', targetSocketId: hostMock.socket.id }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_HOST_ONLY_KICK);

  playerMock.handlers.get('close_room')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_HOST_ONLY_CLOSE);

  // 7. Host tries to start game with requireAllReady=true while PlayerTwo is unready -> GAME_PLAYERS_NOT_READY
  hostMock.handlers.get('game_start')!({ roomId: 'ENUM_RM', requireAllReady: true }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.GAME_PLAYERS_NOT_READY);

  // 8. Host tries to kick self -> ROOM_CANNOT_KICK_SELF
  hostMock.handlers.get('kick_player')!({ roomId: 'ENUM_RM', targetSocketId: hostMock.socket.id }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_CANNOT_KICK_SELF);

  // 9. Host updates config -> broadcasts SYS_GAME_CONFIG_UPDATED
  hostMock.handlers.get('game_update_config')!({ roomId: 'ENUM_RM', totalRounds: 5, recordDuration: 6 }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  const cfgEvent = broadcasted.find(b => b.event === 'game_config_changed');
  assert.equal(cfgEvent?.payload.systemMessage, SystemMessageCode.SYS_GAME_CONFIG_UPDATED);

  // 10. Non-host attempts add_bot / remove_bot -> BOT_HOST_ONLY_MANAGE
  playerMock.handlers.get('add_bot')!({ roomId: 'ENUM_RM', difficulty: 'HARD' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.BOT_HOST_ONLY_MANAGE);

  playerMock.handlers.get('remove_bot')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.BOT_HOST_ONLY_MANAGE);

  // 11. Host removes bot when none exist -> BOT_NOT_FOUND
  hostMock.handlers.get('remove_bot')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.BOT_NOT_FOUND);

  // 12. Host adds a bot and removes it -> SYS_BOT_JOINED_ROOM & SYS_BOT_REMOVED_FROM_ROOM
  hostMock.handlers.get('add_bot')!({ roomId: 'ENUM_RM', difficulty: 'HARD', botName: 'CyberBot' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.bot.userName, 'CyberBot');
  assert.equal(cbRes.bot.isBot, true);
  assert.equal(cbRes.bot.botDifficulty, 'HARD');

  hostMock.handlers.get('remove_bot')!({ roomId: 'ENUM_RM', botSocketId: cbRes.bot.socketId }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.removedBot.userName, 'CyberBot');

  // 12b. In a 2-player Private Room (ENUM_RM), Host starts game without autoFillBots -> starts clean 2P match (0 unwanted bots)
  hostMock.handlers.get('game_start')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.botsAdded, 0);
  assert.equal(cbRes.totalPlayers, 2);

  destroyRoomData('ENUM_RM');
  assert.equal(rooms.has('ENUM_RM'), false);
  assert.equal(gameSessions.has('ENUM_RM'), false);

  // 13. Solo Host creates room & starts game -> automatically spawns 3 Bots so totalPlayers = 4
  hostMock.handlers.get('create_room')!({ roomId: 'SOLO_RM', userName: 'SoloHost' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);

  hostMock.handlers.get('game_start')!({ roomId: 'SOLO_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);
  assert.equal(cbRes.botsAdded, 3);
  assert.equal(cbRes.totalPlayers, 4);

  destroyRoomData('SOLO_RM');

  // 14. Quick Match / Find Match: 2 IDLE users searching concurrently -> paired into the same room immediately
  // Also verify Unified Cancel Match (cancelling from a 2/4 pre-start room removes player and updates remaining member)
  let p1MatchRes: any = null;
  let p2MatchRes: any = null;
  await hostMock.handlers.get('quick_match')!({ userName: 'IdleUser1', waitMs: 5000 }, (r: any) => {
    p1MatchRes = r;
  });
  // While IdleUser1 is waiting on timer, matchmaking_searching is emitted with live members slot (1/4)
  const searchingEvt = hostMock.emittedToSelf.find(e => e.event === 'matchmaking_searching');
  assert.equal(Boolean(searchingEvt), true);
  assert.equal(searchingEvt?.payload.searching, true);
  assert.equal(searchingEvt?.payload.currentPlayers, 1);
  assert.equal(searchingEvt?.payload.members?.length, 1);

  // IdleUser2 calls quick_match while IdleUser1 is waiting -> both get paired into a 2/4 pre-start room!
  await playerMock.handlers.get('quick_match')!({ userName: 'IdleUser2', waitMs: 5000 }, (r: any) => {
    p2MatchRes = r;
  });
  assert.equal(p1MatchRes?.success, true);
  assert.equal(p1MatchRes?.matchedWithHumans, true);
  assert.equal(p2MatchRes?.success, true);
  assert.equal(p2MatchRes?.matchedWithHumans, true);
  assert.equal(p1MatchRes?.roomId, p2MatchRes?.roomId);
  assert.equal(p2MatchRes?.room.members.length, 2);

  // Unified Cancel Match: IdleUser2 cancels while in the 2/4 pre-start room -> cleanly removed from room
  let cancelPreStartRes: any = null;
  playerMock.handlers.get('cancel_match')!({}, (r: any) => {
    cancelPreStartRes = r;
  });
  assert.equal(cancelPreStartRes?.success, true);
  assert.equal(cancelPreStartRes?.cancelledFromPreStartRoom, true);
  assert.equal(rooms.get(p1MatchRes.roomId)?.members.size, 1);

  destroyRoomData(p1MatchRes.roomId);
  hostSession.currentRoomId = null;
  playerSession.currentRoomId = null;

  // 15. Quick Match / Find Match when no other IDLE user is found after timer expires:
  // Opens room, adds 3 Bots (pre-accepted 3/4), broadcasts Popup Find Match (showMatchFoundPopup: true, acceptedCount: 3, totalPlayers: 4),
  // and starts gameplay once the human player accepts via accept_match!
  const timeoutRes: any = await new Promise(resolve => {
    hostMock.handlers.get('quick_match')!({ userName: 'QuickSoloPlayer', waitMs: 40 }, (r: any) => {
      resolve(r);
    });
  });
  assert.equal(timeoutRes.success, true);
  assert.equal(timeoutRes.matchedWithHumans, false);
  assert.equal(timeoutRes.timedOutToBots, true);
  assert.equal(timeoutRes.botsAdded, 3);
  assert.equal(timeoutRes.state, 'MATCH_FOUND');
  assert.equal(timeoutRes.showMatchFoundPopup, true);
  assert.equal(timeoutRes.acceptedCount, 3);
  assert.equal(timeoutRes.totalPlayers, 4);
  assert.equal(timeoutRes.allAccepted, false);
  assert.equal(timeoutRes.autoStarted, false);
  assert.equal(timeoutRes.room.members.length, 4);

  let acceptSoloRes: any = null;
  hostMock.handlers.get('accept_match')!({ roomId: timeoutRes.roomId }, (r: any) => {
    acceptSoloRes = r;
  });
  assert.equal(acceptSoloRes?.success, true);
  assert.equal(acceptSoloRes?.acceptedCount, 4);
  assert.equal(acceptSoloRes?.totalPlayers, 4);
  assert.equal(acceptSoloRes?.allAccepted, true);
  assert.equal(acceptSoloRes?.autoStarted, true);
  assert.equal(gameSessions.get(timeoutRes.roomId)?.state, 'THEME_SELECTION');

  // 15b. User leaves Quick Match mid-game -> opens Create Room (even passing stale QM roomId) or tries join_room on QM room:
  // Must NEVER reconnect back to the Quick Match room!
  const staleQmRoomId = timeoutRes.roomId;
  let joinQmAttempt: any = null;
  await hostMock.handlers.get('join_room')!({ roomId: staleQmRoomId, userName: 'QuickSoloPlayer' }, (r: any) => {
    joinQmAttempt = r;
  });
  assert.equal(joinQmAttempt?.success, false);
  assert.equal(joinQmAttempt?.code, ErrorCode.ROOM_NOT_FOUND);
  assert.equal(rooms.has(staleQmRoomId), false, 'QM room with 0 humans must be destroyed immediately');

  // Even if another QM room is still alive with another player and user leaves mid-game then calls create_room with stale roomId:
  let customAfterQmRes: any = null;
  hostMock.handlers.get('create_room')!({ roomId: staleQmRoomId, userName: 'HostAfterQm' }, (r: any) => {
    customAfterQmRes = r;
  });
  assert.equal(customAfterQmRes?.success, true);
  assert.equal(customAfterQmRes?.mode, 'CUSTOM_ROOM');
  assert.equal(customAfterQmRes?.room.mode, 'CUSTOM_ROOM');
  destroyRoomData(customAfterQmRes.roomId);
  hostSession.currentRoomId = null;

  // 16. Custom Room Isolation & Race 1v1 Popup Find Match + Accept (2 humans -> 0/2 -> 1/2 -> 2/2 accepted -> autoStarted)
  let customRoomRes: any = null;
  await hostMock.handlers.get('create_room')!({ userName: 'CustomHost' }, (r: any) => {
    customRoomRes = r;
  });
  assert.equal(customRoomRes?.success, true);
  assert.equal(customRoomRes?.room.mode, 'CUSTOM_ROOM');
  destroyRoomData(customRoomRes.roomId);
  hostSession.currentRoomId = null;

  let r1v1P1: any = null;
  let r1v1P2: any = null;
  await hostMock.handlers.get('race_1v1')!({ userName: 'Duelist1', waitMs: 5000 }, (r: any) => {
    r1v1P1 = r;
  });
  await playerMock.handlers.get('race_1v1')!({ userName: 'Duelist2', waitMs: 5000 }, (r: any) => {
    r1v1P2 = r;
  });
  assert.equal(r1v1P1?.success, true);
  assert.equal(r1v1P2?.success, true);
  assert.equal(r1v1P1?.roomId, r1v1P2?.roomId);
  assert.equal(r1v1P1?.state, 'MATCH_FOUND');
  assert.equal(r1v1P1?.showMatchFoundPopup, true);
  assert.equal(r1v1P1?.acceptedCount, 0);
  assert.equal(r1v1P1?.totalPlayers, 2);
  assert.equal(r1v1P2?.room.members.length, 2);

  // Duelist1 clicks Accept -> 1/2 accepted
  let accept1Res: any = null;
  hostMock.handlers.get('accept_match')!({ roomId: r1v1P1.roomId }, (r: any) => {
    accept1Res = r;
  });
  assert.equal(accept1Res?.success, true);
  assert.equal(accept1Res?.acceptedCount, 1);
  assert.equal(accept1Res?.totalPlayers, 2);
  assert.equal(accept1Res?.allAccepted, false);
  assert.equal(accept1Res?.autoStarted, false);

  // Duelist2 clicks Accept -> 2/2 accepted -> autoStarted = true & transitions to THEME_SELECTION!
  let accept2Res: any = null;
  playerMock.handlers.get('accept_match')!({ roomId: r1v1P1.roomId }, (r: any) => {
    accept2Res = r;
  });
  assert.equal(accept2Res?.success, true);
  assert.equal(accept2Res?.acceptedCount, 2);
  assert.equal(accept2Res?.totalPlayers, 2);
  assert.equal(accept2Res?.allAccepted, true);
  assert.equal(accept2Res?.autoStarted, true);
  assert.equal(gameSessions.get(r1v1P1.roomId)?.state, 'THEME_SELECTION');

  // If Duelist2 leaves mid-game and opens Create Room (without even calling leave_room first, or passing stale r1v1 roomId),
  // Duelist2 is cleanly removed from r1v1 room and put into a brand new CUSTOM_ROOM!
  let newCustomRes: any = null;
  playerMock.handlers.get('create_room')!({ roomId: r1v1P1.roomId, userName: 'Duelist2Custom' }, (r: any) => {
    newCustomRes = r;
  });
  assert.equal(newCustomRes?.success, true);
  assert.notEqual(newCustomRes?.roomId, r1v1P1.roomId, 'Must ignore stale matchmaking roomId and generate fresh CUSTOM_ROOM');
  assert.equal(newCustomRes?.mode, 'CUSTOM_ROOM');
  assert.equal(playerSession.currentRoomId, newCustomRes.roomId);
  assert.equal(Boolean(rooms.get(r1v1P1.roomId)?.members.has(playerMock.socket.id)), false);

  destroyRoomData(newCustomRes.roomId);
  destroyRoomData(r1v1P1.roomId);
});

