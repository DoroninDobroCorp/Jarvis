import { test, expect } from '@playwright/test';

// Тест проверяет применение SAVE_JSON через текстовый режим.
// Использует тестовый триггер [TEST_SAVE_JSON], который возвращает детерминированный ответ.

test.describe('Assistant SAVE_JSON (text mode)', () => {
  test('обновляет сохранённую информацию через SAVE_JSON', async ({ page }) => {
    test.setTimeout(60_000);

    const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      return await Promise.race<T>([
        p,
        new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`Safety timeout: ${label} (${ms}ms)`)), ms)) as unknown as Promise<T>,
      ]);
    };

    await withTimeout(page.goto('/'), 10_000, 'page.goto');

    // Открыть ассистента
    await page.getByRole('button', { name: 'ИИ-ассистент (аудио)' }).click();
    const modal = page.getByTestId('assistant-modal');
    await expect(modal).toBeVisible();

    // Диалог -> Текст -> Подключиться
    await modal.getByRole('button', { name: 'Диалог' }).click();
    const modeSelect = modal.locator('label:has-text("Режим") select');
    await modeSelect.selectOption('text');
    await modal.getByRole('button', { name: 'Подключиться' }).click();

    const input = page.getByTestId('assistant-input');
    await withTimeout(expect(input).toBeEnabled({ timeout: 20_000 }) as unknown as Promise<void>, 22_000, 'ожидание активного ввода');

    // Отправить тестовый запрос, вызывающий SAVE_JSON
    const cmd = '[TEST_SAVE_JSON] Обнови профиль';
    await input.fill(cmd);
    await modal.getByRole('button', { name: 'Отправить' }).click();

    // Перейти на вкладку «Сохранённая информация»
    await modal.getByRole('button', { name: 'Сохранённая информация' }).click();
    const infoTextarea = page.locator('textarea');
    const infoStr = await withTimeout(infoTextarea.inputValue(), 15_000, 'чтение сохранённой информации');

    let json: any;
    try {
      json = JSON.parse(infoStr || '{}');
    } catch (e) {
      throw new Error('Сохранённая информация не является валидным JSON');
    }

    expect(typeof json).toBe('object');
    expect(String(json.about_me || '')).toContain('Родился в Грозном');
    expect(String(json.about_me || '')).toContain('Гражданство России');
    expect(String(json.environment || '')).toContain('Черногория');
    expect(String(json.environment || '')).toContain('город Бар');
  });
});
