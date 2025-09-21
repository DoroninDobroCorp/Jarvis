import { defineConfig, type Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// ... (остальные импорты и константы из оригинального файла)

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const OPENAI_API_KEY = env.OPENAI_API_KEY;
  const GOOGLE_API_KEY = env.GOOGLE_API_KEY;
  const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

  return {
    server: {
      middlewareMode: false,
    },
    plugins: [
      react(),
      {
        name: 'client-log-endpoint',
        apply: 'serve',
        configureServer(server) {
          // ... (код логгирования и другие middleware)

          // Text completion endpoint (Google Gemini)
          server.middlewares.use('/api/google/text', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
            try {
              // ... (чтение тела запроса)

              // Test stub: allow Playwright to request deterministic SAVE_JSON application
              if (message && message.startsWith('[TEST_SAVE_JSON]')) {
                const text = [
                  'Ассистент: Обновляю сохранённую информацию согласно вашему запросу.',
                  'SAVE_JSON: { "about_me": "Родился в Грозном. Гражданство России. Жена и дети — украинцы.", "environment": "Черногория, город Бар" }'
                ].join('\n');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ text, model: textModel, stub: true }));
                return;
              }

              // ... (основная логика запроса к Google API)
            } catch (e) {
              console.error('/api/google/text error', e);
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'google_text_failed' }));
            }
          });

          // Text completion endpoint (OpenAI, fallback)
          server.middlewares.use('/api/openai/text', async (req, res) => {
            if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
            try {
              // Read body first to support local test stubs
              const chunks: Uint8Array[] = [];
              req.on('data', (c: Uint8Array) => chunks.push(c));
              await new Promise<void>((resolve) => req.on('end', () => resolve()));
              const bodyStr = Buffer.concat(chunks).toString('utf8');
              const body = bodyStr ? JSON.parse(bodyStr) as { message?: string; instructions?: string; context?: string } : {};
              const message = (body.message || '').slice(0, 4000);
              const instructions = (body.instructions || '').slice(0, 8000);
              const context = (body.context || '').slice(0, 16000);
              const sys = instructions || 'Ты ассистент и отвечаешь кратко и по делу на русском.';
              const user = context ? `${message}\n\nКОНТЕКСТ:\n${context}` : message;
              const textModel = (env.OPENAI_TEXT_MODEL || 'gpt-4o-mini');

              // Test stub: allow Playwright to request deterministic SAVE_JSON application
              if (message && message.startsWith('[TEST_SAVE_JSON]')) {
                const text = [
                  'Ассистент: Обновляю сохранённую информацию согласно вашему запросу.',
                  'SAVE_JSON: { "about_me": "Родился в Грозном. Гражданство России. Жена и дети — украинцы.", "environment": "Черногория, город Бар" }'
                ].join('\n');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ text, model: textModel, stub: true }));
                return;
              }

              if (!OPENAI_API_KEY) {
                const demo = buildDemoTextResponse(message);
                res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(demo));
                return;
              }

              // ... (основная логика запросов к OpenAI с двумя эндпоинтами)

            } catch (e) {
              console.error('/api/openai/text error', e);
              if (!OPENAI_API_KEY) {
                const demo = buildDemoTextResponse(undefined);
                res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(demo));
                return;
              }
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Серверная ошибка при обращении к OpenAI', message: e instanceof Error ? e.message : String(e) }));
            }
          });

          // ... (остальные middleware)
        },
      },
    ],
  };
});
