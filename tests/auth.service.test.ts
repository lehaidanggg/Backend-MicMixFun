import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { APP_SIGNING_SECRET, AUTH_SECRET, MAX_USERNAME_LENGTH } from '../src/config/constants';
import {
  challengeNonces,
  computeClientFingerprint,
  createAuthChallenge,
  extractClientIp,
  generateSecureUserId,
  issueAuthToken,
  sanitizeUserName,
  verifyAppChallenge,
  verifyAuthToken,
  verifyFirebaseIdToken
} from '../src/services/auth.service';

test('Auth Service — Matrix Test: sanitizeUserName', () => {
  const matrix: Array<{
    caseName: string;
    rawName: string | null | undefined;
    fallbackId?: string | null;
    expected: string;
  }> = [
    { caseName: 'Valid normal username', rawName: 'PlayerOne', fallbackId: 'abcd', expected: 'PlayerOne' },
    { caseName: 'Trims leading and trailing spaces', rawName: '  DJ_MicMix  ', fallbackId: 'abcd', expected: 'DJ_MicMix' },
    { caseName: 'Empty string falls back to User_<4chars>', rawName: '', fallbackId: '9f8e7d', expected: 'User_9f8e' },
    { caseName: 'Whitespace-only falls back to User_<4chars>', rawName: '     ', fallbackId: '123456', expected: 'User_1234' },
    { caseName: 'Null rawName with default fallback', rawName: null, fallbackId: undefined, expected: 'User_0000' },
    { caseName: 'Undefined rawName with null fallback', rawName: undefined, fallbackId: null, expected: 'User_0000' },
    {
      caseName: `Truncates username exceeding ${MAX_USERNAME_LENGTH} chars`,
      rawName: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      fallbackId: 'abcd',
      expected: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'.slice(0, MAX_USERNAME_LENGTH)
    }
  ];

  for (const row of matrix) {
    const actual = sanitizeUserName(row.rawName, row.fallbackId);
    assert.equal(actual, row.expected, `[Matrix Fail] ${row.caseName}`);
  }
});

test('Auth Service — Matrix Test: extractClientIp', () => {
  const matrix: Array<{
    caseName: string;
    input: any;
    expected: string;
  }> = [
    { caseName: 'Null/undefined input', input: null, expected: '0.0.0.0' },
    { caseName: 'Socket handshake address', input: { handshake: { address: '203.0.113.10' } }, expected: '203.0.113.10' },
    { caseName: 'IPv6-mapped IPv4 in socket handshake', input: { handshake: { address: '::ffff:192.168.1.50' } }, expected: '192.168.1.50' },
    { caseName: 'Express req.socket.remoteAddress', input: { socket: { remoteAddress: '::ffff:10.0.0.5' } }, expected: '10.0.0.5' },
    { caseName: 'Express req.ip fallback', input: { ip: '172.16.0.9' }, expected: '172.16.0.9' },
    { caseName: 'Empty object fallback', input: {}, expected: '0.0.0.0' }
  ];

  for (const row of matrix) {
    const actual = extractClientIp(row.input);
    assert.equal(actual, row.expected, `[Matrix Fail] ${row.caseName}`);
  }
});

