import { defineConfig, type Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const OPENAI_API_KEY = env.OPENAI_API_KEY;
  const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

  return {
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

        // Text completion endpoint (dev-only) to avoid WebRTC for text mode
        server.middlewares.use('/api/openai/text', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
          try {
            const apiKey = OPENAI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set on server' }));
              return;
            }
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

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
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
            const json = await resp.json() as any;
            const text = json?.choices?.[0]?.message?.content || '';
            res.statusCode = resp.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ text, model: textModel }));
          } catch (e) {
            console.error('/api/openai/text error', e);
            res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'text_failed' }));
          }
        });
        // Ephemeral token endpoint for OpenAI Realtime
        server.middlewares.use('/api/openai/rt/token', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
          try {
            const apiKey = OPENAI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set on server' }));
              return;
            }
            const defaultModel = 'gpt-4o-realtime-preview';
            const chunks: Uint8Array[] = [];
            req.on('data', (c: Uint8Array) => chunks.push(c));
            await new Promise<void>((resolve) => req.on('end', () => resolve()));
            let reqModel = defaultModel;
            try {
              const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
              if (parsed?.model && typeof parsed.model === 'string') reqModel = parsed.model;
            } catch {}
            const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'realtime=v1',
              },
              body: JSON.stringify({ model: reqModel, voice: 'verse' }),
            });
            const json = (await resp.json()) as Record<string, unknown>;
            res.statusCode = resp.status; res.setHeader('Content-Type', 'application/json');
            const payload = json && typeof json === 'object' ? { ...json, model: reqModel } : { model: reqModel, raw: json };
            res.end(JSON.stringify(payload));
          } catch (e) {
            console.error('rt/token error', e);
            res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'token_failed' }));
          }
        });

        // Telegram bot integration: reminders + responses
        const tgToken = TELEGRAM_BOT_TOKEN;
        const tgApi = tgToken ? `https://api.telegram.org/bot${tgToken}` : '';
        let tgUpdatesOffset = 0;
        let tgChatId: number | null = null;
        const askedByDay: Record<string, string[]> = {}; // yyyy-mm-dd -> ['09:00', ...]
        const pendingRatings: Array<{ awareness: number; efficiency: number; joy: number; ts: number }> = [];

        function ymd(d = new Date()): string { return d.toISOString().slice(0, 10); }
        // function ym(d = new Date()): string { return d.toISOString().slice(0, 7); }
        function pad(n: number): string { return n < 10 ? '0' + n : '' + n; }
        function hhmm(d = new Date()): string { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
        const SLOT_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];

        server.middlewares.use('/api/tg/status', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ enabled: !!tgToken, chatId: tgChatId }));
        });

        server.middlewares.use('/api/tg/register', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
          try {
            const chunks: Uint8Array[] = [];
            req.on('data', (c: Uint8Array) => chunks.push(c));
            await new Promise<void>((resolve) => req.on('end', () => resolve()));
            const json = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as { chatId?: number } : {};
            if (typeof json.chatId === 'number') tgChatId = json.chatId;
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, chatId: tgChatId }));
          } catch (e) {
            res.statusCode = 400; res.end('bad');
          }
        });

        server.middlewares.use('/api/tg/pending', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          const items = pendingRatings.splice(0, pendingRatings.length);
          res.end(JSON.stringify({ items }));
        });

        async function tgSendMessage(chatId: number, text: string) {
          if (!tgApi) return;
          try {
            await fetch(`${tgApi}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text }),
            });
          } catch (e) {
            console.error('tg:sendMessage failed', e);
          }
        }

        function parseTriple(text: string): { a: number; e: number; j: number } | null {
          const cleaned = text.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
          const parts = cleaned.split(' ').map((x) => Number(x)).filter((n) => !isNaN(n));
          if (parts.length >= 3) {
            const [a, e, j] = parts;
            const inRange = (n: number) => n >= 1 && n <= 10;
            if (inRange(a) && inRange(e) && inRange(j)) return { a, e, j };
          }
          return null;
        }

        async function tgPollLoop() {
          if (!tgApi) return;
          try {
            const resp = await fetch(`${tgApi}/getUpdates?timeout=20&offset=${tgUpdatesOffset}`);
            const json: any = await resp.json();
            const updates = Array.isArray(json.result) ? (json.result as any[]) : [];
            for (const upd of updates) {
              tgUpdatesOffset = Math.max(tgUpdatesOffset, (upd.update_id || 0) + 1);
              const msg = upd.message;
              if (!msg) continue;
              const chatId = msg.chat?.id as number | undefined;
              const text = (msg.text as string | undefined) || '';
              if (!chatId) continue;
              // Auto-register on /start or first message if none
              if (!tgChatId) tgChatId = chatId;
              if (/^\/start/.test(text)) {
                await tgSendMessage(chatId, 'Привет! Я буду присылать напоминания 6 раз в день. Ответьте тремя числами 1–10: осознанность, эффективность, удовольствие. Пример: 7 6 8');
                continue;
              }
              const triple = parseTriple(text);
              if (triple) {
                pendingRatings.push({ awareness: triple.a, efficiency: triple.e, joy: triple.j, ts: Date.now() });
                await tgSendMessage(chatId, `Сохранено: О ${triple.a}, Э ${triple.e}, У ${triple.j}. Спасибо!`);
              } else {
                await tgSendMessage(chatId, 'Не распознал три числа 1–10. Пример: 7 6 8');
              }
            }
          } catch (e) {
            // silent
          } finally {
            setTimeout(tgPollLoop, 2000);
          }
        }

        async function scheduleLoop() {
          try {
            const now = new Date();
            const day = ymd(now);
            const time = hhmm(now);
            if (tgChatId && SLOT_TIMES.includes(time)) {
              const asked = askedByDay[day] ?? (askedByDay[day] = []);
              if (!asked.includes(time)) {
                asked.push(time);
                await tgSendMessage(tgChatId, 'Оцените: пришлите три числа 1–10 через пробел — осознанность, эффективность, удовольствие. Пример: 7 6 8');
              }
            }
            // rollover cleanup: new day => reset asked
            const prevDays = Object.keys(askedByDay).filter((d) => d !== day);
            for (const d of prevDays) delete askedByDay[d];
          } catch (e) {
            // silent
          } finally {
            setTimeout(scheduleLoop, 60 * 1000);
          }
        }

        // Start loops only if token present
        if (tgToken) {
          tgPollLoop();
          scheduleLoop();
          console.log('[tg] integration enabled');
        } else {
          console.log('[tg] TELEGRAM_BOT_TOKEN not set — integration disabled');
        }
      },
    } as Plugin,
    ],
  };
})
