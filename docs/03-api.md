# 3. API-документация (REST, v1)

Базовый путь: `/api/v1`. Все ответы — JSON.

## 3.1. Общие соглашения

**Формат ответа**
```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": { "code": "CONFLICT", "message": "Недостаточно остатка: доступно 2, требуется 5", "details": null } }
```

**Коды ошибок**

| HTTP | code | Когда |
|---|---|---|
| 400 | `BAD_REQUEST` | невалидный JSON / отсутствуют обязательные поля |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | нет сессии / неверный логин |
| 403 | `FORBIDDEN` | недостаточно прав или чужая область (бригада/клиент) |
| 404 | `NOT_FOUND` | сущность не найдена (или скрыта областью видимости) |
| 409 | `CONFLICT` | нарушение бизнес-правила: недопустимый переход, нехватка остатка, единица не в нужном состоянии |
| 500 | `INTERNAL` | внутренняя ошибка |

**Аутентификация**: cookie `fsm_session` (устанавливается при login) или заголовок `Authorization: Bearer <token>`.

**Даты**: ISO-8601 строки. **Количества**: числа (в ответах — строки numeric, напр. `"305.000"`).

**Права** указаны в колонке «Право» (любое из перечисленных). Подробнее — 04-roles-and-permissions.md.

## 3.2. Auth

| Метод | Путь | Право | Описание |
|---|---|---|---|
| POST | `/auth/login` | — | Тело: `{email, password}`. Ответ: `{token, user}`; ставит cookie |
| POST | `/auth/logout` | — | Сбрасывает cookie |
| GET | `/auth/me` | auth | `{user: {id,email,fullName,role,clientId,teamId}, permissions: [...]}` |

## 3.3. Пользователи (сотрудники)

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/users` | `users.manage`, `teams.read` | Список с текущей бригадой |
| POST | `/users` | `users.manage` | `{email, password(≥6), fullName, phone?, role, clientId?}` → 201 |
| PATCH | `/users/{id}` | `users.manage` | `{fullName?, phone?, role?, isActive?, clientId?, password?}` |

## 3.4. Клиенты и объекты

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/clients` | `clients.read`, `tickets.read.own` | Список (+`sitesCount`, `openTickets`); клиент видит только себя |
| POST | `/clients` | `clients.manage` | `{name, inn?, contactPerson?, phone?, email?, notes?}` |
| GET | `/clients/{id}` | `clients.read`, `tickets.read.own` | `{client, sites[], tickets[]}` — история обслуживания |
| PATCH | `/clients/{id}` | `clients.manage` | частичное обновление, `isActive` |
| GET | `/clients/{id}/sites` | `clients.read`, `tickets.read.own` | объекты клиента |
| POST | `/clients/{id}/sites` | `sites.manage` | `{name, address, contactPerson?, contactPhone?, notes?}` |
| GET | `/sites/{id}` | `clients.read`, `tickets.read.own` | `{site, equipment[], tickets[]}` — оборудование на объекте и история |
| PATCH | `/sites/{id}` | `sites.manage` | обновление |
| GET | `/sites/{id}/equipment` | `clients.read`, `tickets.read.own` | установленное оборудование (серийные + материалы) с заявкой и датой |

## 3.5. Бригады и автомобили

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/teams` | `teams.read` | бригады с текущим составом и авто |
| POST | `/teams` | `teams.manage` | `{name, description?}` |
| GET | `/teams/{id}` | `teams.read` | `{team, membersHistory[], vehiclesHistory[]}` |
| PATCH | `/teams/{id}` | `teams.manage` | `{name?, description?, isActive?}` |
| POST | `/teams/{id}/members` | `teams.manage` | `{userId, isLead?}` — добавить (≤3 активных; выводит из прежней бригады) |
| DELETE | `/teams/{id}/members?userId=` | `teams.manage` | вывести (ставит `left_at`) |
| POST | `/teams/{id}/vehicles` | `vehicles.manage`, `teams.manage` | `{vehicleId}` — закрепить авто (предыдущее закрепление закрывается) |
| DELETE | `/teams/{id}/vehicles?vehicleId=` | `vehicles.manage`, `teams.manage` | открепить |
| GET | `/teams/{id}/stock` | `inventory.read.all`, `inventory.read.team` (только своя) | `{balances[], units[], reservations[]}` — остатки бригады |
| GET | `/vehicles` | `teams.read` | автопарк с текущей бригадой |
| POST | `/vehicles` | `vehicles.manage` | `{plateNumber, model, year?}` |

## 3.6. Номенклатура

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/catalog` | `catalog.read` | все позиции |
| POST | `/catalog` | `catalog.manage` | `{sku, name, category, unit?, isSerialized?, manufacturer?, description?}` |
| PATCH | `/catalog/{id}` | `catalog.manage` | обновление (`isSerialized` не меняется после создания) |

