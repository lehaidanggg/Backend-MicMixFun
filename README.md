# MicMixFun & Mimic Party — Backend Server

Hệ thống Real-time Socket.IO & REST API cho **MicMixFun** và đấu trường nhại giọng **Mimic Party** (TypeScript + Express 5 + Socket.IO + Cloudflare R2 CDN + Railway Docker).

---

## 📂 Cấu Trúc Thư Mục (`backend/`)

```text
backend/
├── src/
│   ├── config/
│   │   ├── constants.ts            # Cấu hình hệ thống, biến môi trường, R2 CDN & Bảo mật
│   │   └── messages.ts             # Toàn bộ mã Enum Đa ngôn ngữ (VI / EN) & Bảng từ điển ENUM_DICTIONARY
│   ├── services/
│   │   ├── auth.service.ts         # Xác thực HMAC-SHA256, Firebase RS256 ID Token, Fingerprint & Challenge Nonce
│   │   ├── room.service.ts         # Quản lý In-Memory Rooms, GameSessions, Matchmaking Queue, AI Bots & GC Timer
│   │   └── audio.service.ts        # Tra cứu danh mục 251 âm thanh (catalog.json + R2 CDN) & Tổng hợp WAV cho AI Bot
│   ├── game/
│   │   ├── soundPacks.ts           # Danh mục 9 SOUND_PACKS, GAME_STATES, STATE_LABELS & AI_REMARKS
│   │   └── MimicGameSession.ts     # State Machine cốt lõi của đấu trường nhại giọng Mimic Party
│   ├── routes/
│   │   ├── web.routes.ts           # Trạng thái trang chủ & Redirect đường dẫn âm thanh cũ sang R2 CDN
│   │   └── api.routes.ts           # Toàn bộ REST API (/api/auth/*, /api/rooms, /api/sounds, /api/enums...)
│   ├── socket/
│   │   ├── auth.middleware.ts      # Handshake Middleware (Anti-Relay, giới hạn IP, xác thực Token/Firebase)
│   │   ├── room.handler.ts         # Sự kiện phòng, Quản lý AI Bot & Tìm trận nhanh (Matchmaking Queue)
│   │   ├── media.handler.ts        # Sự kiện Chat, Soundboard Sync, Share Audio Clip & Live Mic Stream
│   │   ├── game.handler.ts         # Sự kiện Gameplay Mimic Party: game_start, game_submit_audio, voting...
│   │   └── index.ts                # Điều phối kết nối Socket.IO, Rate Limiter & Disconnect Cleanup
│   ├── types/
│   │   └── index.ts                # Định nghĩa TypeScript Interfaces & Types toàn hệ thống
│   ├── app.ts                      # Khởi tạo Express 5 App, HTTP Server và Socket.IO Server
│   └── server.ts                   # Entry point chính khởi chạy Server
├── sounds/
│   └── catalog.json                # Metadata (id, pack, duration, sha256) của 251 file .mp3 trên Cloudflare R2
├── tests/                          # Bộ Unit & Integration Tests (Auth, Audio, Game Session, Room/API, Socket)
├── docs/                           # Thư mục tài liệu & sơ đồ thiết kế cho Client (Android / iOS / Web)
│   ├── API_DOCS.md                 # Tài liệu chi tiết Tính năng, REST API & Socket.IO Events cho Client
│   ├── CLIENT_OPTIMIZATION_GUIDE.md# Hướng dẫn tối ưu tải, streaming 4KB & bảo mật cho Client
│   ├── ENUM_LOCALIZATION_GUIDE.md  # Bảng tra cứu mã Enum đa ngôn ngữ (VI / EN)
│   ├── BOT_SOUND_GENERATION_PLAN.md# Thiết kế cơ chế tổng hợp & biến đổi âm thanh AI Bot theo 3 độ khó
│   ├── GAME_FLOW_DIAGRAMS.html     # Sơ đồ trực quan đầy đủ luồng 4 Chế Độ Chơi, 9 State Gameplay & AI Bot 1:1
│   └── GAME_DESIGN_MODES.html      # Bản thiết kế chi tiết 4 Chế Độ Chơi & Smart Matchmaking Engine
├── AGENTS.md                       # Quy tắc bất biến về kiến trúc, vòng đời phòng & hiệu năng bộ nhớ (Guardrails)
├── Dockerfile                      # Cấu hình đóng gói Docker container (node:20-alpine) cho Railway
├── tsconfig.json                   # Cấu hình biên dịch TypeScript
└── package.json                    # Khai báo dependencies & scripts
```

---

## ✨ Tóm Tắt Tính Năng Chính

1. **Xác thực & Bảo mật chống giả mạo (`src/services/auth.service.ts`)**:
   - Hỗ trợ **Firebase Anonymous / ID Token (`RS256`)** xác thực trực tiếp qua chứng chỉ X.509 của Google (tích hợp Singleflight chống Thundering Herd khi làm mới chứng chỉ).
   - Hỗ trợ **Guest Session Token (`HMAC-SHA256`)** kèm **Client Fingerprint Binding** (`IP + User-Agent/DeviceId`) chống đánh cắp token qua server trung gian.
   - Cơ chế **One-Time Challenge Nonce (`GET /api/auth/challenge`)** chống Replay Attack (hiệu lực 30s, dùng 1 lần, giới hạn trần `10,000` nonces).
   - Giới hạn kết nối đồng thời trên mỗi IP (`MAX_CONNECTIONS_PER_IP = 15`, tự động đối soát self-healing định kỳ) và bộ giới hạn tốc độ (Rate Limiter) cho toàn bộ sự kiện Socket.
