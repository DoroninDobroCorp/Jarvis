# Руководство по внесению изменений

Спасибо за интерес к проекту! Следуйте этим рекомендациям для качественного вклада.

## 🚀 Быстрый старт

1. **Форк и клонирование**
   ```bash
   git clone https://github.com/YOUR_USERNAME/detective-board.git
   cd detective-board
   ```

2. **Установка зависимостей**
   ```bash
   npm install
   ```

3. **Запуск dev сервера**
   ```bash
   npm run dev
   ```

4. **Запуск тестов**
   ```bash
   npm run test          # unit тесты
   npm run test:e2e      # E2E тесты
   npm run test:perf     # производительность
   ```

## 📝 Рабочий процесс

1. Создайте ветку от `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Делайте изменения с осмысленными коммитами:
   ```bash
   git commit -m "feat: добавлена новая функция X"
   ```

3. **Pre-commit hooks автоматически**:
   - Запустят ESLint (и попытаются исправить)
   - Запустят связанные unit тесты
   - Отформатируют код через Prettier

4. Пушьте и создавайте Pull Request:
   ```bash
   git push origin feature/your-feature-name
   ```

## 🧪 Тестирование

### Unit тесты
- Используем **Vitest**
- Покрывайте утилиты и критическую логику
- Запуск: `npm run test`
- С UI: `npm run test:ui`

### E2E тесты
- Используем **Playwright**
- Тестируем пользовательские сценарии
- Запуск: `npm run test:e2e` (headless)
- С браузером: `npm run test:e2e:headed`

### Производительность
- Проверяйте FPS при перетаскивании (должен быть > 55)
- Запуск: `npm run test:perf`

## 💻 Стандарты кода

### TypeScript
- Строгий режим включён
- Избегайте `any` — используйте конкретные типы
- Type guards для проверки типов в runtime

### React
- Функциональные компоненты + hooks
- `React.memo` для оптимизации
- `useMemo` / `useCallback` для тяжелых вычислений

### Производительность
- ❌ НЕ обновляйте store в hot paths (drag, resize)
- ✅ Используйте Set для проверок вместо Array.includes()
- ✅ Throttle для частых событий (16ms = 60 FPS)

### Логирование
```typescript
import { getLogger } from './logger';
const log = getLogger('componentName');

log.info('event:name', { data });
log.warn('issue:detected', { context });
log.error('operation:failed', { error });
```

### Именование коммитов
Используем [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — новая функция
- `fix:` — исправление бага
- `refactor:` — рефакторинг
- `perf:` — оптимизация производительности
- `test:` — добавление/изменение тестов
- `docs:` — изменения в документации
- `chore:` — рутинные задачи (deps update и т.д.)

## 🎯 Чеклист перед PR

- [ ] Код проходит `npm run lint` без ошибок
- [ ] Все тесты проходят (`npm run test` и `npm run test:e2e`)
- [ ] Добавлены unit тесты для новой логики
- [ ] Добавлены E2E тесты для новых UI фич
- [ ] Проверена производительность (FPS > 55)
- [ ] Обновлена документация (если нужно)
- [ ] Заполнен PR template

## 🐛 Сообщение об ошибках

Создавайте issue с:
- Описанием проблемы
- Шагами для воспроизведения
- Ожидаемым и фактическим поведением
- Скриншотами (если применимо)
- Версией браузера/Node.js

## 💡 Предложение фич

Создавайте issue с:
- Описанием фичи
- Вариантами использования
- Примерами (скриншоты/mockups)
- Влиянием на производительность

## 📚 Ресурсы

- [Memory Bank](./memory-bank/) — контекст проекта
- [Документация оптимизаций](./docs/OPTIMIZATION-SUMMARY.md)
- [Паттерны производительности](./docs/FAKE-SHADOWS.md)
- [Playwright тесты](./tests/)

## ❓ Вопросы

Если что-то непонятно — создавайте issue с вопросом!
