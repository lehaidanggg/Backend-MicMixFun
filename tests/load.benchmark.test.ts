import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { server, io, rooms, gameSessions } from '../src/server';
import { destroyRoomData, matchmakingQueue } from '../src/services/room.service';
import { registerRoomHandlers } from '../src/socket/room.handler';
import { MimicGameSession } from '../src/game/MimicGameSession';
import type { AuthenticatedSocket, SocketSessionState } from '../src/types';

interface BenchmarkResult {
  name: string;
  totalRequests: number;
  concurrency: number;
  durationMs: number;
  rps: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successCount: number;
  errorCount: number;
}

function computePercentile(sortedLatencies: number[], percentile: number): number {
  if (sortedLatencies.length === 0) return 0;
  const idx = Math.min(
    sortedLatencies.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedLatencies.length) - 1)
  );
  return Number(sortedLatencies[idx].toFixed(2));
}

async function runHttpBenchmark(options: {
  name: string;
  port: number;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  totalRequests: number;
  concurrency: number;
}): Promise<BenchmarkResult> {
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: options.concurrency
  });

  const payloadStr = options.body ? JSON.stringify(options.body) : null;
  const baseHeaders: Record<string, string> = {
    Connection: 'keep-alive',
    ...(payloadStr
      ? {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payloadStr))
        }
      : {}),
    ...(options.headers || {})
  };

  const latencies: number[] = new Array(options.totalRequests);
  let nextIndex = 0;
  let successCount = 0;
  let errorCount = 0;

  const fireOne = (idx: number): Promise<void> =>
    new Promise(resolve => {
      const start = performance.now();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: options.port,
          path: options.path,
          method: options.method,
          agent,
          headers: baseHeaders
        },
        res => {
          res.on('data', () => {});
          res.on('end', () => {
            latencies[idx] = performance.now() - start;
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              successCount++;
            } else {
              errorCount++;
            }
            resolve();
          });
        }
      );
      req.on('error', () => {
        latencies[idx] = performance.now() - start;
        errorCount++;
        resolve();
      });
      if (payloadStr) req.write(payloadStr);
      req.end();
    });

  const startWall = performance.now();
  const workers: Promise<void>[] = [];
  for (let w = 0; w < options.concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const current = nextIndex++;
          if (current >= options.totalRequests) break;
          await fireOne(current);
        }
      })()
    );
  }
  await Promise.all(workers);
  const durationMs = performance.now() - startWall;
  agent.destroy();

  const sorted = latencies.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const rps = Math.round((options.totalRequests / durationMs) * 1000);

  return {
    name: options.name,
    totalRequests: options.totalRequests,
    concurrency: options.concurrency,
    durationMs: Number(durationMs.toFixed(1)),
    rps,
    avgLatencyMs: Number((sum / sorted.length).toFixed(2)),
    p50Ms: computePercentile(sorted, 50),
    p95Ms: computePercentile(sorted, 95),
    p99Ms: computePercentile(sorted, 99),
    successCount,
    errorCount
  };
}

function createFastMockSocket(id: string): {
  socket: AuthenticatedSocket;
  handlers: Map<string, (...args: any[]) => any>;
  sessionState: SocketSessionState;
} {
  const handlers = new Map<string, (...args: any[]) => any>();
  const socket: any = {
    id,
    clientIp: '127.0.0.1',
    clientFingerprint: `fp_${id}`,
    authSession: null,
    on(event: string, fn: (...args: any[]) => any) {
      handlers.set(event, fn);
    },
    emit() {},
    join() {},
    leave() {},
    to() {
      return { emit() {} };
    }
  };
  const sessionState: SocketSessionState = {
    currentRoomId: null,
    currentUser: {
      socketId: id,
      userId: `u_${id}`,
      firebaseUid: null,
      userName: `User_${id}`,
      avatar: '🎧',
      role: 'PLAYER',
      isReady: false,
      isAuthenticated: true,
      joinedAt: Date.now()
    }
  };
  return { socket: socket as AuthenticatedSocket, handlers, sessionState };
}