2. **4 Chế Độ Chơi & Smart Matchmaking Engine (`src/socket/room.handler.ts`, `src/services/room.service.ts`)**:
   - **Quick Match 4P (`quick_match` / `find_match`)**: Ưu tiên Best-Fit (`3/4 ➔ 2/4 ➔ 1/4`) + FIFO; chờ cơ bản `10s`, tự động **cộng giờ mềm `+5s`** khi ghép được thêm người thật lúc đồng hồ `< 5s` (trần tối đa `16s`), hết giờ tự bù `(4 - N)` AI Bot.
   - **1vs1 Race 2P (`race_1v1` / `find_1v1_match`)**: Đấu tay đôi 2 người (`targetPlayers = 2`), đủ 2 người thật là tự bắt đầu ngay, hết `8s` chờ tự bù `1 AI Bot`.
   - **Create Room & Join Room (`CUSTOM_ROOM`)**: `create_room` tạo phòng riêng và tự động cho Host vào phòng ngay; `join_room` chỉ cho phép vào phòng `CUSTOM_ROOM` đang tồn tại theo mã Code (chặn người lạ xâm nhập vào phòng Matchmaking), hỗ trợ Host Migration và **Session Reconnect (120s)** khôi phục điểm khi rớt mạng.
   - **Unified Cancel Match (`cancel_match`) & Live Avatar Slots (`members`)**: Hỗ trợ hủy tìm trận cả khi đứng lẻ `1/4` ở Queue lẫn khi đang ở phòng chờ `2/4`, `3/4`; đồng bộ danh sách ghế Avatar trực tiếp qua `matchmaking_searching`, `matchmaking_tick`, `matchmaking_player_joined`.
3. **Đấu trường nhại giọng Mimic Party (`src/game/MimicGameSession.ts`)**:
   - Vận hành theo State Machine chuẩn UI Figma (`5.0` ➔ `5.10`): `IDLE` ➔ `THEME_SELECTION` (3.5s) ➔ `PLAYING_SAMPLE` ➔ `PREPARE_RECORDING` (3s) ➔ `USER_RECORDING` ➔ `UPLOADING_SOUND` (3s) ➔ `SHOWDOWN_REVEAL` (30s AFK timer / 100% Player bấm `"FINISH ROUND ▶"`) ➔ `AI_SCORING` (4s) ➔ `ROUND_RESULT` (7s) ➔ `BREAK_TIME` (11s / 100% bấm `"NEW ROUND NOW"`) ➔ `GAME_OVER`.
   - **Giải tán phòng tức thì sau trận (`0ms` Zero-Residual Leak)**: Khi `QUICK_MATCH` hoặc `RACE_1V1` kết thúc ở `5.10 GAME_OVER` (hoặc khi đối thủ 1v1 thoát giữa trận `OPPONENT_LEFT_FORFEIT`), Server lập tức giải tán và xóa sổ phòng (`roomDisbanded: true`, `currentRoomId = null`), đưa người chơi về trạng thái **Online**.
   - Chấm điểm Single-Pass theo 3 tiêu chí: **Pitch (40%)**, **Rhythm (35%)**, **Energy (25%)**, xếp hạng `S / A / B / C / F` và nhận xét AI đa ngôn ngữ.
4. **Hệ thống AI Bot 3 Độ Khó (`EASY` / `NORMAL` / `HARD`) với Quota 1:1 (`CLIENT_UPLOAD` & `LIVE_PLAYBACK_DSP`)**:
   - Mỗi máy người thật chỉ nhận tối đa **1 Bot mỗi vòng (`CLIENT_UPLOAD`)** ngay từ `5.0 THEME_SELECTION` để biến đổi âm thanh bằng `OfflineAudioContext` và upload (`<= 350KB`) lên Server chấm điểm thực tế; các Bot dư ra sử dụng chế độ **`LIVE_PLAYBACK_DSP`** phát trực tiếp tại Client.
5. **Media, Soundboard, Chat, Bounded Audio & Telemetry (`src/socket/media.handler.ts`, `src/routes/api.routes.ts`)**:
   - Kiểm tra kích thước Base64 trước khi cấp phát `Buffer` (`decodeBoundedBase64Audio`: User `<= 512KB`, Bot `<= 350KB`), tự động chuyển sang HTTP Stream URL (`/api/attempts/:roomId/:socketId`) cho mọi bản thu `> 4KB`, và cung cấp chỉ số bộ nhớ / bộ đếm trạng thái qua `GET /api/health`.
6. **Kho 251 Âm thanh trên Cloudflare R2 CDN & Đa ngôn ngữ (`VI / EN`)**:
   - Toàn bộ mã lỗi, thông báo hệ thống, nhãn trạng thái, tên gói âm thanh và lời bình AI được chuẩn hóa thành mã Enum tại `GET /api/enums`.

---

## 🚀 Cách Khởi Chạy Server

```bash
npm install
npm run dev      # Chạy chế độ phát triển (tsx watch)
npm run build    # Biên dịch TypeScript sang dist/
npm start        # Chạy bản production (node dist/server.js)
npm test         # Chạy toàn bộ bộ kiểm thử tự động
```

### Các đường dẫn chính:
* **Tài liệu tích hợp đầy đủ cho Client**: Xem chi tiết tại **[docs/API_DOCS.md](./docs/API_DOCS.md)**
* **Production Server (Railway)**: `https://micmixfun.up.railway.app`
* **Health Check API**: `GET https://micmixfun.up.railway.app/api/health`
* **Cloudflare R2 Audio CDN**: `https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev`
