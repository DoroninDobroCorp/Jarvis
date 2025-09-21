import React, { useEffect, useRef, useState } from 'react';
import { getLogger } from '../logger';
import { getBackupData } from '../exportImport';
import { getSnapshot } from '../wellbeing';

const SAVED_INFO_KEY = 'ASSISTANT_SAVED_INFO_V1';
const PROMPT_KEY = 'ASSISTANT_PROMPT_V1';
const TEXT_PROVIDER_KEY = 'ASSISTANT_TEXT_PROVIDER_V1';
const DEFAULT_PROMPT = `Ты — внимательный психолог-коуч и стратег задач.
Твоя базовая задача — помочь понять приоритеты и выбрать уместную следующую задачу, учитывая состояние пользователя. При этом будь всегда готов оказать психологическую поддержку: мягко отражай, помогай проживать эмоции и снижать напряжение.

Ограничения действий модели:
- Ты МОЖЕШЬ изменять только «Сохранённую информацию» пользователя (профиль/контекст), НО НИЧЕГО БОЛЬШЕ.
- Если считаешь, что стоит обновить «Сохранённую информацию», выводи отдельной строкой команду:
  SAVE_JSON: { ...патч JSON... }`;

export const AssistantModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  // ... (остальной код компонента без изменений)

  async function sendUserText() {
    try {
      const dc = dataRef.current;
      const text = inputText.trim();
      if (!text) return;
      setMessages((arr) => [...arr, { role: 'user', text }]);
      setInputText('');
      
      if (mode === 'text') {
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
          
          let json: any = null;
          try { json = await resp.json(); } catch {}
          
          if (!resp.ok) {
            const errMsg = json?.error || json?.message || `HTTP ${resp.status}`;
            throw new Error(errMsg);
          }
          
          const reply = json?.text || '';
          const usedModel = json?.model || 'unknown';
          
          if (reply) setMessages((arr) => [...arr, { role: 'assistant', text: reply }]);
          setStatus(reply ? `Ответ получен (${label}${usedModel ? `: ${usedModel}` : ''})` : 'Пустой ответ');
          
          // Обработка SAVE_JSON
          if (reply) reply.split('\n').forEach((line) => applySaveJsonPatchLine(line));
        };

        try {
          const endpoint = textProvider === 'google' ? '/api/google/text' : '/api/openai/text';
          await doRequest(endpoint, providerLabel);
        } catch (e) {
          console.error(e);
          if (textProvider === 'google') {
            // Авто-фоллбек на OpenAI
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

      // ... (остальной код метода)
    } catch (e) {
      console.error(e);
    }
  }

  // ... (остальной код компонента)
};

export default AssistantModal;
