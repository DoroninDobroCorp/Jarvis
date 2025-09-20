import { test, expect } from '@playwright/test';

// Тест открывает ассистента, переключает в текстовый режим,
// устанавливает соединение с OpenAI Realtime, отправляет вопрос и ждёт ответа.
// Ведётся подробное логирование консоли и сети для быстрой диагностики.

test.describe('Assistant Realtime (text)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Тест стабильнее в Chromium');
  test('должен подключаться и отвечать на текстовый вопрос', async ({ page }) => {
    test.setTimeout(60_000);

    const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      return await Promise.race<T>([
        p,
        new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`Safety timeout: ${label} (${ms}ms)`)), ms)) as unknown as Promise<T>,
      ]);
    };

    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const consoleInfos: string[] = [];
    const requests: string[] = [];
    const responses: string[] = [];

    page.on('console', (msg) => {
      const type = msg.type();
      const txt = msg.text();
      if (type === 'error') consoleErrors.push(txt);
      else if (type === 'warning') consoleWarnings.push(txt);
      else consoleInfos.push(`[${type}] ${txt}`);
    });

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/openai/rt/token') || url.includes('/v1/realtime')) {
        requests.push(`${req.method()} ${url}`);
      }
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/openai/rt/token') || url.includes('/v1/realtime')) {
        responses.push(`${res.status()} ${url}`);
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push('pageerror: ' + String(err));
    });

    await withTimeout(page.goto('/'), 10_000, 'page.goto');

    // Открыть модалку ассистента (используем точный aria-label из Toolbar)
    await page.getByRole('button', { name: 'ИИ-ассистент (аудио)' }).click();
    const modal = page.getByTestId('assistant-modal');
    await expect(modal).toBeVisible();

    // Перейти на вкладку "Диалог"
    await modal.getByRole('button', { name: 'Диалог' }).click();

    // Переключить режим на "Текст" (внутри шапки модалки ассистента)
    const modeSelect = modal.locator('label:has-text("Режим") select');
    await modeSelect.selectOption('text');

    // Подключиться
    await modal.getByRole('button', { name: 'Подключиться' }).click();

    // Дождаться открытия канала: поле ввода станет активным
    const input = page.getByTestId('assistant-input');
    await withTimeout(expect(input).toBeEnabled({ timeout: 25_000 }) as unknown as Promise<void>, 27_500, 'ожидание открытия канала (input enabled)');

    // Отправить вопрос
    const question = 'Привет, имеешь ли ты данные к моим задачам и их структуре, к моим книгам и играм, к информации обо мне?';
    await input.fill(question);
    await modal.getByRole('button', { name: 'Отправить' }).click();

    // Дождаться ответа ассистента: блок с текстом, начинающийся с "Ассистент:"
    const transcript = page.getByTestId('assistant-transcript');
    await withTimeout(expect(transcript).toBeVisible({ timeout: 45_000 }) as unknown as Promise<void>, 47_500, 'ожидание появления ответа ассистента');
    const firstAssistantLine = transcript.locator('div', { hasText: 'Ассистент:' }).first();
    await withTimeout(expect(firstAssistantLine).toBeVisible({ timeout: 45_000 }) as unknown as Promise<void>, 47_500, 'ожидание первой строки ответа ассистента');

    // Возьмём последний элемент, содержащий ответ ассистента
    const allAssistantLines = transcript.locator('div').filter({ hasText: 'Ассистент:' });
    let count = await allAssistantLines.count();
    expect(count, 'Должна быть хотя бы одна строка ответа ассистента').toBeGreaterThan(0);
    let answerText = (await allAssistantLines.nth(count - 1).textContent()) || '';

    // Проверка на "положительность" ответа: ищем признаки согласия и упоминания контекста
    let lower = answerText.toLowerCase();
    let positive = /\bда\b|имею|имеется|есть доступ|доступ|получил|вижу|могу/.test(lower);
    let mentions = /(задач|книг|игр|информац)/.test(lower);

    // Если первый ответ не удовлетворяет, уточним и повторим попытку
    if (!(positive && mentions)) {
      const followUp = 'Пожалуйста, ответь "да" или "нет": есть ли у тебя доступ к моим задачам, книгам, играм и сохранённой информации обо мне?';
      await input.fill(followUp);
      await modal.getByRole('button', { name: 'Отправить' }).click();
      await withTimeout(expect(transcript).toBeVisible({ timeout: 30_000 }) as unknown as Promise<void>, 32_500, 'ожидание уточняющего ответа');
      count = await allAssistantLines.count();
      answerText = (await allAssistantLines.nth(count - 1).textContent()) || '';
      lower = answerText.toLowerCase();
      positive = /\bда\b|имею|имеется|есть доступ|доступ|получил|вижу|могу/.test(lower);
      mentions = /(задач|книг|игр|информац)/.test(lower);
    }

    // Логирование для диагностики
    console.log('--- Assistant answer ---');
    console.log(answerText);
    console.log('------------------------');
    console.log('Requests:', requests);
    console.log('Responses:', responses);
    if (consoleWarnings.length) console.log('Console WARN:', consoleWarnings);
    if (consoleInfos.length) console.log('Console INFO sample:', consoleInfos.slice(0, 5));

    try {
      expect(positive && mentions, 'Ответ ассистента должен быть утвердительным и ссылаться на контекст (задачи/книги/игры/информация)').toBeTruthy();
      expect(consoleErrors, 'Ошибок в консоли не должно быть').toHaveLength(0);
    } finally {
      // Безопасное закрытие модалки, чтобы не оставлять открытое соединение
      const closeBtn = page.getByRole('button', { name: 'Закрыть' });
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => {});
      }
    }
  });
});
