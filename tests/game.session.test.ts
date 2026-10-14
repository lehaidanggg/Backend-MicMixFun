import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { AiRemarkCode, ErrorCode, GameMessageCode } from '../src/config/messages';
import { GAME_STATES } from '../src/game/soundPacks';
import { MimicGameSession } from '../src/game/MimicGameSession';

function createMockIo() {
  const emitted: Array<{ room: string; event: string; payload: any }> = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emitted.push({ room, event, payload });
        }
      };
    }
  } as any;
  return { io, emitted };
}

test('MimicGameSession — Matrix Test: addPlayer & Session Reconnection Restore', () => {
  const { io } = createMockIo();
  const game = new MimicGameSession('ROOM_TEST', io);

  // 1. Add HOST in IDLE
  const r1 = game.addPlayer('sock_host', 'HostUser', '👑', 'HOST', 'u_host', true);
  assert.deepEqual(r1, { restored: false, totalScore: 0 });
  assert.equal(game.players.get('sock_host')?.isReady, true);

  // 2. Add PLAYER in IDLE
  const r2 = game.addPlayer('sock_p1', 'Player1', '🦊', 'PLAYER', 'u_p1', true);
  assert.deepEqual(r2, { restored: false, totalScore: 0 });
  assert.equal(game.players.get('sock_p1')?.isReady, false);

  // 3. Give Player1 88 points, then disconnect Player1
  game.players.get('sock_p1')!.totalScore = 88;
  game.removePlayer('sock_p1');
  assert.equal(game.disconnectedPlayers.has('u_p1'), true);

  // 4. Reconnect Player1 WITH authentication within 120s -> restores 88 points
  const r3 = game.addPlayer('sock_p1_new', 'Player1', '🦊', 'PLAYER', 'u_p1', true);
  assert.deepEqual(r3, { restored: true, totalScore: 88 });
  assert.equal(game.players.get('sock_p1_new')?.totalScore, 88);

  // 5. Add Player mid-round (during USER_RECORDING) -> joinedMidRound = true
  game.state = GAME_STATES.USER_RECORDING;
  game.addPlayer('sock_late', 'LateComer', '🐼', 'PLAYER', 'u_late', true);
  assert.equal(game.players.get('sock_late')?.joinedMidRound, true);

  game.destroy();
});

test('MimicGameSession — Matrix Test: updateConfig', () => {
  const { io } = createMockIo();
  const game = new MimicGameSession('ROOM_CFG', io);

  const matrix: Array<{
    caseName: string;
    state: typeof GAME_STATES[keyof typeof GAME_STATES];
    config: { totalRounds?: number; recordDuration?: number; useCustomRecordDuration?: boolean };
    expectSuccess: boolean;
    expectedRounds: number;
    expectedDuration: number;
  }> = [
    {
      caseName: 'Valid totalRounds=5, recordDuration=8 in IDLE',
      state: GAME_STATES.IDLE,
      config: { totalRounds: 5, recordDuration: 8, useCustomRecordDuration: true },
      expectSuccess: true,
      expectedRounds: 5,
      expectedDuration: 8
    },
    {
      caseName: 'Valid totalRounds=10 in GAME_OVER',
      state: GAME_STATES.GAME_OVER,
      config: { totalRounds: 10, recordDuration: 12 },
      expectSuccess: true,
      expectedRounds: 10,
      expectedDuration: 12
    },
    {
      caseName: 'Out-of-range totalRounds=99 and recordDuration=25 ignored but returns true in IDLE',
      state: GAME_STATES.IDLE,
      config: { totalRounds: 99, recordDuration: 25 },
      expectSuccess: true,
      expectedRounds: 10,
      expectedDuration: 12
    },
    {
      caseName: 'Blocked when game is in USER_RECORDING',
      state: GAME_STATES.USER_RECORDING,
      config: { totalRounds: 3, recordDuration: 5 },
      expectSuccess: false,
      expectedRounds: 10,
      expectedDuration: 12
    },
    {
      caseName: 'Blocked when game is in PLAYING_SAMPLE',
      state: GAME_STATES.PLAYING_SAMPLE,
      config: { totalRounds: 3, recordDuration: 5 },
      expectSuccess: false,
      expectedRounds: 10,
      expectedDuration: 12
    }
  ];

  for (const row of matrix) {
    game.state = row.state;
    const ok = game.updateConfig(row.config);
    assert.equal(ok, row.expectSuccess, `[Matrix Fail] ${row.caseName}`);
    assert.equal(game.totalRounds, row.expectedRounds, `[Matrix Fail] ${row.caseName} rounds`);
    assert.equal(game.recordDuration, row.expectedDuration, `[Matrix Fail] ${row.caseName} duration`);
  }

  game.destroy();
});

