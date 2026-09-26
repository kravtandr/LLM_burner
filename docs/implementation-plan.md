# План реализации

Цель: рабочее локальное приложение по docs/design.md.

- [x] 1. Метрики, валидация и SSE transport: node:test для split UTF-8/frames, отсутствующего usage, ошибок и таймингов; реализация server/config.mjs, metrics.mjs, transport.mjs.
- [x] 2. Движок и SQLite: bounded worker pool, cancellation, recovery, API без секретов; интеграционные node:test с локальным HTTP provider; server/runner.mjs, store.mjs, app.mjs, index.mjs.
- [x] 3. Интерфейс: настройки, живые метрики, график, таблица запросов, persistent history, экспорт и повторы; src/App.jsx, components.jsx, styles.css.
- [x] 4. Проверка: сборка, полный backend suite, Playwright browser workflow и screenshots desktop/mobile; README с запуском и формулами.

Критические случаи: fractional/oversized input; API без usage; truncated stream; остановка и перезапуск процесса; секреты в persistence/export/errors. Проверки принадлежат transport, runner/store и API тестам соответственно.
