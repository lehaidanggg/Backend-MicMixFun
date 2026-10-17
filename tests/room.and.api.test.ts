import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { server, rooms, gameSessions, ErrorCode, SystemMessageCode } from '../src/server';
import { destroyRoomData, getRoomMembersArray, leaveCurrentRoom } from '../src/services/room.service';

function httpRequest(
  port: number,
  method: string,
  reqPath: string,
  body: Record<string, unknown> | null = null,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }
            : {}),
          ...headers
        }
      },
      res => {
        let raw = '';
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // keep raw string
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Room Service — Matrix Test: Host Migration & Empty Room Cleanup', () => {
  const roomId = 'MATRIX_ROOM_1';
  const emittedEvents: Array<{ event: string; payload: any }> = [];

  const createMockSocket = (id: string) =>
    ({
      id,
      leave() {},
      to() {
        return {
          emit(event: string, payload: any) {
            emittedEvents.push({ event, payload });
          }
        };
      }
    }) as any;

  rooms.set(roomId, {
    id: roomId,
    name: 'Test Room',
    createdAt: Date.now(),
    hostId: 'sock_1',
    hostUserId: 'u_1',
    members: new Map([
      [
        'sock_1',
        { socketId: 'sock_1', userId: 'u_1', userName: 'HostOne', avatar: '👑', role: 'HOST', isReady: true }
      ],
      [
        'sock_2',
        { socketId: 'sock_2', userId: 'u_2', userName: 'PlayerTwo', avatar: '🦊', role: 'PLAYER', isReady: false }
      ]
    ]),
    messages: [],
    cleanupTimer: null
  });

  const initialMembers = getRoomMembersArray(rooms.get(roomId));
  assert.equal(initialMembers.length, 2);

  // 1. Host leaves while PlayerTwo is still in room -> Host Migration to sock_2
  leaveCurrentRoom(createMockSocket('sock_1'), roomId);
  const roomAfterHostLeft = rooms.get(roomId)!;
  assert.equal(roomAfterHostLeft.hostId, 'sock_2', 'Host should migrate to sock_2');
  assert.equal(roomAfterHostLeft.members.get('sock_2')?.role, 'HOST');
  assert.equal(roomAfterHostLeft.members.get('sock_2')?.isReady, true);

  const leftEvent = emittedEvents.find(e => e.event === 'user_left');
  assert.equal(leftEvent?.payload.systemMessage, SystemMessageCode.SYS_USER_LEFT_ROOM);

  // 2. Last member leaves -> room destroyed immediately (0ms, no reconnect wait), destroyRoomData cleans RAM
  leaveCurrentRoom(createMockSocket('sock_2'), roomId);
  assert.equal(roomAfterHostLeft.members.size, 0);
  assert.equal(rooms.has(roomId), false);
  assert.equal(gameSessions.has(roomId), false);
});