test('MimicGameSession — Decision Matrix: evaluateMimicAttempt (AI Scoring Engine)', () => {
  const { io } = createMockIo();
  const game = new MimicGameSession('ROOM_SCORE', io);

  const validBase64 = 'data:audio/webm;base64,' + crypto.randomBytes(1024).toString('base64');
  const flatBase64 = 'data:audio/webm;base64,' + Buffer.alloc(1024, 0).toString('base64');

  const matrix: Array<{
    caseName: string;
    audio: string | null | undefined;
    metrics: { matchPct?: number; rhythmScore?: number; energyScore?: number; activeRatio?: number } | null;
    expectedGrade: string;
    minScore: number;
    maxScore: number;
  }> = [
    {
      caseName: 'Null audio input -> Grade F (0 pts)',
      audio: null,
      metrics: null,
      expectedGrade: 'F',
      minScore: 0,
      maxScore: 0
    },
    {
      caseName: 'Too short audio (<500 chars) -> Grade F (0 pts)',
      audio: 'data:audio/webm;base64,AAAA',
      metrics: null,
      expectedGrade: 'F',
      minScore: 0,
      maxScore: 0
    },
    {
      caseName: 'Silent mic (activeRatio < 0.05) -> Grade F (15 pts)',
      audio: validBase64,
      metrics: { matchPct: 90, activeRatio: 0.01 },
      expectedGrade: 'F',
      minScore: 15,
      maxScore: 15
    },
    {
      caseName: 'High client metrics (matchPct=96) -> Grade S (>=90 pts)',
      audio: validBase64,
      metrics: { matchPct: 96, rhythmScore: 95, energyScore: 96, activeRatio: 0.8 },
      expectedGrade: 'S',
      minScore: 90,
      maxScore: 100
    },
    {
      caseName: 'Good client metrics (matchPct=82) -> Grade A (75..89 pts)',
      audio: validBase64,
      metrics: { matchPct: 82, rhythmScore: 80, energyScore: 82, activeRatio: 0.7 },
      expectedGrade: 'A',
      minScore: 75,
      maxScore: 89
    },
    {
      caseName: 'Medium client metrics (matchPct=64) -> Grade B (55..74 pts)',
      audio: validBase64,
      metrics: { matchPct: 64, rhythmScore: 62, energyScore: 64, activeRatio: 0.5 },
      expectedGrade: 'B',
      minScore: 55,
      maxScore: 74
    },
    {
      caseName: 'Low client metrics (matchPct=40) -> Grade C (<55 pts)',
      audio: validBase64,
      metrics: { matchPct: 40, rhythmScore: 40, energyScore: 40, activeRatio: 0.3 },
      expectedGrade: 'C',
      minScore: 35,
      maxScore: 54
    },
    {
      caseName: 'Fallback byte analysis with zero-entropy flat buffer -> Grade F (10 pts)',
      audio: flatBase64,
      metrics: null,
      expectedGrade: 'F',
      minScore: 10,
      maxScore: 10
    },
    {
      caseName: 'Fallback byte analysis with random high-entropy buffer -> Valid score & enum remark',
      audio: validBase64,
      metrics: null,
      expectedGrade: 'A', // or B/S depending on entropy
      minScore: 55,
      maxScore: 100
    }
  ];

  const validRemarkCodes = new Set<string>(Object.values(AiRemarkCode));

  for (const row of matrix) {
    const res = game.evaluateMimicAttempt(row.audio, row.metrics);
    assert.ok(
      res.totalScore >= row.minScore && res.totalScore <= row.maxScore,
      `[Matrix Fail] ${row.caseName}: score ${res.totalScore} not in [${row.minScore}, ${row.maxScore}]`
    );
    if (row.caseName !== 'Fallback byte analysis with random high-entropy buffer -> Valid score & enum remark') {
      assert.equal(res.grade, row.expectedGrade, `[Matrix Fail] ${row.caseName}: grade ${res.grade}`);
    }
    assert.ok(
      validRemarkCodes.has(res.remark),
      `[Matrix Fail] ${row.caseName}: remark "${res.remark}" is not a valid AiRemarkCode enum`
    );
  }

  game.destroy();
});

