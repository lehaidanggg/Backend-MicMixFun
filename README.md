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
├── API_DOCS.md                     # Tài liệu chi tiết Tính năng, REST API & Socket.IO Events cho Client
├── GAME_DESIGN_MODES.html          # Bản thiết kế trực quan 4 Chế Độ Chơi, Smart Matchmaking & Vòng Đời Trận Đấu
├── CLIENT_OPTIMIZATION_GUIDE.md    # Hướng dẫn tối ưu tải & bảo mật cho Client (Android / iOS / Web)
├── ENUM_LOCALIZATION_GUIDE.md      # Bảng tra cứu mã Enum đa ngôn ngữ (VI / EN)
├── BOT_SOUND_GENERATION_PLAN.md    # Thiết kế cơ chế tổng hợp & biến đổi âm thanh AI Bot theo 3 độ khó
├── Dockerfile                      # Cấu hình đóng gói Docker container (node:20-alpine) cho Railway
├── tsconfig.json                   # Cấu hình biên dịch TypeScript
└── package.json                    # Khai báo dependencies & scripts
```

---

## ✨ Tóm Tắt Tính Năng Chính

1. **Xác thực & Bảo mật chống giả mạo (`src/services/auth.service.ts`)**:
   - Hỗ trợ **Firebase Anonymous / ID Token (`RS256`)** xác thực trực tiếp qua chứng chỉ X.509 của Google.
   - Hỗ trợ **Guest Session Token (`HMAC-SHA256`)** kèm **Client Fingerprint Binding** (`IP + User-Agent/DeviceId`) chống đánh cắp token qua server trung gian.
   - Cơ chế **One-Time Challenge Nonce (`GET /api/auth/challenge`)** chống Replay Attack (hiệu lực 30s, dùng 1 lần).
   - Giới hạn kết nối đồng thời trên mỗi IP (`MAX_CONNECTIONS_PER_IP = 15`) và bộ giới hạn tốc độ (Rate Limiter) cho Chat, Soundboard, Emoji.
2. **4 Chế Độ Chơi & Smart Matchmaking Engine (`src/socket/room.handler.ts`, `src/services/room.service.ts`)**:
   - **Quick Match 4P (`quick_match` / `find_match`)**: Ưu tiên Best-Fit (`3/4 ➔ 2/4 ➔ 1/4`) + FIFO; chờ cơ bản `10s`, tự động **cộng giờ mềm `+5s`** khi ghép được thêm người thật lúc đồng hồ `< 5s` (trần tối đa `16s`), hết giờ tự bù `(4 - N)` AI Bot.
   - **1vs1 Race 2P (`race_1v1` / `find_1v1_match`)**: Đấu tay đôi 2 người (`targetPlayers = 2`), đủ 2 người thật là tự bắt đầu ngay, hết `8s` chờ tự bù `1 AI Bot`.
   - **Create Room & Join Room (`CUSTOM_ROOM`)**: Tạo/vào phòng theo mã Code 6 ký tự, cách ly hoàn toàn khỏi hàng đợi ghép ngẫu nhiên, hỗ trợ Host Migration và **Session Reconnect (120s)** khôi phục điểm khi rớt mạng.
   - **Unified Cancel Match (`cancel_match`) & Live Avatar Slots (`members`)**: Hỗ trợ hủy tìm trận cả khi đứng lẻ `1/4` ở Queue lẫn khi đang ở phòng chờ `2/4`, `3/4`; đồng bộ danh sách ghế Avatar trực tiếp qua `matchmaking_searching`, `matchmaking_tick`, `matchmaking_player_joined`.
3. **Đấu trường nhại giọng Mimic Party — 100% Server-Driven (`src/services/game.service.ts`)**:
   - Vận hành theo State Machine 10 bước do Server điều phối tuyệt đối (không có chủ động Next Round hay nhảy cóc Step): `IDLE` ➔ `THEME_SELECTION` (3.5s) ➔ `PLAYING_SAMPLE` ➔ `PREPARE_RECORDING` (3s) ➔ `USER_RECORDING` ➔ `UPLOADING_SOUND` (3s) ➔ `LISTENING_NOW_PLAYING` (5s) ➔ `SHOWDOWN_REVEAL` (10s) ➔ `AI_SCORING` (4s) ➔ `ROUND_RESULT` (8s) ➔ `BREAK_TIME` (11s) ➔ Vòng kế tiếp / `GAME_OVER` (8s).
   - **Xử lý rời trận giữa chừng thông minh**: `QUICK_MATCH` tiếp tục chạy hết các round rồi tự mở lại phòng tìm người mới; `RACE_1V1` báo kết quả thắng cuộc ngay lập tức (`OPPONENT_LEFT_FORFEIT`) rồi mở lại phòng tìm đối thủ mới.
   - Chấm điểm theo 3 tiêu chí: **Pitch (40%)**, **Rhythm (35%)**, **Energy (25%)**, xếp hạng `S / A / B / C / F` và nhận xét AI đa ngôn ngữ.
4. **Hệ thống AI Bot 3 Độ Khó (`EASY` / `NORMAL` / `HARD`)**:
   - Biến đổi từ chính âm thanh mẫu của vòng đấu bằng thuật toán **WSOLA** (tách biệt cao độ `pitch` và tốc độ `speed`), tiếng lấy hơi và chuỗi lọc Biquad mô phỏng micro điện thoại, xuất ra `audio/wav` thực tế phát qua `/api/attempts/:roomId/:socketId`.
5. **Media, Soundboard, Chat & Live Mic (`src/socket/media.handler.ts`)**:
   - Chat phòng thời gian thực (`send_message`), kích hoạt Soundboard đồng bộ (`trigger_sound`, `stop_all_sounds`), chia sẻ Voice Clip (`share_audio_clip`) và truyền luồng micro trực tiếp (`mic_stream_*`).
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
* **Tài liệu tích hợp đầy đủ cho Client**: Xem chi tiết tại **[API_DOCS.md](./API_DOCS.md)**
* **Production Server (Railway)**: `https://micmixfun.up.railway.app`
* **Health Check API**: `GET https://micmixfun.up.railway.app/api/health`
* **Cloudflare R2 Audio CDN**: `https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev`