test('REST API — Decision Matrix: Endpoints & Enum Error Codes', async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  try {
    // 1. Issue a valid Guest token first
    const guestRes = await httpRequest(port, 'POST', '/api/auth/guest', {
      userName: 'MatrixTester',
      avatar: '🎯',
      deviceId: 'matrix-dev-01'
    });
    assert.equal(guestRes.status, 200);
    assert.equal(guestRes.body.success, true);
    const validToken = guestRes.body.authToken as string;

    const apiMatrix: Array<{
      caseName: string;
      method: string;
      path: string;
      body?: Record<string, unknown> | null;
      headers?: Record<string, string>;
      expectedStatus: number;
      expectedCode?: ErrorCode;
    }> = [
      {
        caseName: 'GET /api/health returns 200 online',
        method: 'GET',
        path: '/api/health',
        expectedStatus: 200
      },
      {
        caseName: 'GET /api/auth/challenge issues one-time nonce',
        method: 'GET',
        path: '/api/auth/challenge',
        expectedStatus: 200
      },
      {
        caseName: 'GET /api/auth/verify with valid token + matching deviceId -> 200',
        method: 'GET',
        path: '/api/auth/verify',
        headers: { Authorization: `Bearer ${validToken}`, 'x-device-id': 'matrix-dev-01' },
        expectedStatus: 200
      },
      {
        caseName: 'GET /api/auth/verify with mismatched deviceId fingerprint -> 401 AUTH_TOKEN_INVALID_OR_EXPIRED',
        method: 'GET',
        path: '/api/auth/verify',
        headers: { Authorization: `Bearer ${validToken}`, 'x-device-id': 'relayed-other-device' },
        expectedStatus: 401,
        expectedCode: ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED
      },
      {
        caseName: 'GET /api/auth/verify with missing token -> 401 AUTH_TOKEN_INVALID_OR_EXPIRED',
        method: 'GET',
        path: '/api/auth/verify',
        expectedStatus: 401,
        expectedCode: ErrorCode.AUTH_TOKEN_INVALID_OR_EXPIRED
      },
      {
        caseName: 'POST /api/auth/firebase with invalid token -> 401 AUTH_FIREBASE_TOKEN_INVALID',
        method: 'POST',
        path: '/api/auth/firebase',
        body: { firebaseIdToken: 'invalid.jwt.token' },
        expectedStatus: 401,
        expectedCode: ErrorCode.AUTH_FIREBASE_TOKEN_INVALID
      },
      {
        caseName: 'GET /api/attempts/:roomId/:socketId for non-existent room -> 404 ROOM_NOT_FOUND',
        method: 'GET',
        path: '/api/attempts/NO_SUCH_ROOM/sock123',
        expectedStatus: 404,
        expectedCode: ErrorCode.ROOM_NOT_FOUND
      },
      {
        caseName: 'GET /api/enums returns full enum dictionary and VI/EN text descriptions',
        method: 'GET',
        path: '/api/enums',
        expectedStatus: 200
      },
      {
        caseName: 'GET /api/game-states returns states, labels, and localization enums',
        method: 'GET',
        path: '/api/game-states',
        expectedStatus: 200
      },
      {
        caseName: 'GET /api/mimic-packs returns sound packs with localization enum keys',
        method: 'GET',
        path: '/api/mimic-packs',
        expectedStatus: 200
      }
    ];

    for (const row of apiMatrix) {
      const res = await httpRequest(port, row.method, row.path, row.body || null, row.headers || {});
      assert.equal(res.status, row.expectedStatus, `[Matrix Fail] ${row.caseName}: status ${res.status}`);
      if (row.expectedCode) {
        assert.equal(res.body.code, row.expectedCode, `[Matrix Fail] ${row.caseName}: code ${res.body.code}`);
        assert.equal(res.body.message, row.expectedCode, `[Matrix Fail] ${row.caseName}: message ${res.body.message}`);
      }
      if (row.path === '/api/health') {
        assert.ok(res.body.stateCounters, 'GET /api/health must include stateCounters');
        assert.ok(res.body.memory, 'GET /api/health must include memory telemetry');
        assert.equal(typeof res.body.memory.rssMB, 'number');
      }
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Resource Guardrails — Zero-Residual Leak & Bounded Audio Decode Invariants', async () => {
  const { decodeBoundedBase64Audio } = await import('../src/services/audio.service');

  // 1. decodeBoundedBase64Audio phải từ chối chuỗi Base64 vượt trần TRƯỚC khi cấp phát Buffer
  const oversizedB64 = 'A'.repeat(2000); // ~1500 bytes > maxBytes=1024
  const rejected = decodeBoundedBase64Audio(oversizedB64, 1024);
  assert.equal(rejected.buffer, null);
  assert.equal(rejected.exceededMaxBytes, true);

  const validB64 = Buffer.from('hello-micmixfun').toString('base64');
  const accepted = decodeBoundedBase64Audio(validB64, 1024);
  assert.ok(accepted.buffer);
  assert.equal(accepted.exceededMaxBytes, false);

  // 2. Phòng QUICK_MATCH và RACE_1V1 phải bị xóa NGAY LẬP TỨC (0ms, không treo cleanupTimer 30s) khi người thật cuối cùng rời đi
  const qmRoomId = 'LEAK_TEST_QM';
  rooms.set(qmRoomId, {
    id: qmRoomId,
    name: 'Quick Match Leak Test',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    hostId: 'sock_qm_1',
    hostUserId: 'u_qm_1',
    mode: 'QUICK_MATCH',
    targetPlayers: 4,
    members: new Map([
      ['sock_qm_1', { socketId: 'sock_qm_1', userId: 'u_qm_1', userName: 'QMPlayer', avatar: '🎮', role: 'HOST', isReady: true }],
      ['bot_1', { socketId: 'bot_1', userId: 'bot_1', userName: 'Bot Alpha', avatar: '🤖', role: 'PLAYER', isReady: true, isBot: true }]
    ]),
    messages: [],
    cleanupTimer: null
  });

  const mockSock = {
    id: 'sock_qm_1',
    leave() {},
    to() {
      return { emit() {} };
    }
  } as any;

  leaveCurrentRoom(mockSock, qmRoomId);
  assert.equal(rooms.has(qmRoomId), false, 'QUICK_MATCH room must be destroyed immediately (0ms) when last human leaves');
  assert.equal(gameSessions.has(qmRoomId), false, 'QUICK_MATCH gameSession must not leak after last human leaves');

  // 3. AI Bots phải được sinh tên người thật theo ngôn ngữ phòng (vi / en) và không có chữ "Bot" hay icon 🤖
  const { addBotToRoom, fillRoomWithBots } = await import('../src/services/room.service');
  const { HUMAN_NAMES_BY_LANG } = await import('../src/services/auth.service');
  const viRoomId = 'VI_BOT_TEST_ROOM';
  rooms.set(viRoomId, {
    id: viRoomId,
    name: 'Phòng Tiếng Việt',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    hostId: 'sock_vi_host',
    hostUserId: 'u_vi_host',
    mode: 'CUSTOM_ROOM',
    lang: 'vi',
    targetPlayers: 6,
    members: new Map([
      ['sock_vi_host', { socketId: 'sock_vi_host', userId: 'u_vi_host', userName: 'Minh Khôi', avatar: '🦊', role: 'HOST', isReady: true, lang: 'vi' }]
    ]),
    messages: [],
    cleanupTimer: null
  });

  const fillRes = fillRoomWithBots(viRoomId, { minPlayers: 4, lang: 'vi' });
  assert.equal(fillRes.botsAdded, 3);
  const viBots = fillRes.members.filter(m => m.isBot);
  assert.equal(viBots.length, 3);
  for (const bot of viBots) {
    assert.equal(/\bbot\b/i.test(bot.userName), false, `Bot name "${bot.userName}" must not contain "Bot"`);
    assert.ok(HUMAN_NAMES_BY_LANG.vi.includes(bot.userName), `Bot name "${bot.userName}" should be a Vietnamese human name`);
    assert.notEqual(bot.avatar, '🤖', 'Bot avatar must look like a real player avatar, not 🤖');
  }
  const { removeBotFromRoom } = await import('../src/services/room.service');
  removeBotFromRoom(viRoomId, viBots[0].socketId);
  const singleEnBot = addBotToRoom(viRoomId, { lang: 'en' });
  assert.equal(singleEnBot.success, true);
  assert.ok(singleEnBot.bot && HUMAN_NAMES_BY_LANG.en.includes(singleEnBot.bot.userName));
  destroyRoomData(viRoomId);
});