test('MimicGameSession — Decision Matrix: submitMimicAudio, Showdown Skip & Round Ready', () => {
  const { io, emitted } = createMockIo();
  const game = new MimicGameSession('ROOM_FLOW', io);
  game.addPlayer('s_host', 'Host', '👑', 'HOST', 'u_1', true);
  game.addPlayer('s_p2', 'Player2', '🐶', 'PLAYER', 'u_2', true);

  const sampleAudio = 'data:audio/webm;base64,' + crypto.randomBytes(800).toString('base64');

  // 1. Submit when in IDLE -> GAME_NOT_IN_RECORDING_PHASE
  const subIdle = game.submitMimicAudio('s_host', sampleAudio);
  assert.equal(subIdle.success, false);
  assert.equal(subIdle.code, ErrorCode.GAME_NOT_IN_RECORDING_PHASE);

  // 2. Transition to USER_RECORDING
  game.currentRound = 1;
  game.state = GAME_STATES.USER_RECORDING;
  game.timeRemaining = 5;

  // 3. Submit from unknown socket -> PLAYER_NOT_IN_ROOM
  const subUnknown = game.submitMimicAudio('s_ghost', sampleAudio);
  assert.equal(subUnknown.success, false);
  assert.equal(subUnknown.code, ErrorCode.PLAYER_NOT_IN_ROOM);

  // 4. First valid submission from Host
  const subHost = game.submitMimicAudio('s_host', sampleAudio, 'audio/webm', {
    matchPct: 92,
    rhythmScore: 90,
    energyScore: 94,
    activeRatio: 0.8
  });
  assert.equal(subHost.success, true);
  assert.ok(subHost.evaluation && subHost.evaluation.totalScore >= 90);

  // 5. Duplicate submission from Host in same round -> GAME_ALREADY_SUBMITTED_THIS_ROUND
  const subDup = game.submitMimicAudio('s_host', sampleAudio);
  assert.equal(subDup.success, false);
  assert.equal(subDup.code, ErrorCode.GAME_ALREADY_SUBMITTED_THIS_ROUND);

  // 6. Second player submits -> all active players submitted -> auto transitions to AI_SCORING
  const subP2 = game.submitMimicAudio('s_p2', sampleAudio, 'audio/webm', {
    matchPct: 78,
    rhythmScore: 76,
    energyScore: 80,
    activeRatio: 0.6
  });
  assert.equal(subP2.success, true);
  assert.equal(game.state, GAME_STATES.AI_SCORING);

  // 7. Showdown Skip Matrix
  const skipWrongPhase = game.confirmShowdownSkip('s_host');
  assert.equal(skipWrongPhase.success, false);
  assert.equal(skipWrongPhase.code, ErrorCode.GAME_NOT_IN_SHOWDOWN_PHASE);

  game.startShowdownRevealState();
  assert.equal(game.state, GAME_STATES.SHOWDOWN_REVEAL);

  const vote1 = game.confirmShowdownSkip('s_host');
  assert.equal(vote1.success, true);
  assert.equal(vote1.isVoted, true);
  assert.equal(vote1.allSkipConfirmed, false);

  // Toggle off then on again
  const voteToggleOff = game.confirmShowdownSkip('s_host');
  assert.equal(voteToggleOff.isVoted, false);
  game.confirmShowdownSkip('s_host');

  // Second player votes -> allSkipConfirmed = true -> transitions to ROUND_RESULT
  const vote2 = game.confirmShowdownSkip('s_p2');
  assert.equal(vote2.allSkipConfirmed, true);
  assert.equal(game.state, GAME_STATES.ROUND_RESULT);

  // 8. Round Ready Matrix
  const ready1 = game.confirmRoundReady('s_host');
  assert.equal(ready1.success, true);
  assert.equal(ready1.allReady, false);

  const ready2 = game.confirmRoundReady('s_p2');
  assert.equal(ready2.success, true);
  assert.equal(ready2.allReady, true);

  // Check emitted all_players_ready uses GameMessageCode enum
  const countdownEvent = emitted.find(
    e => e.event === 'all_players_ready' && e.payload.message === GameMessageCode.GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN
  );
  assert.ok(countdownEvent, 'Should emit GAME_MSG_ALL_PLAYERS_READY_COUNTDOWN enum code');

  game.destroy();
});

