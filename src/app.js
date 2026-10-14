const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { setIoInstance, startPeriodicGcTimer } = require('./services/room.service');
const { registerWebRoutes } = require('./routes/web.routes');
const { registerApiRoutes } = require('./routes/api.routes');
const { registerSocketServer } = require('./socket/index');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Cấu hình Socket.IO với CORS hỗ trợ Web & Mobile (Android/iOS)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
  },
  maxHttpBufferSize: 1e6 // Giới hạn 1MB mỗi gói tin để bảo vệ RAM Server
});

setIoInstance(io);

// Global Express Middleware (Full CORS + Preflight support)
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'Accept', 'Origin', 'X-Requested-With']
}));
app.use(express.json());

// Đăng ký Routes & Socket Handlers
registerWebRoutes(app);
registerApiRoutes(app, io);
registerSocketServer(io);

// Khởi chạy bộ dọn dẹp bộ nhớ định kỳ (Orphan Rooms & Expired Nonces)
startPeriodicGcTimer();

module.exports = {
  app,
  server,
  io
};
