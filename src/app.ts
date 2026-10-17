import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { setIoInstance, startPeriodicGcTimer } from './services/room.service';
import { registerWebRoutes } from './routes/web.routes';
import { registerApiRoutes } from './routes/api.routes';
import { registerSocketServer } from './socket/index';

export const app = express();
app.set('trust proxy', 1);
export const server = http.createServer(app);

// Cấu hình Socket.IO với CORS hỗ trợ Web & Mobile (Android/iOS)
export const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
  },
  maxHttpBufferSize: 1e6 // Giới hạn 1MB mỗi gói tin để bảo vệ RAM Server
});

setIoInstance(io);

// Global Express Middleware (Full CORS + Preflight support)
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'Accept', 'Origin', 'X-Requested-With']
  })
);
app.use(express.json({ limit: '64kb' }));

// Đăng ký Routes & Socket Handlers
registerWebRoutes(app);
registerApiRoutes(app, io);
registerSocketServer(io);

// Khởi chạy bộ dọn dẹp bộ nhớ định kỳ (Orphan Rooms & Expired Nonces)
startPeriodicGcTimer();