test('MimicGameSession — AI Bot Lifecycle & Difficulty Scoring Matrix (EASY / NORMAL / HARD)', () => {
  const { io } = createMockIo();
  const game = new MimicGameSession('ROOM_BOTS', io);
  game.hostId = 's_solo';
  game.addPlayer('s_solo', 'SoloHuman', '👑', 'HOST', 'u_solo', true, false, null);
  game.addPlayer('bot_easy', 'Bot Easy', '🤖', 'PLAYER', 'bot_easy', false, true, 'EASY');
  game.addPlayer('bot_norm', 'Bot Normal', '🐱', 'PLAYER', 'bot_norm', false, true, 'NORMAL');
  game.addPlayer('bot_hard', 'Bot Hard', '👾', 'PLAYER', 'bot_hard', false, true, 'HARD');

  // 1. Bots are always ready in IDLE and do not block startGame({ requireAllReady: true })
  assert.equal(game.startGame({ requireAllReady: true }), true);

  // 2. Enter USER_RECORDING -> Bots automatically simulate attempts according to difficulty
  game.startUserRecordingState(5);
  assert.equal(game.state, GAME_STATES.USER_RECORDING);

  const easyAttempt = game.players.get('bot_easy')!.currentAttempt;
  const normAttempt = game.players.get('bot_norm')!.currentAttempt;
  const hardAttempt = game.players.get('bot_hard')!.currentAttempt;
  assert.ok(easyAttempt && easyAttempt.evaluation.totalScore >= 45 && easyAttempt.evaluation.totalScore <= 76);
  assert.ok(normAttempt && normAttempt.evaluation.totalScore >= 63 && normAttempt.evaluation.totalScore <= 92);
  assert.ok(hardAttempt && hardAttempt.evaluation.totalScore >= 78 && hardAttempt.evaluation.totalScore <= 99);

  // Verify each bot generated a DIFFERENT sound flowing with the target sound (not the exact original target sound, and all 3 bots have distinct sounds)
  const targetUrl = game.getTargetSoundUrl(game.targetSound);
  assert.notEqual(easyAttempt?.audioUrl, targetUrl, 'Bot Easy must not reuse exact target sound URL');
  assert.notEqual(normAttempt?.audioUrl, targetUrl, 'Bot Normal must not reuse exact target sound URL');
  assert.notEqual(hardAttempt?.audioUrl, targetUrl, 'Bot Hard must not reuse exact target sound URL');
  const uniqueBotUrls = new Set([easyAttempt?.audioUrl, normAttempt?.audioUrl, hardAttempt?.audioUrl]);
  assert.equal(uniqueBotUrls.size, 3, 'All 3 bots must have distinct sound URLs');
  assert.ok(typeof easyAttempt?.botPitch === 'number' && typeof easyAttempt?.botSpeed === 'number');

  // 3. When the single human player submits, all players have submitted -> jumps immediately to AI_SCORING
  const sampleAudio = 'data:audio/webm;base64,' + crypto.randomBytes(800).toString('base64');
  const subSolo = game.submitMimicAudio('s_solo', sampleAudio, 'audio/webm', {
    matchPct: 88,
    rhythmScore: 85,
    energyScore: 90,
    activeRatio: 0.75
  });
  assert.equal(subSolo.success, true);
  assert.equal(game.state, GAME_STATES.AI_SCORING);

  // 4. In SHOWDOWN_REVEAL, bots pre-vote skip -> single human voting skip immediately triggers ROUND_RESULT
  game.startShowdownRevealState();
  assert.equal(game.state, GAME_STATES.SHOWDOWN_REVEAL);
  const skipRes = game.confirmShowdownSkip('s_solo');
  assert.equal(skipRes.allSkipConfirmed, true);
  assert.equal(game.state, GAME_STATES.ROUND_RESULT);

  // 5. In ROUND_RESULT, bots are already ready -> single human clicking ready sets allReady = true
  const readyRes = game.confirmRoundReady('s_solo');
  assert.equal(readyRes.allReady, true);

  game.destroy();
});
