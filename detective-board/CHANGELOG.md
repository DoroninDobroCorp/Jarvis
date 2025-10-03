# Changelog

Все важные изменения проекта detective-board документируются в этом файле.

## [Unreleased] - 2025-10-03

### Added
- 🎯 **Memory Bank система** для отслеживания контекста проекта
- 🧪 **Vitest** для unit тестирования
- 🧪 Unit тесты для утилит (throttle, raf-batch, coverUtils)
- 🔧 **Husky + lint-staged** для pre-commit hooks
- 🚀 **GitHub Actions CI/CD** (lint, test, build, e2e, deploy)
- 📝 Pull Request template
- 🎨 **Prettier** конфигурация
- 📦 `src/global.d.ts` для типизации window объектов
- 📦 `src/utils/coverUtils.ts` для работы с coverUrl

### Changed
- 📁 Переорганизована документация: `.md` файлы перемещены в `docs/`
- 🔄 Заменён `uuid` на нативный `crypto.randomUUID()`
- 📝 Улучшена типизация window объектов через global.d.ts
- 🧹 Рефакторинг дублирования логики проверки coverUrl

### Fixed
- 🐛 `console.error` в `raf-batch.ts` заменён на централизованный logger

### Removed
- 🗑️ Зависимость `uuid` (13.0.0) — используется нативный API

### Performance
- ⚡ Существующие оптимизации сохранены: 58-60 FPS при drag

## [Previous] - До 2025-10-03

### Performance Optimizations
- React.memo для NodeShape
- Set вместо Array для selection
- Прямое управление Konva refs
- Throttle для viewport updates (16ms = 60 FPS)
- Кэширование проекций связей
- History snapshot 1 раз при dragStart
- Фейковые тени вместо shadowBlur
- perfectDrawEnabled={false}
- Адаптивные режимы производительности

### Features
- Создание узлов (задачи, группы, персоны)
- Визуальные связи между узлами
- Иерархическая навигация
- AI-ассистент (голосовой и текстовый)
- Геймификация
- Offline-first (IndexedDB)