## 3.7. Склад (inventory)

### Чтение
| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/inventory/warehouse` | `inventory.read.all` | остатки центрального склада `{balances, units, reservations}` |
| GET | `/inventory/units?q=&status=` | `inventory.read.all`, `inventory.read.team` | поиск серийных единиц по S/N, MAC, названию |
| GET | `/inventory/units/{id}` | `inventory.read.*`, `clients.read` | `{unit, history[]}` — **полный жизненный цикл единицы** |
| GET | `/inventory/transactions?teamId=&clientId=&ticketId=&unitId=&catalogItemId=&type=&limit=` | `inventory.read.all`, `inventory.read.team` | журнал операций (монтажник — только своя бригада) |

### Операции (все — POST, ответ 201 с записью журнала)
| Путь | Право | Тело | Правила |
|---|---|---|---|
| `/inventory/operations/receive` | `inventory.receive` | серийное: `{catalogItemId, units:[{serialNumber, macAddress?}], note?}`; несерийное: `{catalogItemId, quantity, note?}` | создаёт единицы `in_warehouse` / увеличивает остаток склада |
| `/inventory/operations/issue` | `inventory.issue` | `{teamId, unitId}` или `{teamId, catalogItemId, quantity}` | единица должна быть `in_warehouse`; остаток склада ≥ qty |
| `/inventory/operations/return` | `inventory.return` | `{teamId, unitId}` или `{teamId, catalogItemId, quantity}` | единица `at_team` (резерв снять заранее) |
| `/inventory/operations/reserve` | `inventory.reserve` | `{ticketId, unitId}` или `{ticketId, catalogItemId, quantity}`, `fromWarehouse?` | по умолчанию из остатков бригады заявки; монтажник — только своя бригада и не со склада |
| `/inventory/operations/unreserve` | `inventory.reserve` | `{unitId}` или `{reservationId}` | возврат в свободный остаток |
| `/inventory/operations/install` | `inventory.install` | `{ticketId, unitId}` или `{ticketId, catalogItemId, quantity, note?}` | заявке назначена бригада и она не закрыта; единица — резерв этой заявки или `at_team` бригады заявки; для материалов сначала списываются резервы заявки, затем свободный остаток бригады; создаёт `ticket_materials` |
| `/inventory/operations/write-off` | `inventory.writeoff` | `{unitId, note}` или `{catalogItemId, quantity, teamId?, note}` | только свободные единицы/остатки |

## 3.8. Заявки

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/tickets?status=a,b&teamId=&clientId=&siteId=&q=&overdue=1&limit=` | `tickets.read.all`, `tickets.read.own` | список (монтажник — своя бригада, клиент — свои) |
| POST | `/tickets` | `tickets.create` | `{clientId, siteId, title, description?, type?, priority?, dueAt?, teamId?, scheduledStart?, scheduledEnd?}` → 201. Если указана бригада — статус `assigned` (или `scheduled` при дате выезда) |
| GET | `/tickets/{id}` | read | `{ticket, history[], works[], comments[], teamMembers[], allowedTransitions[], materials[], reservations:{quantities[], units[]}}` |
| PATCH | `/tickets/{id}` | `tickets.assign` (все поля), `tickets.work` (только `resultNote`) | `{title?, description?, type?, priority?, dueAt?, teamId?, dispatcherId?, scheduledStart?, scheduledEnd?, resultNote?}`. Назначение бригады из `new` → `assigned`; дата выезда при бригаде → `scheduled` |
| POST | `/tickets/{id}/status` | по матрице переходов | `{status, comment?}`; при `done` комментарий сохраняется как `resultNote` |
| POST | `/tickets/{id}/works` | `tickets.work`, `tickets.assign` | `{description, quantity?, unit?, durationMinutes?, performedBy?}` |
| POST | `/tickets/{id}/comments` | read | `{text}` |
| GET | `/tickets/{id}/materials` | read | установленное по заявке |
| GET | `/tickets/{id}/reservations` | read | активные резервы заявки |

