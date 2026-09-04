# 5. Инструкция по развёртыванию (Self-Hosted)

## 5.1. Требования

- Сервер Linux (x86_64/arm64), 2 vCPU, 2 ГБ RAM, 10 ГБ диска (рекомендуется SSD).
- Docker 24+ и Docker Compose v2 (**рекомендуемый способ**) — либо Node.js 22+ и PostgreSQL 14+ для установки без Docker.
- Доменное имя и TLS (обязательно для PWA/установки на телефон: Service Worker работает только по HTTPS или на `localhost`).

## 5.2. Быстрый старт (Docker Compose)

```bash
git clone <репозиторий> fsm && cd fsm
cp .env.example .env
# отредактируйте .env: задайте POSTGRES_PASSWORD, AUTH_SECRET (длинная случайная строка), SEED_PASSWORD
openssl rand -hex 32    # пример генерации AUTH_SECRET
docker compose up -d --build
docker compose logs -f app   # дождаться ">> Запуск приложения"
```

Откройте `http://<сервер>:3000`. При первом открытии страницы входа на **пустой** БД автоматически загружаются демо-данные (пользователи, бригады, номенклатура, заявки). Пароль всех демо-пользователей — значение `SEED_PASSWORD` (по умолчанию `password`).

| Пользователь | Роль |
|---|---|
| admin@fsm.local | Администратор |
| dispatcher@fsm.local | Диспетчер |
| tech1..tech4@fsm.local | Монтажники (бригады №1 и №2) |
| warehouse@fsm.local | Склад |
| client@fsm.local | Клиент |

> Для продуктивной установки после первого входа создайте реальных пользователей и заблокируйте демо-учётки (Сотрудники → «заблокировать»). Либо перед первым запуском отключите сид: не открывайте `/login` до создания администратора через `psql` (см. 5.7).

## 5.3. Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | да | `postgresql://user:pass@host:5432/db` |
| `AUTH_SECRET` | да | секрет подписи JWT (≥32 случайных байт) |
| `SEED_PASSWORD` | нет | пароль демо-пользователей при сид-загрузке |
| `COOKIE_SECURE` | нет | `false`, если приложение отдаётся по HTTP (только для тестов) |
| `PORT` | нет | порт приложения (по умолчанию 3000) |
| `POSTGRES_PASSWORD`, `APP_PORT` | compose | пароль БД и внешний порт |

## 5.4. Что делает контейнер при старте

`docker-entrypoint.sh`: ждёт БД → применяет схему `drizzle-kit push` (идемпотентно) → `next start`. Схема БД всегда соответствует коду запущенной версии.

## 5.5. HTTPS / обратный прокси

Пример для Caddy (автоматический TLS):
```
fsm.company.ru {
    reverse_proxy 127.0.0.1:3000
}
```
Пример для nginx:
```
server {
  listen 443 ssl http2; server_name fsm.company.ru;
  ssl_certificate /etc/letsencrypt/live/fsm.company.ru/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fsm.company.ru/privkey.pem;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }
}
```
После включения HTTPS установите `COOKIE_SECURE=true`.

## 5.6. Обновление версии

```bash
git pull
docker compose up -d --build     # схема применится автоматически при старте
```
Для контролируемых миграций в проде: `npm run db:generate` (создаёт SQL в `./drizzle`), проверка SQL, затем `npm run db:migrate`.

## 5.7. Резервное копирование и восстановление

Сервис `backup` в compose ежесуточно кладёт дамп в `./backups/fsm-ГГГГ-ММ-ДД.sql.gz`.
Ручной дамп / восстановление:
```bash
docker compose exec db pg_dump -U fsm fsm | gzip > backup.sql.gz
gunzip -c backup.sql.gz | docker compose exec -T db psql -U fsm fsm
```
Создание администратора вручную (без сида):
```bash
HASH=$(docker compose exec app node -e "require('bcryptjs').hash('StrongPass1',10).then(console.log)")
docker compose exec db psql -U fsm fsm -c "insert into users(email,password_hash,full_name,role) values('admin@company.ru','$HASH','Администратор','admin')"
```

## 5.8. Установка без Docker

```bash
# PostgreSQL: создать БД и пользователя
sudo -u postgres psql -c "create user fsm password 'secret'; create database fsm owner fsm;"
# приложение
npm ci
cp .env.example .env && nano .env      # DATABASE_URL=postgresql://fsm:secret@127.0.0.1:5432/fsm
npm run db:push
npm run build
PORT=3000 npm start                    # systemd-юнит: ExecStart=/usr/bin/npm start, WorkingDirectory=/opt/fsm
```

## 5.9. Проверка работоспособности

- `GET /api/health` → `{"ok":true}` (используется в `healthcheck` compose).
- `docker compose ps` — оба сервиса `healthy`.

## 5.10. Разработка

```bash
npm install
npm run db:push
npm run dev          # http://localhost:3000
npm run db:studio    # Drizzle Studio — просмотр БД
```
