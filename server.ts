import express, { ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './src/server/routes/api';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const isProd = process.env.NODE_ENV === 'production';

  // Request parsing with size limit
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Request logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api')) {
        console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });

  // Mount API endpoints
  app.use('/api', apiRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (!isProd) {
    // Development mode: Vite server as middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer }
      }
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = err.status === 413 ? 413 : err.status === 400 ? 400 : 500;
    res.status(status).json({
      error: status === 413 ? 'Request exceeds the 2 MB size limit.' :
        status === 400 ? 'Invalid request body.' : 'Internal server error. Please retry.'
    });
  };
  app.use(errorHandler);
  return { app, httpServer };
}

async function startServer() {
  const PORT = Number(process.env.PORT || '3000');
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const { httpServer } = await createApp();
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Set PORT to an available port and retry.`
      : 'HTTP server failed to listen.');
    process.exitCode = 1;
  });
  httpServer.listen(PORT, '0.0.0.0', () => {
    const isProd = process.env.NODE_ENV === 'production';
    console.log(`[PatchPilot] Server running at http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer().catch((err) => {
  console.error('Failed to start PatchPilot server:', err);
  process.exit(1);
});