## 3.9. Отчёты

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/reports/dashboard` | `reports.view`, `reports.inventory` | `{byStatus, byType, overdue, scheduledToday, avgCompletionHours}` |
| GET | `/reports/workload?from=&to=` | `reports.view` | по монтажникам: работы, часы, заявки бригады, просрочки, ср. время |
| GET | `/reports/consumption?teamId=&clientId=&from=&to=` | `reports.inventory`, `reports.view` | расход (установки) в разрезе бригада → клиент → заявка → номенклатура |
| GET | `/reports/clients` | `reports.view` | заявки и установленное оборудование по клиентам |
| GET | `/reports/teams-stock` | `reports.inventory`, `reports.view` | сводка остатков у бригад |

## 3.10. Служебные

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/health` | `{ok:true}` при доступной БД (для healthcheck Docker) |
| POST | `/api/v1/system/seed` | `users.manage` — загрузить демо-данные (только в пустую БД) |

## 3.11. Пример сценария (curl)

```bash
# вход
TOKEN=$(curl -s -X POST $H/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dispatcher@fsm.local","password":"password"}' | jq -r .data.token)
# создать заявку и назначить бригаду 1 с выездом
curl -s -X POST $H/api/v1/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"clientId":1,"siteId":1,"title":"Замена камеры","type":"repair","teamId":1,"scheduledStart":"2026-03-25T09:00:00Z"}'
# монтажник берёт в работу и устанавливает единицу
curl -s -X POST $H/api/v1/tickets/7/status -H "Authorization: Bearer $TECH" -d '{"status":"in_progress"}'
curl -s -X POST $H/api/v1/inventory/operations/install -H "Authorization: Bearer $TECH" -d '{"ticketId":7,"unitId":3}'
curl -s -X POST $H/api/v1/tickets/7/status -H "Authorization: Bearer $TECH" -d '{"status":"done","comment":"Камера заменена"}'
```

## 3.12. Версионирование

Все эндпоинты находятся под `/api/v1`. Несовместимые изменения выпускаются как `/api/v2` с сохранением `v1` на период миграции мобильных клиентов. Добавление полей в ответы считается совместимым изменением.


## Валидация запросов

Все тела и query-параметры разбираются zod-схемами из `src/lib/validators.ts`
(`parseBody(req, schema)` / `parseQuery(req, schema)`). При ошибке возвращается
`400 BAD_REQUEST`, где `message` перечисляет проблемные поля, а `details` содержит issues zod:

```json
{ "ok": false, "error": { "code": "BAD_REQUEST", "message": "name: не может быть пустым", "details": [ ... ] } }
```

## Справочники

`{dict}` — один из `ticket-types`, `priorities`, `categories`, `measure-units`, `roles`.

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/api/v1/directories/{dict}` | любой вход | Список записей со счётчиком использования |
| POST | `/api/v1/directories/{dict}` | `directories.manage` | Создать запись |
| PATCH | `/api/v1/directories/{dict}/{id}` | `directories.manage` | Изменить запись |
| DELETE | `/api/v1/directories/{dict}/{id}` | `directories.manage` | Удалить (системные и используемые — `409`) |

Тело роли: `{ code, name, description, scope, isFieldStaff, permissions: string[], sortOrder, isActive }`.

## Чат заявки

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/api/v1/tickets/{id}/chat?afterId=&limit=` | доступ к заявке | Лента; `afterId` отдаёт только новые сообщения (используется опросом в UI) |
| POST | `/api/v1/tickets/{id}/chat` | `chat.write` | `{ text, isInternal }`; без `chat.internal` сообщение всегда открытое |
| PATCH | `/api/v1/tickets/{id}/chat/{messageId}` | автор сообщения | Правка текста |
| DELETE | `/api/v1/tickets/{id}/chat/{messageId}` | автор или `users.manage` | Удалить сообщение |

## Удаление записей

| Метод | Путь | Право |
|---|---|---|
| DELETE | `/api/v1/clients/{id}` | `clients.manage` |
| DELETE | `/api/v1/sites/{id}` | `sites.manage` |
| DELETE | `/api/v1/users/{id}` | `users.manage` |
| DELETE | `/api/v1/teams/{id}` | `teams.manage` |
| DELETE | `/api/v1/vehicles/{id}` | `vehicles.manage` |
| DELETE | `/api/v1/catalog/{id}` | `catalog.manage` |
| DELETE | `/api/v1/inventory/units/{id}` | `inventory.writeoff` |
| DELETE | `/api/v1/tickets/{id}` | `tickets.delete` |

Если запись участвует в истории, возвращается `409 CONFLICT` с перечнем помех, например:

```json
{ "ok": false, "error": { "code": "CONFLICT",
  "message": "Нельзя удалить — на запись ссылаются: заявки: 3, объекты: 1, складские операции: 1. Деактивируйте запись, чтобы скрыть её из списков, сохранив историю." } }
```
