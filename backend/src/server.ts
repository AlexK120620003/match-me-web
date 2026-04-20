/**
 * Match-Me Web backend entry point.
 * Express app + HTTP server + Socket.io.
 */
import './types'; // ensure global augmentation is loaded
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { router } from './routes';
import { errorHandler } from './middleware/error';
import { initSocket } from './sockets/io';

const app = express();

app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Static uploads (avatars)
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', router);

app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);

server.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
  console.log(`[server] client expected at ${env.CLIENT_URL}`);
});
