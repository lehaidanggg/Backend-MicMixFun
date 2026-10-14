# MicMixFun & Mimic Party Server

Hệ thống Real-time Socket.IO & REST API cho **MicMixFun Studio** và đấu trường nhại giọng **Mimic Party**.

---

## 📂 Cấu Trúc Thư Mục (Clean Modular Architecture)

```text
server/
├── src/
│   ├── config/
│   │   └── constants.js            # Cấu hình hệ thống, biến môi trường, giới hạn Room & Bảo mật
│   ├── services/
│   │   ├── auth.service.js         # Xác thực HMAC-SHA256, Firebase RS256 ID Token, Fingerprint & Challenge Nonce
│   │   ├── room.service.js         # Quản lý In-Memory Rooms, GameSessions, Clear Data (destroyRoomData) & GC Timer
│   │   └── audio.service.js        # Bộ phân tích thời lượng WAV/MP3 thuần Node.js (Pure Buffer Parser)
│   ├── game/
│   │   ├── soundPacks.js           # Danh mục SOUND_PACKS, GAME_STATES, STATE_LABELS & AI_REMARKS
│   │   └── MimicGameSession.js     # State Machine cốt lõi của đấu trường nhại giọng Mimic Party
│   ├── routes/
│   │   ├── web.routes.js           # Phục vụ giao diện Demo HTML & tài nguyên âm thanh tĩnh
│   │   └── api.routes.js           # Toàn bộ REST API (/api/auth/*, /api/rooms, /api/sounds, /api/attempts/*)
│   ├── socket/
│   │   ├── auth.middleware.js      # Handshake Middleware (Anti-Relay, giới hạn IP, xác thực Token/Firebase)
│   │   ├── room.handler.js         # Sự kiện phòng: create_room, join_room, leave_room, close_room, kick_player...
│   │   ├── media.handler.js        # Sự kiện Chat, Soundboard Sync, Share Audio Clip & Live Mic Stream
│   │   ├── game.handler.js         # Sự kiện Gameplay Mimic Party: game_start, game_submit_audio, voting...
│   │   └── index.js                # Điều phối kết nối Socket.IO, Rate Limiter & Disconnect Cleanup
│   └── app.js                      # Khởi tạo Express App, HTTP Server và Socket.IO Server
├── audio/                          # Thư viện âm thanh phân loại theo chủ đề (animals, anime, meme...)
├── downloaded_sounds/              # Kho 255+ file âm thanh mẫu (.mp3/.wav) phục vụ trực tiếp cho game
├── server.js                       # Entry point chính khởi chạy Server & re-export đầy đủ API
├── mimic_game_engine.js            # Facade re-export Game Engine (tương thích ngược 100%)
├── room_demo.html                  # Giao diện Demo Tạo/Join Phòng, Chat & Soundboard
├── mimic_party.html                # Giao diện Đấu Trường Nhại Giọng Online (Mimic Party)
├── index.html                      # Giao diện Web Studio Catalog
├── API_DOCS.md                     # Tài liệu đặc tả chi tiết REST API & Socket.IO Events
├── CLIENT_OPTIMIZATION_GUIDE.md    # Hướng dẫn tối ưu tải & bảo mật chống Server Trung Gian cho Client (Android/Web)
└── package.json                    # Khai báo dependencies & scripts
```

---

## 🚀 Cách Khởi Chạy Server

```bash
cd server
npm install
npm start
```

### Các đường dẫn chính sau khi chạy (Mặc định cổng `3000`):
* **Trang Demo Phòng & Soundboard**: `http://localhost:3000/room`
* **Đấu Trường Nhại Giọng (Mimic Party)**: `http://localhost:3000/mimic`
* **Web Studio Catalog**: `http://localhost:3000/studio`
* **Health Check API**: `GET http://localhost:3000/api/health`
* **Auth Challenge API**: `GET http://localhost:3000/api/auth/challenge`
* **Firebase Auth API**: `POST http://localhost:3000/api/auth/firebase`
* **Guest Auth API**: `POST http://localhost:3000/api/auth/guest`

---

## 📚 Tài Liệu Kỹ Thuật
* Xem chi tiết giao thức REST & Socket.IO tại: [`API_DOCS.md`](./API_DOCS.md)
* Xem hướng dẫn tối ưu hóa Client & chống Server trung gian tại: [`CLIENT_OPTIMIZATION_GUIDE.md`](./CLIENT_OPTIMIZATION_GUIDE.md)
