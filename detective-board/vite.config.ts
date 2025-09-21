import { defineConfig, type Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const DEMO_ABOUT = 'Родился в Грозном. Гражданство России. Жена и дети — украинцы.'
const DEMO_ENVIRONMENT = 'Черногория, город Бар'
const DEMO_SAVE_PATCH = JSON.stringify({ about_me: DEMO_ABOUT, environment: DEMO_ENVIRONMENT })

function flattenChatContent(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    return input.map((item) => flattenChatContent(item)).join('');
  }
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (Array.isArray(record.text)) return flattenChatContent(record.text);
    if ('content' in record) return flattenChatContent(record.content);
    if ('output_text' in record) return flattenChatContent(record.output_text);
    if ('value' in record) return flattenChatContent(record.value);
    if ('parts' in record) return flattenChatContent(record.parts);
  }
  return '';
}

function extractTextFromOpenAIResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const direct = flattenChatContent(obj.text);
  if (direct) return direct;
  const outputText = flattenChatContent(obj.output_text);
  if (outputText) return outputText;
  const outputBlocks = flattenChatContent(obj.output);
  if (outputBlocks) return outputBlocks;
  const responseOut = flattenChatContent((obj.response as Record<string, unknown> | undefined)?.output_text);
  if (responseOut) return responseOut;
  if (Array.isArray(obj.choices)) {
    for (const choice of obj.choices as unknown[]) {
      const candidate = flattenChatContent((choice as any)?.message?.content ?? (choice as any)?.message) ||
        flattenChatContent((choice as any)?.delta?.content ?? (choice as any)?.delta) ||
        flattenChatContent((choice as any)?.content) ||
        flattenChatContent((choice as any)?.output_text);
      if (candidate) return candidate;
    }
  }
  if (Array.isArray(obj.data)) {
    for (const entry of obj.data as unknown[]) {
      const candidate = flattenChatContent(entry);
      if (candidate) return candidate;
    }
  }
  const message = flattenChatContent((obj.message as any)?.content ?? obj.message);
  if (message) return message;
  return '';
}

function buildDemoTextResponse(message: string | undefined): { text: string; model: string; stub: true } {
  const lower = (message || '').toLowerCase();
  const wantsSave = /обнов|сохран|save_json/.test(lower);
  const lines = [
    'Ассистент (демо): работаю офлайн, поэтому отвечаю здесь без обращения к OpenAI.',
  ];
  if (wantsSave) {
    lines.push('Фиксирую изменения в профиле пользователя и сохраняю их.');
    lines.push(`SAVE_JSON: ${DEMO_SAVE_PATCH}`);
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
            const apiKey = OPENAI_API_KEY;

            if (!apiKey) {
              const demo = buildDemoTextResponse(message);
              res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(demo));
              return;
            }

            type AttemptMeta = {
              endpoint: 'responses' | 'chat.completions';
              status?: number;
              error?: string;
              textPreview?: string;
            };

            const attempts: AttemptMeta[] = [];

            const summarizeAttempt = (meta: AttemptMeta) => {
              attempts.push({
                endpoint: meta.endpoint,
                status: meta.status,
                textPreview: meta.textPreview,
                error: meta.error,
              });
            };

            const preferResponses = /gpt-4\.1|gpt-5|o4|4o|o3|mini/i.test(textModel);

            const callResponses = async () => {
              try {
                const resp = await fetch('https://api.openai.com/v1/responses', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: textModel,
                    input: [
                      { role: 'system', content: [{ type: 'text', text: sys }] },
                      { role: 'user', content: [{ type: 'text', text: user }] },
                    ],
                    temperature: 0.3,
                  }),
                });
                let json: any = null;
                try { json = await resp.json(); } catch {}
                const text = extractTextFromOpenAIResponse(json);
                const ok = !!(resp.ok && text && text.trim());
                summarizeAttempt({
                  endpoint: 'responses',
                  status: resp.status,
                  textPreview: text ? text.slice(0, 160) : undefined,
                  error: resp.ok ? (ok ? undefined : 'OpenAI вернул пустой ответ') : (json?.error?.message || `HTTP ${resp.status}`),
                });
                return { ok, text, json, model: typeof json?.model === 'string' ? json.model : textModel };
              } catch (err) {
                summarizeAttempt({
                  endpoint: 'responses',
                  error: err instanceof Error ? err.message : String(err),
                });
                return { ok: false as const };
              }
            };

            const callChatCompletions = async () => {
              try {
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
                let json: any = null;
                try { json = await resp.json(); } catch {}
                const text = extractTextFromOpenAIResponse(json);
                const ok = !!(resp.ok && text && text.trim());
                summarizeAttempt({
                  endpoint: 'chat.completions',
                  status: resp.status,
                  textPreview: text ? text.slice(0, 160) : undefined,
                  error: resp.ok ? (ok ? undefined : 'OpenAI вернул пустой ответ') : (json?.error?.message || `HTTP ${resp.status}`),
                });
                return { ok, text, json, model: typeof json?.model === 'string' ? json.model : textModel };
              } catch (err) {
                summarizeAttempt({
                  endpoint: 'chat.completions',
                  error: err instanceof Error ? err.message : String(err),
                });
                return { ok: false as const };
              }
            };

            const respondSuccess = (payload: { text: string; model: string; endpoint: AttemptMeta['endpoint']; raw?: unknown }) => {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ text: payload.text, model: payload.model, endpoint: payload.endpoint, raw: payload.raw }));
            };

            if (preferResponses) {
              const attempt = await callResponses();
              if (attempt.ok && attempt.text) {
                respondSuccess({ text: attempt.text, model: attempt.model ?? textModel, endpoint: 'responses', raw: attempt.json });
                return;
              }
            }

            const chatAttempt = await callChatCompletions();
            if (chatAttempt.ok && chatAttempt.text) {
              respondSuccess({ text: chatAttempt.text, model: chatAttempt.model ?? textModel, endpoint: 'chat.completions', raw: chatAttempt.json });
              return;
            }

            if (!preferResponses) {
              const attempt = await callResponses();
              if (attempt.ok && attempt.text) {
                respondSuccess({ text: attempt.text, model: attempt.model ?? textModel, endpoint: 'responses', raw: attempt.json });
                return;
              }
            }

            console.error('/api/openai/text: OpenAI не вернул ответ', { attempts });
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'OpenAI не вернул текстовый ответ', attempts }));
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
        // Ephemeral token endpoint for OpenAI Realtime
        server.middlewares.use('/api/openai/rt/token', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }
          const defaultModel = 'gpt-4o-realtime-preview';
          const chunks: Uint8Array[] = [];
          req.on('data', (c: Uint8Array) => chunks.push(c));
          await new Promise<void>((resolve) => req.on('end', () => resolve()));
          let reqModel = defaultModel;
          try {
            const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
            if (parsed?.model && typeof parsed.model === 'string') reqModel = parsed.model;
          } catch {}
          const respondDemo = () => {
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              client_secret: { value: 'demo-offline-token', expires_at: Date.now() + 60_000, demo: true },
              model: reqModel,
              demo: true,
            }));
          };
          try {
            const apiKey = OPENAI_API_KEY;
            if (!apiKey) {
              respondDemo();
              return;
            }
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
            if (!resp.ok) {
              respondDemo();
              return;
            }
            res.statusCode = resp.status; res.setHeader('Content-Type', 'application/json');
            const payload = json && typeof json === 'object' ? { ...json, model: reqModel } : { model: reqModel, raw: json };
            res.end(JSON.stringify(payload));
          } catch (e) {
            console.error('rt/token error', e);
            respondDemo();
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