test('Load & Throughput Benchmark — Requests/sec (HTTP REST API + Socket Matchmaking + AI Scoring)', async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const port = address.port;

  const results: BenchmarkResult[] = [];

  try {
    // Warm up HTTP server
    await runHttpBenchmark({
      name: 'Warmup',
      port,
      method: 'GET',
      path: '/api/health',
      totalRequests: 100,
      concurrency: 20
    });

    // 1. GET /api/health (High concurrency lightweight endpoint)
    const healthBench = await runHttpBenchmark({
      name: 'HTTP GET /api/health (Health Check)',
      port,
      method: 'GET',
      path: '/api/health',
      totalRequests: 2000,
      concurrency: 100
    });
    results.push(healthBench);
    assert.equal(healthBench.errorCount, 0);
    assert.ok(healthBench.rps > 200, `Expected > 200 req/s on /api/health, got ${healthBench.rps}`);

    // 2. POST /api/auth/guest (HMAC-SHA256 Token Signing + Fingerprint Binding)
    const authBench = await runHttpBenchmark({
      name: 'HTTP POST /api/auth/guest (HMAC-SHA256 Auth)',
      port,
      method: 'POST',
      path: '/api/auth/guest',
      body: { userName: 'BenchUser', avatar: '⚡', deviceId: 'bench-device-01' },
      totalRequests: 1000,
      concurrency: 50
    });
    results.push(authBench);
    assert.equal(authBench.errorCount, 0);

    // 3. GET /api/sounds (251 Sound Metadata Catalog JSON Serialization)
    const soundsBench = await runHttpBenchmark({
      name: 'HTTP GET /api/sounds (251 Sounds Catalog)',
      port,
      method: 'GET',
      path: '/api/sounds',
      totalRequests: 1000,
      concurrency: 50
    });
    results.push(soundsBench);
    assert.equal(soundsBench.errorCount, 0);

    // 4. GET /api/enums (Full Multi-language VI/EN Dictionary Serialization)
    const enumsBench = await runHttpBenchmark({
      name: 'HTTP GET /api/enums (VI/EN Dictionary)',
      port,
      method: 'GET',
      path: '/api/enums',
      totalRequests: 1000,
      concurrency: 50
    });
    results.push(enumsBench);
    assert.equal(enumsBench.errorCount, 0);

    // 5. Socket.IO Smart Matchmaking Throughput (1,200 concurrent players matching into 300 4P rooms)
    const totalMatchRequests = 1200;
    const matchLatencies: number[] = new Array(totalMatchRequests);
    const createdRoomIds = new Set<string>();
    const origLog = console.log;
    console.log = () => {}; // Silence room creation logs during high-speed benchmark
    let matchSuccess = 0;
    let matchStartWall = 0;
    let matchDurationMs = 0;
    try {
      const mockClients = Array.from({ length: totalMatchRequests }, (_, i) => {
        const m = createFastMockSocket(`bench_sock_${i}`);
        registerRoomHandlers(io, m.socket, m.sessionState);
        return m;
      });

      matchStartWall = performance.now();
      await Promise.all(
        mockClients.map(
          (client, idx) =>
            new Promise<void>(resolve => {
              const t0 = performance.now();
              client.handlers.get('quick_match')!(
                { userName: `Player_${idx}`, avatar: '🔥', waitMs: 10000, autoStart: false },
                (res: any) => {
                  matchLatencies[idx] = performance.now() - t0;
                  if (res?.success) {
                    matchSuccess++;
                    if (res.roomId) createdRoomIds.add(res.roomId);
                  }
                  resolve();
                }
              );
            })
        )
      );
      matchDurationMs = performance.now() - matchStartWall;
    } finally {
      for (const rId of createdRoomIds) {
        destroyRoomData(rId);
      }
      matchmakingQueue.clear();
      console.log = origLog;
    }

    const sortedMatch = matchLatencies.slice().sort((a, b) => a - b);
    const matchSum = sortedMatch.reduce((a, b) => a + b, 0);
    const matchRps = Math.round((totalMatchRequests / matchDurationMs) * 1000);
    results.push({
      name: 'Socket quick_match (Smart Matchmaking 4P)',
      totalRequests: totalMatchRequests,
      concurrency: totalMatchRequests,
      durationMs: Number(matchDurationMs.toFixed(1)),
      rps: matchRps,
      avgLatencyMs: Number((matchSum / sortedMatch.length).toFixed(2)),
      p50Ms: computePercentile(sortedMatch, 50),
      p95Ms: computePercentile(sortedMatch, 95),
      p99Ms: computePercentile(sortedMatch, 99),
      successCount: matchSuccess,
      errorCount: totalMatchRequests - matchSuccess
    });
    assert.equal(matchSuccess, totalMatchRequests);
    assert.equal(createdRoomIds.size, totalMatchRequests / 4); // 1200 players packed into exactly 300 4/4 rooms!

    // 6. AI Scoring & Audio Submission Engine Throughput (5,000 audio evaluations)
    const scoringSession = new MimicGameSession('BENCH_SCORE_RM', {
      to: () => ({ emit() {} })
    } as any);
    const totalScoringOps = 5000;
    const scoreLatencies: number[] = new Array(totalScoringOps);
    const scoreStartWall = performance.now();
    for (let i = 0; i < totalScoringOps; i++) {
      const t0 = performance.now();
      scoringSession.evaluateMimicAttempt('data:audio/webm;base64,' + 'A'.repeat(512), {
        matchPct: 75 + (i % 20),
        rhythmScore: 80,
        energyScore: 85,
        activeRatio: 0.65
      });
      scoreLatencies[i] = performance.now() - t0;
    }
    const scoreDurationMs = Math.max(0.1, performance.now() - scoreStartWall);
    const sortedScore = scoreLatencies.slice().sort((a, b) => a - b);
    const scoreSum = sortedScore.reduce((a, b) => a + b, 0);
    const scoreRps = Math.round((totalScoringOps / scoreDurationMs) * 1000);
    results.push({
      name: 'Engine evaluateMimicAttempt (AI Scoring)',
      totalRequests: totalScoringOps,
      concurrency: 1,
      durationMs: Number(scoreDurationMs.toFixed(1)),
      rps: scoreRps,
      avgLatencyMs: Number((scoreSum / sortedScore.length).toFixed(3)),
      p50Ms: computePercentile(sortedScore, 50),
      p95Ms: computePercentile(sortedScore, 95),
      p99Ms: computePercentile(sortedScore, 99),
      successCount: totalScoringOps,
      errorCount: 0
    });
    scoringSession.destroy();

    // Print formatted benchmark summary table
    console.log('\n====================================================================================================');
    console.log('🚀 MICMIXFUN BACKEND — THROUGHPUT & LATENCY BENCHMARK REPORT (REQUESTS / 1 SECOND)');
    console.log('====================================================================================================');
    console.table(
      results.map(r => ({
        'Kịch bản (Workload)': r.name,
        'Tổng Req': r.totalRequests,
        Concurrency: r.concurrency,
        'Thời gian (ms)': r.durationMs,
        'Chịu tải (Req/1s)': `${r.rps.toLocaleString('en-US')} req/s`,
        'Avg (ms)': r.avgLatencyMs,
        'P50 (ms)': r.p50Ms,
        'P95 (ms)': r.p95Ms,
        'P99 (ms)': r.p99Ms,
        'Thành công': `${r.successCount}/${r.totalRequests}`
      }))
    );
    console.log('====================================================================================================\n');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