test('Auth Service — Matrix Test: computeClientFingerprint', () => {
  const baseFp = computeClientFingerprint({ ip: '1.2.3.4', userAgent: 'Mozilla/5.0', deviceId: 'dev_01' });
  assert.equal(baseFp.length, 16);

  const matrix: Array<{
    caseName: string;
    params: { ip?: string; userAgent?: string | string[]; deviceId?: string | string[] };
    shouldMatchBase: boolean;
  }> = [
    {
      caseName: 'Deterministic for identical IP and deviceId',
      params: { ip: '1.2.3.4', userAgent: 'OtherUA', deviceId: 'dev_01' },
      shouldMatchBase: true
    },
    {
      caseName: 'Normalizes ::ffff: prefix on IP',
      params: { ip: '::ffff:1.2.3.4', userAgent: 'Mozilla/5.0', deviceId: 'dev_01' },
      shouldMatchBase: true
    },
    {
      caseName: 'Handles array header for deviceId',
      params: { ip: '1.2.3.4', deviceId: ['dev_01', 'dev_02'] },
      shouldMatchBase: true
    },
    {
      caseName: 'Different IP produces different fingerprint',
      params: { ip: '9.9.9.9', userAgent: 'Mozilla/5.0', deviceId: 'dev_01' },
      shouldMatchBase: false
    },
    {
      caseName: 'Different deviceId produces different fingerprint',
      params: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0', deviceId: 'dev_99' },
      shouldMatchBase: false
    },
    {
      caseName: 'Falls back to userAgent when deviceId is omitted',
      params: { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
      shouldMatchBase: false
    }
  ];

  for (const row of matrix) {
    const fp = computeClientFingerprint(row.params);
    assert.equal(fp.length, 16);
    if (row.shouldMatchBase) {
      assert.equal(fp, baseFp, `[Matrix Fail] ${row.caseName}`);
    } else {
      assert.notEqual(fp, baseFp, `[Matrix Fail] ${row.caseName}`);
    }
  }
});

test('Auth Service — Decision Matrix: createAuthChallenge & verifyAppChallenge', () => {
  const sign = (nonce: string, ts: number, uid: string) =>
    crypto.createHmac('sha256', APP_SIGNING_SECRET).update(`${nonce}:${ts}:${uid}`).digest('hex');

  // Row 1: Valid challenge & valid HMAC signature
  const c1 = createAuthChallenge('10.1.1.1');
  const now1 = Date.now();
  assert.equal(
    verifyAppChallenge({
      nonce: c1.nonce,
      timestamp: now1,
      uid: 'fb_user_1',
      signature: sign(c1.nonce, now1, 'fb_user_1'),
      clientIp: '10.1.1.1'
    }),
    true,
    'Row 1: Valid challenge should pass'
  );

  // Row 2: Replay attack (reusing consumed nonce)
  assert.equal(
    verifyAppChallenge({
      nonce: c1.nonce,
      timestamp: now1,
      uid: 'fb_user_1',
      signature: sign(c1.nonce, now1, 'fb_user_1'),
      clientIp: '10.1.1.1'
    }),
    false,
    'Row 2: Replayed nonce must be rejected'
  );

  // Row 3: Wrong HMAC signature
  const c3 = createAuthChallenge('10.1.1.1');
  assert.equal(
    verifyAppChallenge({
      nonce: c3.nonce,
      timestamp: Date.now(),
      uid: 'fb_user_1',
      signature: '00'.repeat(32),
      clientIp: '10.1.1.1'
    }),
    false,
    'Row 3: Wrong signature must be rejected'
  );

  // Row 4: Mismatched Client IP (Relay attack)
  const c4 = createAuthChallenge('10.1.1.1');
  const now4 = Date.now();
  assert.equal(
    verifyAppChallenge({
      nonce: c4.nonce,
      timestamp: now4,
      uid: 'fb_user_1',
      signature: sign(c4.nonce, now4, 'fb_user_1'),
      clientIp: '99.99.99.99'
    }),
    false,
    'Row 4: Mismatched client IP must be rejected'
  );

  // Row 5: Expired timestamp drift (>30s)
  const c5 = createAuthChallenge('10.1.1.1');
  const oldTs = Date.now() - 60000;
  assert.equal(
    verifyAppChallenge({
      nonce: c5.nonce,
      timestamp: oldTs,
      uid: 'fb_user_1',
      signature: sign(c5.nonce, oldTs, 'fb_user_1'),
      clientIp: '10.1.1.1'
    }),
    false,
    'Row 5: Timestamp drift >30s must be rejected'
  );

  // Row 6: Expired nonce record in map (>30s)
  const c6 = createAuthChallenge('10.1.1.1');
  challengeNonces.set(c6.nonce, { ip: '10.1.1.1', createdAt: Date.now() - 45000 });
  const now6 = Date.now();
  assert.equal(
    verifyAppChallenge({
      nonce: c6.nonce,
      timestamp: now6,
      uid: 'fb_user_1',
      signature: sign(c6.nonce, now6, 'fb_user_1'),
      clientIp: '10.1.1.1'
    }),
    false,
    'Row 6: Expired nonce record must be rejected'
  );

  // Row 7: Missing parameters
  assert.equal(verifyAppChallenge({ nonce: '', timestamp: Date.now(), signature: 'abc' }), false);
});

test('Auth Service — Decision Matrix: issueAuthToken & verifyAuthToken', () => {
  const uid = generateSecureUserId();
  assert.match(uid, /^u_[0-9a-f]{16}$/);

  const fp = computeClientFingerprint({ ip: '192.168.1.10', deviceId: 'pixel_8' });
  const issued = issueAuthToken({
    userId: uid,
    firebaseUid: 'fb_123',
    provider: 'firebase_anonymous',
    userName: 'Alice',
    avatar: '🦊',
    fingerprint: fp
  });

  // Expired token helper
  const expiredPayloadB64 = Buffer.from(
    JSON.stringify({ uid: 'u_exp', name: 'Exp', avatar: '🎧', exp: Date.now() - 1000 }),
    'utf8'
  ).toString('base64url');
  const expiredSigB64 = crypto.createHmac('sha256', AUTH_SECRET).update(expiredPayloadB64).digest('base64url');
  const expiredToken = `${expiredPayloadB64}.${expiredSigB64}`;

  const matrix: Array<{
    caseName: string;
    token: unknown;
    expectedFp: string | null;
    expectValid: boolean;
  }> = [
    { caseName: 'Valid token + matching fingerprint', token: issued.token, expectedFp: fp, expectValid: true },
    { caseName: 'Valid token with Bearer prefix', token: `Bearer ${issued.token}`, expectedFp: fp, expectValid: true },
    { caseName: 'Valid token with null expectedFingerprint', token: issued.token, expectedFp: null, expectValid: true },
    { caseName: 'Mismatched fingerprint (anti-relay protection)', token: issued.token, expectedFp: 'wrong_fp_1234567', expectValid: false },
    { caseName: 'Tampered signature', token: `${issued.token}tampered`, expectedFp: fp, expectValid: false },
    {
      caseName: 'Tampered payload',
      token: `${Buffer.from(JSON.stringify({ uid: 'hacker', exp: Date.now() + 99999 })).toString('base64url')}.${issued.token.split('.')[1]}`,
      expectedFp: null,
      expectValid: false
    },
    { caseName: 'Expired token', token: expiredToken, expectedFp: null, expectValid: false },
    { caseName: 'Malformed token without dot', token: 'invalidtokenstring', expectedFp: null, expectValid: false },
    { caseName: 'Null/empty token', token: null, expectedFp: null, expectValid: false }
  ];

  for (const row of matrix) {
    const res = verifyAuthToken(row.token, row.expectedFp);
    if (row.expectValid) {
      assert.ok(res, `[Matrix Fail] ${row.caseName} should be valid`);
      assert.equal(res.uid, uid);
    } else {
      assert.equal(res, null, `[Matrix Fail] ${row.caseName} should return null`);
    }
  }
});

test('Auth Service — Decision Matrix: verifyFirebaseIdToken malformed/invalid cases', async () => {
  const makeJwt = (header: object, payload: object, sig = 'fakesig') =>
    `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;

  const nowSec = Math.floor(Date.now() / 1000);

  const matrix: Array<{ caseName: string; token: unknown }> = [
    { caseName: 'Null input', token: null },
    { caseName: 'Not 3 JWT segments', token: 'a.b' },
    {
      caseName: 'Wrong algorithm (HS256 instead of RS256)',
      token: makeJwt({ alg: 'HS256', kid: 'k1' }, { exp: nowSec + 3600, sub: 'u1', iss: 'https://securetoken.google.com/p1' })
    },
    {
      caseName: 'Missing kid in header',
      token: makeJwt({ alg: 'RS256' }, { exp: nowSec + 3600, sub: 'u1', iss: 'https://securetoken.google.com/p1' })
    },
    {
      caseName: 'Expired JWT (exp in the past)',
      token: makeJwt({ alg: 'RS256', kid: 'k1' }, { exp: nowSec - 3600, sub: 'u1', iss: 'https://securetoken.google.com/p1' })
    },
    {
      caseName: 'Future issued-at (iat > now + 300)',
      token: makeJwt({ alg: 'RS256', kid: 'k1' }, { exp: nowSec + 3600, iat: nowSec + 1000, sub: 'u1', iss: 'https://securetoken.google.com/p1' })
    },
    {
      caseName: 'Invalid issuer domain',
      token: makeJwt({ alg: 'RS256', kid: 'k1' }, { exp: nowSec + 3600, sub: 'u1', iss: 'https://evil.example.com/p1' })
    }
  ];

  for (const row of matrix) {
    const res = await verifyFirebaseIdToken(row.token);
    assert.equal(res, null, `[Matrix Fail] ${row.caseName}`);
  }
});
