import React, { useEffect, useRef, useState } from 'react';
import { getLogger } from '../logger';
import { getBackupData } from '../exportImport';
import { getSnapshot } from '../wellbeing';

const SAVED_INFO_KEY = 'ASSISTANT_SAVED_INFO_V1';
const PROMPT_KEY = 'ASSISTANT_PROMPT_V1';
const TEXT_PROVIDER_KEY = 'ASSISTANT_TEXT_PROVIDER_V1';
const DEFAULT_PROMPT = `Ты — внимательный психолог-коуч и стратег задач.
Твоя базовая задача — помочь понять приоритеты и выбрать уместную следующую задачу, учитывая состояние пользователя. При этом будь всегда готов оказать психологическую поддержку: мягко отражай, помогай проживать эмоции и снижать напряжение.
Работай мягко, эмпатично, по шагам: выясни контекст, предложи варианты, помоги выбрать и зафиксировать конкретные шаги и первый микро-шаг на 5–10 минут.

Ориентиры:
- Учитывай данные самооценок (осознанность/эффективность/удовольствие) за сегодня и динамику.
- Учитывай связи задач (граф) и дедлайны.
- Помогай структурировать и приоритезировать, но не навязывай; при необходимости — поддержи эмоционально.

Ограничения действий модели:
- Ты МОЖЕШЬ изменять только «Сохранённую информацию» пользователя (профиль/контекст), НО НИЧЕГО БОЛЬШЕ.
- Если считаешь, что стоит обновить «Сохранённую информацию», выводи отдельной строкой команду:
  SAVE_JSON: { ...патч JSON... }
Где патч — частичный объект, который мы сольём с текущим профилем. Никаких других команд.

Формат ответа:
1) Короткая эмпатичная рефлексия (1–2 предложения).
2) Предложение 2–4 актуальных фокусов с кратким обоснованием.
3) Выбор вместе с пользователем (задай вопрос, но предложи default).
4) Пошаговый план (3–6 шагов) + первый микро-шаг на 5–10 минут.
5) Если уместно, SAVE_JSON с обновлённым профилем (мотивы/ценности/ограничения/условия среды и т.п.).`;

