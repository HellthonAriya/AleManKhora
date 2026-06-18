/**
 * AleManKhora — Server entry point
 */
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';

import './db.js';
import { authMiddleware } from './auth.js';
import apiRouter from './routes/api.js';
import adminRouter from './routes/admin.js';
import { GameManager } from './game/manager.js';
import { registerSocket } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true, credentials: true } });

const manager = new GameManager(io);

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(authMiddleware);

// API
app.use('/api', apiRouter);
app.use('/api/admin', adminRouter(manager));

app.get('/api/health', (req, res) => res.json({ ok: true, live: manager.liveStats() }));

// Static files
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// SPA fallback — serve index.html for non-API routes.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Sockets
registerSocket(io, manager);

server.listen(PORT, () => {
  console.log(`\n  اِل من خورا (AleManKhora) running → http://localhost:${PORT}\n`);
});

export { app, server, io, manager };
