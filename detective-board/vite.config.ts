// @ts-nocheck
import { defineConfig, type Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Demo helper for OpenAI text when API key is absent
function buildDemoTextResponse(message: string | undefined): { text: string; model: string; stub: true } {
  const lower = (message || '').toLowerCase();
  const wantsSave = /обнов|сохран|save_json/.test(lower);
  const lines = [
    'Ассистент (демо): работаю офлайн, поэтому отвечаю здесь без обращения к OpenAI.',
  ];
  if (wantsSave) {
    lines.push('Фиксирую изменения в профиле пользователя и сохраняю их.');
    lines.push('SAVE_JSON: { "about_me": "Родился в Грозном. Гражданство России. Жена и дети — украинцы.", "environment": "Черногория, город Бар" }');
  } else {
    lines.push('Пока просто отвечаю и жду конкретных указаний, что сохранить.');
  }
  lines.push('Чтобы получить ответы реальной модели, задайте переменную окружения OPENAI_API_KEY.');
  return { text: lines.join('\n'), model: 'demo-offline', stub: true };
}

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
              // Read and parse request body
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
              const textModel = (process.env.GOOGLE_TEXT_MODEL || 'gemini-1.5-flash-latest');

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

              const apiKey = GOOGLE_API_KEY;
              if (!apiKey) {
                res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'GOOGLE_API_KEY is not set on server' }));
                return;
              }

              const payload: {
                contents: Array<{ role: string; parts: Array<{ text: string }> }>;
                systemInstruction?: { role: string; parts: Array<{ text: string }> };
                safetySettings?: Array<{ category: string; threshold: string }>;
                generationConfig: { temperature: number };
              } = {
                contents: [
                  { role: 'user', parts: [{ text: user }] },
                ],
                generationConfig: { temperature: 0.3 },
              };
              if (sys) {
                payload.systemInstruction = { role: 'system', parts: [{ text: sys }] };
              }
              payload.safetySettings = [
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                { category: 'HARM_CATEGORY_SEXUAL', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
              ];

              const url = `https://generativelanguage.googleapis.com/v1beta/models/${textModel}:generateContent?key=${apiKey}`;
              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              type GeminiContentPart = { text?: string };
              type GeminiCandidate = { content?: { parts?: GeminiContentPart[] }; text?: string };
              type GeminiResponse = { candidates?: GeminiCandidate[]; error?: { message?: string } };
              const json = await resp.json() as GeminiResponse;
              if (!resp.ok) {
                throw new Error(json?.error?.message || 'Google response not OK');
              }
              let text = '';
              const candidate = json?.candidates?.[0];
              const parts = candidate?.content?.parts;
              if (Array.isArray(parts)) {
                text = parts.map((part) => (part?.text ?? '')).join('').trim();
              }
              if (!text && candidate?.text) {
                text = candidate.text;
              }
              res.statusCode = resp.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ text, model: textModel }));
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

              // Minimal OpenAI chat.completions flow
              const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: textModel,
                  messages: [
                    { role: 'system', content: sys },
                    { role: 'user', content: user },
                  ],
                  temperature: 0.3,
                }),
              });
              const json = await resp.json();
              if (!resp.ok) {
                const err = (json && typeof json === 'object' && (json as any).error && (json as any).error.message) || `HTTP ${resp.status}`;
                throw new Error(String(err));
              }
              const text = (json?.choices?.[0]?.message?.content ?? '').trim();
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ text, model: textModel }));

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
