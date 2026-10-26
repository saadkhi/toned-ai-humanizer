import runStage from '../api/run-stage.js';
import health from '../api/health.js';

const MAX_BODY_BYTES = 1024 * 1024;

// The same handlers run in Vercel functions and locally: no mocked API server.
export function localApi() {
  return {
    name: 'toned-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (!pathname.startsWith('/api/')) return next();
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
          return res;
        };
        if (pathname === '/api/health') return health(req, res);
        if (pathname !== '/api/run-stage') return res.status(404).json({ error: 'Not found' });
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request is too large.' });
            chunks.push(chunk);
          }
          req.body = Buffer.concat(chunks).toString('utf8');
          return await runStage(req, res);
        } catch {
          if (!res.headersSent) return res.status(500).json({ error: 'The request could not be processed.' });
          res.end();
        }
      });
    },
  };
}
