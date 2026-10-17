# Backend-MicMixFun — Architecture & Performance Guardrails

When maintaining or adding new features to `Backend-MicMixFun`, you MUST enforce these 5 invariants at all times:

## 1. Strict Lifecycle Isolation Across Game Modes (`QUICK_MATCH`, `RACE_1V1`, `CUSTOM_ROOM`)
- **`QUICK_MATCH` (4P) & `RACE_1V1` (2P):**
  - Ephemeral matchmaking rooms only: Outsiders MUST NOT join via `join_room` using a room code (`ROOM_NOT_FOUND` unless reconnecting).
  - On `5.10 GAME_OVER` or when `remainingHumans.length === 0`, immediately disband and destroy the room (`0ms` delay, no 30s `cleanupTimer`, no post-game lobby, no auto-restart), detach all sockets (`sock.leave(roomId)`), and reset `sock.sessionState.currentRoomId = null`.
- **`CUSTOM_ROOM` (Private Room):**
  - `create_room` must auto-join the creator as `HOST` and initialize `MimicGameSession`.
  - When `game_start` is triggered in a `CUSTOM_ROOM` with `>= 2` members, do NOT auto-fill AI Bots unless explicitly requested (`autoFillBots: true` or `botCount > 0`).

## 2. Bounded Audio Buffers & Zero Inline Base64 in State/History
- **Never call raw `Buffer.from(base64, 'base64')` on user/bot uploads:** Always use `decodeBoundedBase64Audio(base64, maxBytes)` in `src/services/audio.service.ts` to validate estimated byte size BEFORE allocating C++ `Buffer` memory.
- **Single-pass decoding:** Pass the pre-decoded `Buffer` (`preDecodedBuffer`) into `evaluateMimicAttempt()` so Base64 is never decoded twice.
- **No heavy Base64 in JSON payloads:**
  - Never store Base64 strings (`> 4KB`) inside `currentPayload.attempts`, `disconnectedPlayers`, or `room.messages`.
  - Serve stored recordings via HTTP Stream URLs (`/api/attempts/:roomId/:socketId`) and clear `this.audioStore` via `clearRoundAudioData()` on every round transition and `GAME_OVER`.

## 3. Bounded Maps & Self-Healing Garbage Collection (`startPeriodicGcTimer`)
- Every in-memory `Map` holding transient state (`challengeNonces`, `matchmakingQueue`, `disconnectedPlayers`) MUST have both a hard size cap (`MAX_*`) and TTL eviction in `startPeriodicGcTimer()`.
- `ipConnectionCounts` must be periodically reconciled against live sockets in `ioInstance.sockets.sockets` inside `startPeriodicGcTimer()` to prevent state drift over long uptimes.
- Use zero-allocation helpers (`countHumanMembers`, `countBotMembers`) on hot paths instead of `Array.from(room.members.values()).filter(...)`.

## 4. Socket Rate Limiting & Outbound Request Coalescing
- Every client-triggered Socket event carrying payloads or high frequency MUST enforce `checkRateLimit(action, maxCount, windowMs)` and update `room.lastActivityAt = Date.now()`.
- Cached outbound network calls (such as `fetchGooglePublicCerts()`) MUST use singleflight promise deduplication (`inflightCertsPromise`) to prevent Thundering Herd spikes on cache expiry.

## 5. Verification & Zero-Residual Leak Testing
- Always run `npm run build && npm test` before completing any code change.
- New room/socket features must preserve the `Resource Guardrails — Zero-Residual Leak & Bounded Audio Decode Invariants` test in `tests/room.and.api.test.ts`.
