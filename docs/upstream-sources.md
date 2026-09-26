# Источники функциональности

Проверены 25 сентября 2026. Использованы описания возможностей, определения и формулы. Код, UI assets и тексты документации сторонних проектов не копировались; инструменты не добавлены как зависимости. Ниже зафиксированы просмотренные версии, а не плавающие ссылки main.

| Источник | Версия | Что адаптировано в LLM Burner |
| --- | --- | --- |
| [NVIDIA AIPerf](https://github.com/ai-dynamo/aiperf/tree/62510dc2b2d86a2d7a07be1a4eacdefb03369f89) | `62510dc2b2d86a2d7a07be1a4eacdefb03369f89`, Apache-2.0 | Расширенные streaming/usage метрики, warmup, load profiles, goodput/SLO, continuous usage correction |
| [GuideLLM](https://github.com/vllm-project/guidellm/tree/7f06bd31e919e9a052df554eaac053aff1557697) | `7f06bd31e919e9a052df554eaac053aff1557697`, Apache-2.0 | Сравнение latency и throughput при разных профилях нагрузки, последовательные ступени |
| [EvalScope](https://github.com/modelscope/evalscope/blob/06b4c67bc37d5482bdcca8b7a3dee335b9e6b5a7/docs/en/user_guides/stress_test/quick_start.md) | `06b4c67bc37d5482bdcca8b7a3dee335b9e6b5a7`, Apache-2.0 | Наборы prompts, серии concurrency, подробные результаты и распределения |
| [llm-api-bench](https://github.com/idemerge/llm-api-bench/tree/c83e2d796796e06e929b922614ad0cd9c39a3be0) | `c83e2d796796e06e929b922614ad0cd9c39a3be0`, MIT | Идея самостоятельного web benchmark, истории и сравнения |

## AIPerf → наши компоненты

- [Metrics reference](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/metrics-reference.md): `transport.mjs` собирает TTFT, TTFO, TTST, decode duration, ICL; `metrics.mjs` агрегирует распределения, throughput, usage и goodput. TPOT/decode TPS — оценки, provenance хранится явно. Время между чанками не выдаётся за точные token timestamps.
- [Goodput](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/goodput.md): пользовательские ограничения TTFT/latency/TPOT; отдельно pass/fail/unknown.
- [Warmup](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/warmup.md): отдельная фаза перед каждой ступенью, не входит в измеряемое время/метрики/оценку стоимости.
- [Request rate and concurrency](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/request-rate-concurrency.md) и [arrival patterns](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/arrival-patterns.md): concurrency либо bounded RPS scheduler с constant/Poisson интервалами, детерминированный seed и schedule lag.
- [Ramping](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/ramping.md) и [sweeps](https://github.com/ai-dynamo/aiperf/blob/62510dc2b2d86a2d7a07be1a4eacdefb03369f89/docs/tutorials/sweeps.md): локальный разгон лимита параллельности и последовательные concurrency-ступени, а не все режимы/поисковые алгоритмы AIPerf.

## Наши отличия и границы

- Одна локальная Node.js process, один активный тест. Максимум 128 одновременных запросов. Это не распределённый нагрузочный генератор.
- Только текстовый SSE Chat Completions. Нет GPU/DCGM/Prometheus, изображений/аудио/видео, trace replay, multi-turn agents, серверного профилирования DNS/TLS/TTFB и автоматического поиска SLO-предела.
- Источник токенов — только provider usage; нет tokenizer и обещания точной synthetic input/output длины. Максимум output — лимит, не гарантия фактической длины.
- TPOT использует интервал первого/последнего генерирующего чанка; trailing usage исключён. Continuous usage по умолчанию выключен. Клиентский overhead не вычитается.
- ICL-перцентили строятся по средним ICL запросов; не по объединённым интервалам всех чанков. Ошибки и прогрев не входят в распределения.
- Reasoning/cache/accepted/rejected prediction usage показываются только при сообщении сервером. Prediction tokens нельзя считать draft acceptance или speculative decode steps.
- Good request fraction включает ошибки/отмены в знаменатель. Goodput с неизвестными необходимыми метриками не включает такой запрос. Определения и выборка явно описаны в README; совпадение чисел с другим benchmark без согласования методики не гарантируется.
- Уникальный префикс меняет user prompt, не отключает системный prefix cache сервера. Стоимость относится только к успешным измеряемым запросам и заданным вручную ценам USD.

Переключаемые простой/расширенный UI, локальная SQLite-история, защищённый экспорт конфигурации и сравнение 2–4 запусков реализованы непосредственно в приложении.
