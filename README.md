# MicMixFun & Mimic Party — Backend Server

Hệ thống Real-time Socket.IO & REST API cho **MicMixFun** và đấu trường nhại giọng **Mimic Party** (Express 5 + Socket.IO + Cloudflare R2 CDN + Railway Docker).

---

## 📂 Cấu Trúc Thư Mục (`backend/`)

```text
backend/
├── src/
│   ├── config/
│   │   ├── constants.js            # Cấu hình hệ thống, biến môi trường, R2 CDN & Bảo mật
│   │   └── swagger.js              # Đặc tả OpenAPI 3.0.3 & Giao diện Swagger UI (/api-docs)
│   ├── services/
│   │   ├── auth.service.js         # Xác thực HMAC-SHA256, Firebase RS256 ID Token, Fingerprint & Challenge Nonce
│   │   ├── room.service.js         # Quản lý In-Memory Rooms, GameSessions, Clear Data & GC Timer
│   │   └── audio.service.js        # Tra cứu danh mục 251 âm thanh & thời lượng từ sounds/catalog.json + R2 CDN
│   ├── game/
│   │   ├── soundPacks.js           # Danh mục SOUND_PACKS, GAME_STATES, STATE_LABELS & AI_REMARKS
│   │   └── MimicGameSession.js     # State Machine cốt lõi của đấu trường nhại giọng Mimic Party
│   ├── routes/
│   │   ├── web.routes.js           # Điều hướng trang chủ về /api-docs & Redirect đường dẫn âm thanh sang R2 CDN
│   │   └── api.routes.js           # Toàn bộ REST API (/api/auth/*, /api/rooms, /api/sounds, /api-docs...)
│   ├── socket/
│   │   ├── auth.middleware.js      # Handshake Middleware (Anti-Relay, giới hạn IP, xác thực Token/Firebase)
│   │   ├── room.handler.js         # Sự kiện phòng: create_room, join_room, leave_room, close_room, kick_player...
│   │   ├── media.handler.js        # Sự kiện Chat, Soundboard Sync, Share Audio Clip & Live Mic Stream
│   │   ├── game.handler.js         # Sự kiện Gameplay Mimic Party: game_start, game_submit_audio, voting...
│   │   └── index.js                # Điều phối kết nối Socket.IO, Rate Limiter & Disconnect Cleanup
│   └── app.js                      # Khởi tạo Express 5 App, HTTP Server và Socket.IO Server
├── sounds/
│   └── catalog.json                # Metadata (id, pack, duration, sha256) của 251 file .mp3 trên Cloudflare R2
├── Dockerfile                      # Cấu hình đóng gói Docker container (node:20-alpine) cho Railway
├── .dockerignore                   # Loại trừ file thừa khi build Docker image
├── .env.example                    # Mẫu biến môi trường
├── server.js                       # Entry point chính khởi chạy Server
├── API_DOCS.md                     # Tài liệu chi tiết REST API & Socket.IO Events
├── CLIENT_OPTIMIZATION_GUIDE.md    # Hướng dẫn tối ưu tải & bảo mật cho Client (Android)
└── package.json                    # Khai báo dependencies & scripts
```

---

## 🚀 Cách Khởi Chạy Server

```bash
cd backend
npm install
npm start
```

### Các đường dẫn chính:
* **Production Server (Railway)**: `https://micmixfun.up.railway.app`
* **Swagger API Documentation**: `https://micmixfun.up.railway.app/api-docs` (hoặc `/docs`)
* **OpenAPI 3.0 JSON Spec**: `https://micmixfun.up.railway.app/api-docs.json`
* **Health Check API**: `GET https://micmixfun.up.railway.app/api/health`
* **Cloudflare R2 Audio CDN**: `https://pub-2ec3726948d14e47babdc7ea12268a78.r2.dev`
