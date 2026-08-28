# Loyalty Swift / CalcCardash — public Telegram OCR backend

Этот проект сохраняет оригинальный интерфейс CalcCardash и получает курсы из публичного Telegram web preview без Bot API и без Telegram-аккаунта.

## Важное исправление v2.1

Предыдущая версия запускала 10 OCR-процессов подряд. На Render это могло приводить к `OCR timeout` даже при нормально работающем Tesseract.

Текущая версия делает один быстрый OCR по всей карточке и второй rescue-проход только если обязательные курсы не распознаны. На тестовой карточке 957x1280 основной Tesseract-проход занимает менее секунды в локальном окружении.

## Render

Environment variable:

```text
TELEGRAM_CHANNEL=LoyaltySwift
```

Endpoints:

- `GET /` — оригинальный CalcCardash UI
- `GET /health` — состояние сервиса
- `GET /api/rates` — курсы
- `POST /api/update` — принудительно обновить
- `GET /api/debug` — OCR/debug information

## Telegram

Используется:

```text
https://t.me/s/<channel>
```

Без Bot API, токена, номера телефона и Telegram-сессии.

## Параметры timeout

По умолчанию серверный общий timeout OCR — 45 секунд. Изображение OCR запускается с timeout 20 секунд на отдельный проход.

Можно изменить:

```text
REQUEST_TIMEOUT_MS=60000
UPDATE_INTERVAL_MS=300000
```

## Почему OCR по одной картинке

Карточка имеет стабильную верстку. OCR всего изображения хорошо сохраняет порядок строк, после чего `rates.js` назначает значения полям USD/JPY/CNY/KRW/THB/AED. Это значительно быстрее, чем запускать Tesseract десять раз последовательно.
