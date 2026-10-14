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

  // 3. create_room valid + duplicate create_room -> ErrorCode.ROOM_ID_ALREADY_EXISTS
  hostMock.handlers.get('create_room')!({ roomId: 'ENUM_RM', roomName: 'Enum Room' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);

  hostMock.handlers.get('create_room')!({ roomId: 'ENUM_RM' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.code, ErrorCode.ROOM_ID_ALREADY_EXISTS);

  // 4. Host & Player join_room 'ENUM_RM'
  await hostMock.handlers.get('join_room')!({ roomId: 'ENUM_RM', userName: 'HostOne' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);

  await playerMock.handlers.get('join_room')!({ roomId: 'ENUM_RM', userName: 'PlayerTwo' }, (r: any) => {
    cbRes = r;
  });
  assert.equal(cbRes.success, true);

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

  destroyRoomData('ENUM_RM');
  assert.equal(rooms.has('ENUM_RM'), false);
  assert.equal(gameSessions.has('ENUM_RM'), false);
});
