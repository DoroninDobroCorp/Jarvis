import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    middlewareMode: false,
  },
  // Dev-only middleware to collect client logs into terminal
  plugins: [
    react(),
    {
      name: 'client-log-endpoint',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__log', async (req, res) => {
          try {
            const chunks: Uint8Array[] = [];
            req.on('data', (chunk: Uint8Array) => { chunks.push(chunk); });
            await new Promise<void>((resolve) => req.on('end', () => resolve()));
            const body = Buffer.concat(chunks).toString('utf8');
            try {
              const json = body ? JSON.parse(body) : null;
              // print compact
              console.log(`[client] ${new Date().toISOString()} ${json?.scope ?? ''} ${json?.lvl ?? ''}`, json);
            } catch {
              console.log(`[client] ${new Date().toISOString()} raw:`, body);
            }
            res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); res.end('ok');
          } catch {
            res.statusCode = 500; res.end('err');
          }
        });
      },
    } as Plugin,
  ],
})