export const AssistantModal: React.FC<{ open: boolean; onClose: () => void } > = ({ open, onClose }) => {
  const log = getLogger('AssistantModal');
  const [tab, setTab] = useState<'prompt' | 'info' | 'chat'>('prompt');
  const [prompt, setPrompt] = useState<string>(() => {
    try { return localStorage.getItem(PROMPT_KEY) || DEFAULT_PROMPT; } catch { return DEFAULT_PROMPT; }
  });
  const defaultInfo = `{
  "about_me": "",
  "current_goals": [],
  "constraints": [],
  "environment": ""
}`;
  const [savedInfo, setSavedInfo] = useState<string>(() => {
    try { return localStorage.getItem(SAVED_INFO_KEY) || defaultInfo; } catch { return defaultInfo; }
  });
  const [status, setStatus] = useState<string>('Готов');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dcOpen, setDcOpen] = useState(false);
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [textProvider, setTextProvider] = useState<'google' | 'openai'>(() => {
    try {
      const stored = localStorage.getItem(TEXT_PROVIDER_KEY);
      return stored === 'openai' ? 'openai' : 'google';
    } catch {
      return 'google';
    }
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const assistantBufRef = useRef<string>('');
  const voiceRetriesRef = useRef<number>(0);
  const voiceStartTsRef = useRef<number>(0);

  useEffect(() => {
    try { localStorage.setItem(PROMPT_KEY, prompt); } catch {}
  }, [prompt]);
  useEffect(() => {
    try { localStorage.setItem(SAVED_INFO_KEY, savedInfo); } catch {}
  }, [savedInfo]);
  useEffect(() => {
    try { localStorage.setItem(TEXT_PROVIDER_KEY, textProvider); } catch {}
  }, [textProvider]);

  useEffect(() => {
    if (!open) return;
    // lazy create audio element
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.autoplay = true;
      audioRef.current.controls = false;
    }
  }, [open]);

  function applySaveJsonPatchLine(line: string) {
    try {
      const idx = line.indexOf('SAVE_JSON:');
      if (idx >= 0) {
        const jsonStr = line.slice(idx + 'SAVE_JSON:'.length).trim();
        const patch = JSON.parse(jsonStr);
        const curr = JSON.parse(savedInfo || '{}');
        const next = { ...curr, ...patch };
        setSavedInfo(JSON.stringify(next, null, 2));
        setStatus('Применён SAVE_JSON от модели');
      }
    } catch (e) {
      log.warn('bad SAVE_JSON', { err: String(e) });
    }
  }

  async function sendContext(dc: RTCDataChannel) {
    try {
      const backup = await getBackupData();
      const wb = getSnapshot();
      const payload = {
        type: 'input_text',
        text: `КОНТЕКСТ\nПрофиль (Сохранённая информация):\n${savedInfo}\n\nСамооценки (сводка): ${JSON.stringify(wb)}\n\nЗадачи и связи (backup JSON):\n${JSON.stringify(backup)}`,
      } as const;
      dc.send(JSON.stringify(payload));
    } catch (e) {
      log.error('sendContext failed', e);
    }
  }

  async function connect() {
    try {
      setConnecting(true);
      setStatus('Создание соединения...');
      // Text mode: no WebRTC, enable chat immediately
      if (mode === 'text') {
        setConnected(true);
        setDcOpen(false);
        const providerLabel = textProvider === 'google' ? 'Google' : 'OpenAI';
        setStatus(`Текстовый чат (${providerLabel}) готов`);
        return;
      }
      voiceRetriesRef.current = 0;
      voiceStartTsRef.current = Date.now();
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;

      // outbound mic (only for voice mode)
      if (mode === 'voice') {
        try {
          const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const track of ms.getTracks()) pc.addTrack(track, ms);
        } catch (e) {
          log.warn('mic:not-available, continue recvonly', { err: String(e) });
          setStatus('Микрофон недоступен — продолжаю в режиме приёма аудио');
        }
        // Mark as connected early to avoid instant UI flip
        setConnected(true);
      }

      // ensure we also receive audio from the model
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}

      // inbound audio
      pc.ontrack = (ev) => {
        const [stream] = ev.streams;
        if (audioRef.current) audioRef.current.srcObject = stream;
      };

      const dc = pc.createDataChannel('oai-events');
      dataRef.current = dc;
      dc.onopen = () => {
        setDcOpen(true);
        setConnected(true);
        setStatus('Канал данных открыт');
        // Send instructions and context
        const sessionUpdate = { type: 'session.update', session: { instructions: prompt } };
        dc.send(JSON.stringify(sessionUpdate));
        void sendContext(dc);
        if (mode === 'voice') {
          const speak = { type: 'response.create', response: { modalities: ['text','audio'], instructions: 'Начнём: коротко спроси контекст и предложи фокус.' } };
          dc.send(JSON.stringify(speak));
        }
      };
      dc.onclose = () => {
        setDcOpen(false);
        setConnected(false);
        setStatus('Канал данных закрыт');
      };
      dc.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (typeof data === 'object' && data?.type) {
            try { console.log('[assistant][evt]', data.type); } catch {}
            if (data.type === 'response.delta' && typeof data.delta === 'string') {
              const s = String(data.delta);
              assistantBufRef.current += s;
              applySaveJsonPatchLine(s);
            } else if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
              const s = String(data.delta);
              assistantBufRef.current += s;
              applySaveJsonPatchLine(s);
            } else if (data.type === 'response.completed') {
              const text = assistantBufRef.current.trim();
              if (text) setMessages((arr) => [...arr, { role: 'assistant', text }]);
              assistantBufRef.current = '';
            } else if (data.type === 'error' || data.type === 'response.error') {
              try { console.error('[assistant][evt:error]', data); } catch {}
            }
          } else if (typeof msg.data === 'string') {
            applySaveJsonPatchLine(msg.data);
          }
        } catch {
          if (typeof msg.data === 'string') applySaveJsonPatchLine(msg.data);
        }
      };

      const tokenResp = await fetch('/api/openai/rt/token', { method: 'POST' });
      if (!tokenResp.ok) throw new Error('Не удалось получить эфемерный токен');
      const { client_secret, model } = await tokenResp.json();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete for a better chance of successful connection
      setStatus('Сбор ICE-кандидатов...');
      await new Promise<void>((resolve) => {
        if (!pc) { resolve(); return; }
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const timeout = setTimeout(() => resolve(), 2000);
        const check = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', check);
      });

      const realtimeUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
      const sdpResp = await fetch(realtimeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${client_secret.value}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: (pc.localDescription?.sdp || offer.sdp || ''),
      });
      const answer = { type: 'answer', sdp: await sdpResp.text() };
      await pc.setRemoteDescription(answer as any);

      setStatus('Ожидание открытия канала данных...');

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') {
          setStatus('ICE подключено — ждём открытие канала данных...');
        } else if (st === 'failed') {
          setStatus('ICE-соединение не установлено');
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          setStatus('Подключено');
        }
        if (st === 'disconnected' || st === 'failed') {
          const elapsed = Date.now() - voiceStartTsRef.current;
          const doDisconnect = () => { setConnected(false); setStatus('Отключено'); };
          if (elapsed < 3000) {
            setTimeout(doDisconnect, 3000 - elapsed);
          } else {
            doDisconnect();
          }
          // Simple retry (max 2)
          if (voiceRetriesRef.current < 2 && mode === 'voice') {
            voiceRetriesRef.current += 1;
            setTimeout(() => { void connect(); }, 1000);
          }
        }
        if (st === 'closed') {
          setConnected(false);
          setStatus('Отключено');
        }
      };
    } catch (e) {
      console.error(e);
      setStatus('Ошибка подключения: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      const pc = pcRef.current;
      if (pc) {
        pc.getSenders().forEach((s) => { try { s.track?.stop(); } catch {} });
        pc.close();
      }
    } finally {
      pcRef.current = null;
      dataRef.current = null;
      setDcOpen(false);
      setConnected(false);
      setStatus('Отключено');
    }
  }

  useEffect(() => {
    if (mode !== 'text' || !connected) return;
    const providerLabel = textProvider === 'google' ? 'Google' : 'OpenAI';
    setStatus(`Текстовый чат (${providerLabel}) готов`);
  }, [textProvider, mode, connected]);

  async function sendUserText() {
    try {
      const dc = dataRef.current;
      const text = inputText.trim();
      if (!text) return;
      setMessages((arr) => [...arr, { role: 'user', text }]);
      setInputText('');
      if (mode === 'text') {
        // Fallback: call dev-only text endpoint
        const providerLabel = textProvider === 'google' ? 'Google' : 'OpenAI';
        setStatus(`Отправка запроса (${providerLabel})...`);
        const backup = await getBackupData();
        const wb = getSnapshot();
        const context = `Профиль (Сохранённая информация):\n${savedInfo}\n\nСамооценки (сводка): ${JSON.stringify(wb)}\n\nЗадачи и связи (backup JSON):\n${JSON.stringify(backup)}`;

        const doRequest = async (endpoint: string, label: string) => {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, instructions: prompt, context }),
          });
          const json = await resp.json();
          if (!resp.ok) {
            const errMsg = typeof (json as any)?.error === 'string' ? (json as any).error : 'request_failed';
            throw new Error(errMsg);
          }
          const reply = (json as any)?.text as string || '';
          const usedModel = (json as any)?.model as string || 'unknown';
          if (reply) setMessages((arr) => [...arr, { role: 'assistant', text: reply }]);
          setStatus(reply ? `Ответ получен (${label}${usedModel ? `: ${usedModel}` : ''})` : 'Пустой ответ');
          if (reply) reply.split('\n').forEach((line) => applySaveJsonPatchLine(line));
        };

        try {
          const endpoint = textProvider === 'google' ? '/api/google/text' : '/api/openai/text';
          await doRequest(endpoint, providerLabel);
        } catch (e) {
          console.error(e);
          if (textProvider === 'google') {
            // Auto-switch to OpenAI and retry once
            setStatus('Ошибка запроса к Google API — переключаюсь на OpenAI и повторяю...');
            try { setTextProvider('openai'); } catch {}
            try {
              await doRequest('/api/openai/text', 'OpenAI');
            } catch (e2) {
              console.error(e2);
              setStatus('Ошибка текстового запроса');
            }
          } else {
            setStatus('Ошибка текстового запроса');
          }
        }
        return;
      }
      // Voice (WebRTC) mode
      if (!dc || dc.readyState !== 'open') {
        setStatus('Канал данных не готов — подождите, идёт подключение...');
        return;
      }
      const inputEvt = { type: 'input_text', text } as const;
      dc.send(JSON.stringify(inputEvt));
      const respEvt = {
        type: 'response.create',
        response: {
          modalities: ['text','audio'],
          instructions: 'Пожалуйста, ответь кратко по-русски на текст пользователя, принимая во внимание ранее отправленный контекст.'
        }
      } as const;
      dc.send(JSON.stringify(respEvt));
    } catch (e) {
      console.error(e);
    }
  }

  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div data-testid="assistant-modal" style={{ width: 'min(900px, 92vw)', height: 'min(620px, 88vh)', background: '#111', color: '#fff', borderRadius: 12, border: '1px solid #333', boxShadow: '0 12px 48px rgba(0,0,0,0.6)', display: 'grid', gridTemplateRows: 'auto auto auto 1fr auto', overflow: 'hidden' }}>
        <div style={{ fontSize: 56, textAlign: 'center', padding: '8px 0' }}>🤖</div>
        <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #333' }}>
          <button className={tab==='prompt'?'tool-btn active':'tool-btn'} onClick={() => setTab('prompt')}>Промпт</button>
          <button className={tab==='info'?'tool-btn active':'tool-btn'} onClick={() => setTab('info')}>Сохранённая информация</button>
          <button className={tab==='chat'?'tool-btn active':'tool-btn'} onClick={() => setTab('chat')}>Диалог</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>Режим</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'voice' | 'text')}>
                <option value="voice">Голос</option>
                <option value="text">Текст</option>
              </select>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>Провайдер</span>
              <select
                value={textProvider}
                onChange={(e) => setTextProvider(e.target.value as 'google' | 'openai')}
                disabled={mode !== 'text'}
              >
                <option value="google">Google</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            {!connected ? (
              <button className="tool-btn" onClick={() => void connect()} disabled={connecting}>{mode==='voice'?'Подключить микрофон':'Подключиться'}</button>
            ) : (
              <button className="tool-btn" onClick={() => void disconnect()}>Отключить</button>
            )}
            <button className="tool-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
        {/* Transcript always visible (duplicates voice content as text) */}
        <div data-testid="assistant-transcript" style={{ padding: 8, borderBottom: '1px solid #333', maxHeight: 160, overflow: 'auto', background: '#0f0f0f' }}>
          {messages.length === 0 ? (
            <div style={{ color: '#888', fontSize: 12 }}>Здесь появится транскрипт ответов ассистента и ваши сообщения.</div>
          ) : (
            messages.map((m, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: m.role==='assistant' ? '#e8e6e3' : '#a7c9b8' }}>
                <strong>{m.role === 'assistant' ? 'Ассистент' : 'Вы'}:</strong> {m.text}
              </div>
            ))
          )}
        </div>
        <div style={{ padding: 8, overflow: 'auto' }}>
          {tab === 'prompt' ? (
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} style={{ width: '100%', height: '100%', minHeight: 300, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 8, padding: 8 }} />
          ) : (
            tab === 'info' ? (
              <textarea value={savedInfo} onChange={(e) => setSavedInfo(e.target.value)} style={{ width: '100%', height: '100%', minHeight: 300, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 8, padding: 8 }} />
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#aaa' }}>Режим: {mode==='voice'?'голос (ответы дублируются текстом)':'текстовый чат'}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input data-testid="assistant-input"
                    disabled={mode==='voice' ? !dcOpen : !connected}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserText(); } }}
                    placeholder={mode==='voice' ? (dcOpen ? 'Голос активен — чтобы написать, переключите режим на Текст' : 'Подключение... дождитесь открытия канала') : (connected ? 'Напишите сообщение...' : 'Подключитесь, чтобы писать')}
                    style={{ flex: 1, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 8, padding: '8px 10px' }}
                  />
                  <button disabled={!connected || !inputText.trim()} className="tool-btn" onClick={sendUserText}>Отправить</button>
                </div>
              </div>
            )
          )}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span data-testid="assistant-status" style={{ fontSize: 12, color: '#aaa' }}>{status}</span>
          <div style={{ marginLeft: 'auto' }}>
            <audio ref={audioRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssistantModal;
