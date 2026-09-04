import { db } from "@/db";
import {
  users, clients, sites, teams, teamMembers, vehicles, vehicleAssignments, catalogItems, tickets,
  ticketStatusHistory, ticketWorks, ticketComments, roles, ticketTypes, ticketPriorities, catalogCategories, measureUnits,
} from "@/db/schema";
import { sql, eq, asc } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { receive, issueToTeam, reserve, install } from "@/lib/services/inventory";
import { SYSTEM_ROLES } from "@/lib/rbac";

/** Системные записи справочников: создаются при первом запуске и защищены от удаления. */
const SYSTEM_TICKET_TYPES = [
  { code: "installation", name: "Монтаж", sortOrder: 10 },
  { code: "maintenance", name: "ТО", sortOrder: 20 },
  { code: "repair", name: "Ремонт", sortOrder: 30 },
  { code: "inspection", name: "Обследование", sortOrder: 40 },
  { code: "other", name: "Другое", sortOrder: 50 },
];

const SYSTEM_PRIORITIES = [
  { code: "low", name: "Низкий", slaHours: 168, colorClass: "text-slate-500", sortOrder: 10 },
  { code: "normal", name: "Обычный", slaHours: 72, colorClass: "text-slate-700", sortOrder: 20 },
  { code: "high", name: "Высокий", slaHours: 24, colorClass: "text-orange-600 font-semibold", sortOrder: 30 },
  { code: "critical", name: "Критический", slaHours: 4, colorClass: "text-rose-600 font-bold", sortOrder: 40 },
];

const SYSTEM_CATEGORIES = [
  { code: "camera", name: "Камера", sortOrder: 10 },
  { code: "recorder", name: "Регистратор", sortOrder: 20 },
  { code: "controller", name: "Контроллер СКУД", sortOrder: 30 },
  { code: "reader", name: "Считыватель", sortOrder: 40 },
  { code: "lock", name: "Замок", sortOrder: 50 },
  { code: "cable", name: "Кабель", sortOrder: 60 },
  { code: "mount", name: "Крепёж", sortOrder: 70 },
  { code: "power", name: "Питание", sortOrder: 80 },
  { code: "network", name: "Сеть", sortOrder: 90 },
  { code: "consumable", name: "Расходник", sortOrder: 100 },
  { code: "other", name: "Другое", sortOrder: 110 },
];

const SYSTEM_UNITS = [
  { code: "шт", name: "Штука", sortOrder: 10 },
  { code: "м", name: "Метр", sortOrder: 20 },
  { code: "компл", name: "Комплект", sortOrder: 30 },
  { code: "упак", name: "Упаковка", sortOrder: 40 },
];

/**
 * Создаёт отсутствующие системные записи справочников. Выполняется при каждом старте:
 * так обновление системы добавляет новые справочные записи, не трогая пользовательские.
 */
export async function ensureSystemDirectories() {
  await db
    .insert(roles)
    .values(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true })))
    .onConflictDoNothing({ target: roles.code });
  await db.insert(ticketTypes).values(SYSTEM_TICKET_TYPES.map((t) => ({ ...t, isSystem: true }))).onConflictDoNothing({ target: ticketTypes.code });
  await db.insert(ticketPriorities).values(SYSTEM_PRIORITIES.map((p) => ({ ...p, isSystem: true }))).onConflictDoNothing({ target: ticketPriorities.code });
  await db.insert(catalogCategories).values(SYSTEM_CATEGORIES.map((c) => ({ ...c, isSystem: true }))).onConflictDoNothing({ target: catalogCategories.code });
  await db.insert(measureUnits).values(SYSTEM_UNITS.map((u) => ({ ...u, isSystem: true }))).onConflictDoNothing({ target: measureUnits.code });
}

/** Словарь «код → id» для справочника. */
async function codeMap<T extends { id: number; code: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Идемпотентный сид демо-данных: выполняется, если в системе нет ни одного пользователя. */
export async function seedIfEmpty() {
  await ensureSystemDirectories();

  const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(users);
  if (cnt > 0) return false;
  const pw = await hashPassword(process.env.SEED_PASSWORD || "password");

  const roleId = await codeMap(await db.select({ id: roles.id, code: roles.code }).from(roles));
  const typeId = await codeMap(await db.select({ id: ticketTypes.id, code: ticketTypes.code }).from(ticketTypes));
  const prioId = await codeMap(await db.select({ id: ticketPriorities.id, code: ticketPriorities.code }).from(ticketPriorities));
  const catId = await codeMap(await db.select({ id: catalogCategories.id, code: catalogCategories.code }).from(catalogCategories).orderBy(asc(catalogCategories.id)));
  const R = (code: string) => roleId.get(code)!;
  const T = (code: string) => typeId.get(code)!;
  const P = (code: string) => prioId.get(code)!;
  const C = (code: string) => catId.get(code)!;

  const [c1, c2] = await db.insert(clients).values([
    { name: "ООО «Северный терминал»", inn: "7801234567", contactPerson: "Иванов Пётр", phone: "+7 921 111-22-33", email: "it@sevterm.ru" },
    { name: "ЖК «Лесная гавань» (УК Комфорт)", inn: "7809876543", contactPerson: "Смирнова Анна", phone: "+7 921 444-55-66", email: "uk@comfort.ru" },
  ]).returning();
  const [s1, s2, s3] = await db.insert(sites).values([
    { clientId: c1.id, name: "Складской комплекс, КПП-1", address: "СПб, Шоссе Революции, 84", contactPerson: "Охрана КПП", contactPhone: "+7 921 100-00-01" },
    { clientId: c1.id, name: "Офис", address: "СПб, Полюстровский пр., 32", contactPerson: "Иванов Пётр" },
    { clientId: c2.id, name: "Корпус 3, паркинг", address: "СПб, ул. Лесная, 12к3", contactPerson: "Диспетчерская УК", contactPhone: "+7 921 200-00-02" },
  ]).returning();

  const [admin, disp, t1, t2, t3, t4, wh, cl] = await db.insert(users).values([
    { email: "admin@fsm.local", passwordHash: pw, fullName: "Администратор Системы", roleId: R("admin") },
    { email: "dispatcher@fsm.local", passwordHash: pw, fullName: "Кузнецова Мария", roleId: R("dispatcher"), phone: "+7 921 300-00-01" },
    { email: "tech1@fsm.local", passwordHash: pw, fullName: "Соколов Алексей", roleId: R("technician"), phone: "+7 921 300-00-11" },
    { email: "tech2@fsm.local", passwordHash: pw, fullName: "Морозов Дмитрий", roleId: R("technician"), phone: "+7 921 300-00-12" },
    { email: "tech3@fsm.local", passwordHash: pw, fullName: "Волков Сергей", roleId: R("technician"), phone: "+7 921 300-00-13" },
    { email: "tech4@fsm.local", passwordHash: pw, fullName: "Лебедев Игорь", roleId: R("technician"), phone: "+7 921 300-00-14" },
    { email: "warehouse@fsm.local", passwordHash: pw, fullName: "Петрова Ольга", roleId: R("warehouse") },
    { email: "client@fsm.local", passwordHash: pw, fullName: "Иванов Пётр (клиент)", roleId: R("client"), clientId: c1.id },
  ]).returning();
  void admin;

  const [team1, team2] = await db.insert(teams).values([
    { name: "Бригада №1", description: "СКУД и видеонаблюдение, север города" },
    { name: "Бригада №2", description: "Видеонаблюдение, юг города" },
  ]).returning();
  await db.insert(teamMembers).values([
    { teamId: team1.id, userId: t1.id, isLead: true }, { teamId: team1.id, userId: t2.id },
    { teamId: team2.id, userId: t3.id, isLead: true }, { teamId: team2.id, userId: t4.id },
  ]);
  const [v1, v2] = await db.insert(vehicles).values([
    { plateNumber: "А123ВС178", model: "ГАЗель Next", year: 2021 }, { plateNumber: "В456ЕК178", model: "Lada Largus", year: 2020 },
  ]).returning();
  await db.insert(vehicleAssignments).values([{ vehicleId: v1.id, teamId: team1.id }, { vehicleId: v2.id, teamId: team2.id }]);

  const [cam, nvr, ctrl, reader, lock, cable, mount, psu] = await db.insert(catalogItems).values([
    { sku: "CAM-HIK-2CD2043", name: "IP-камера Hikvision DS-2CD2043G2-I 4Мп", categoryId: C("camera"), isSerialized: true, manufacturer: "Hikvision" },
    { sku: "NVR-HIK-7616", name: "Видеорегистратор Hikvision DS-7616NI-K2 16 кан.", categoryId: C("recorder"), isSerialized: true, manufacturer: "Hikvision" },
    { sku: "ACS-C2000", name: "Контроллер СКУД Болид С2000-2", categoryId: C("controller"), isSerialized: true, manufacturer: "Болид" },
    { sku: "RDR-PR-EH05", name: "Считыватель Proxy EH05 (EM-Marine)", categoryId: C("reader"), isSerialized: true, manufacturer: "IronLogic" },
    { sku: "LOCK-ML-300", name: "Замок электромагнитный ML-300", categoryId: C("lock"), isSerialized: false, manufacturer: "AccordTec" },
    { sku: "CBL-UTP5E", name: "Кабель UTP cat.5e (бухта 305 м)", categoryId: C("cable"), unit: "м", isSerialized: false },
    { sku: "MNT-BRK-CAM", name: "Кронштейн для камеры настенный", categoryId: C("mount"), isSerialized: false },
    { sku: "PSU-12V-5A", name: "Блок питания 12В 5А", categoryId: C("power"), isSerialized: false },
  ]).returning();

  // Поступления на склад
  const camRes = await receive({ catalogItemId: cam.id, units: Array.from({ length: 8 }, (_, i) => ({ serialNumber: `HK2CD-${2024001 + i}`, macAddress: `C0:56:E3:1A:2B:${(0x10 + i).toString(16).toUpperCase()}` })), actorId: wh.id, note: "Поставка ООО «Видеотех», накл. 118" });
  const nvrRes = await receive({ catalogItemId: nvr.id, units: [{ serialNumber: "NVR7616-55001" }, { serialNumber: "NVR7616-55002" }], actorId: wh.id, note: "Накл. 118" });
  const ctrlRes = await receive({ catalogItemId: ctrl.id, units: [{ serialNumber: "C2000-A1001" }, { serialNumber: "C2000-A1002" }, { serialNumber: "C2000-A1003" }], actorId: wh.id, note: "Поставка Болид" });
  const rdrRes = await receive({ catalogItemId: reader.id, units: [{ serialNumber: "EH05-9001" }, { serialNumber: "EH05-9002" }, { serialNumber: "EH05-9003" }, { serialNumber: "EH05-9004" }], actorId: wh.id });
  await receive({ catalogItemId: lock.id, quantity: 10, actorId: wh.id });
  await receive({ catalogItemId: cable.id, quantity: 1220, actorId: wh.id, note: "4 бухты" });
  await receive({ catalogItemId: mount.id, quantity: 40, actorId: wh.id });
  await receive({ catalogItemId: psu.id, quantity: 12, actorId: wh.id });
  const camUnits = camRes.units!; const nvrUnits = nvrRes.units!; const ctrlUnits = ctrlRes.units!; const rdrUnits = rdrRes.units!;

  // Отгрузка бригадам
  for (const u of camUnits.slice(0, 4)) await issueToTeam({ unitId: u.id, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ unitId: nvrUnits[0].id, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ unitId: ctrlUnits[0].id, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ unitId: rdrUnits[0].id, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ unitId: rdrUnits[1].id, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: cable.id, quantity: 305, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: mount.id, quantity: 10, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: lock.id, quantity: 2, teamId: team1.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: psu.id, quantity: 3, teamId: team1.id, actorId: wh.id });
  for (const u of camUnits.slice(4, 6)) await issueToTeam({ unitId: u.id, teamId: team2.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: cable.id, quantity: 150, teamId: team2.id, actorId: wh.id });
  await issueToTeam({ catalogItemId: mount.id, quantity: 6, teamId: team2.id, actorId: wh.id });

  // Заявки
  const now = Date.now(); const h = 3600_000;
  const mk = async (v: Partial<typeof tickets.$inferInsert> & { clientId: number; siteId: number; title: string; typeId: number; priorityId: number }) => {
    const [t] = await db.insert(tickets).values({ status: "new", createdBy: disp.id, dispatcherId: disp.id, ...v }).returning();
    const number = `ЗК-${new Date().getFullYear()}-${String(t.id).padStart(5, "0")}`;
    await db.update(tickets).set({ number }).where(eq(tickets.id, t.id));
    await db.insert(ticketStatusHistory).values({ ticketId: t.id, fromStatus: null, toStatus: "new", actorId: disp.id, comment: "Заявка создана" });
    return { ...t, number };
  };
  const push = (ticketId: number, from: typeof tickets.$inferSelect.status, to: typeof tickets.$inferSelect.status, actorId: number, comment?: string) =>
    db.insert(ticketStatusHistory).values({ ticketId, fromStatus: from, toStatus: to, actorId, comment });

  // 1. Закрытая заявка: монтаж видеонаблюдения на КПП-1 (бригада 1)
  const tk1 = await mk({ clientId: c1.id, siteId: s1.id, title: "Монтаж видеонаблюдения на КПП-1 (2 камеры + регистратор)", typeId: T("installation"), priorityId: P("high"), teamId: team1.id, createdAt: new Date(now - 120 * h), scheduledStart: new Date(now - 72 * h), scheduledEnd: new Date(now - 66 * h), dueAt: new Date(now - 60 * h), startedAt: new Date(now - 71 * h), status: "in_progress" });
  await push(tk1.id, "new", "assigned", disp.id, "Назначена бригада №1"); await push(tk1.id, "assigned", "scheduled", disp.id); await push(tk1.id, "scheduled", "in_progress", t1.id); await push(tk1.id, "in_progress", "done", t1.id, "Работы выполнены"); await push(tk1.id, "done", "closed", disp.id, "Клиент подтвердил");
  await install({ ticketId: tk1.id, unitId: camUnits[0].id, actorId: t1.id });
  await install({ ticketId: tk1.id, unitId: camUnits[1].id, actorId: t1.id });
  await install({ ticketId: tk1.id, unitId: nvrUnits[0].id, actorId: t1.id });
  await install({ ticketId: tk1.id, catalogItemId: cable.id, quantity: 120, actorId: t2.id });
  await install({ ticketId: tk1.id, catalogItemId: mount.id, quantity: 2, actorId: t2.id });
  await install({ ticketId: tk1.id, catalogItemId: psu.id, quantity: 1, actorId: t2.id });
  await db.update(tickets).set({ status: "closed", completedAt: new Date(now - 65 * h), closedAt: new Date(now - 48 * h), resultNote: "Установлены 2 камеры на въезде и выезде, регистратор в серверной. Настроена запись по движению, выдан доступ клиенту." }).where(eq(tickets.id, tk1.id));
  await db.insert(ticketWorks).values([
    { ticketId: tk1.id, description: "Монтаж IP-камеры на кронштейн, прокладка кабеля", quantity: "2", unit: "шт", durationMinutes: 180, performedBy: t1.id },
    { ticketId: tk1.id, description: "Установка и настройка видеорегистратора", quantity: "1", unit: "шт", durationMinutes: 90, performedBy: t2.id },
    { ticketId: tk1.id, description: "Прокладка кабеля UTP", quantity: "120", unit: "м", durationMinutes: 120, performedBy: t2.id },
  ]);

  // 2. В работе: СКУД в офисе (бригада 1), с резервом
  const tk2 = await mk({ clientId: c1.id, siteId: s2.id, title: "Монтаж СКУД на входной группе офиса", typeId: T("installation"), priorityId: P("normal"), teamId: team1.id, createdAt: new Date(now - 30 * h), scheduledStart: new Date(now - 2 * h), scheduledEnd: new Date(now + 4 * h), dueAt: new Date(now + 24 * h), startedAt: new Date(now - 1.5 * h), status: "in_progress", description: "Контроллер + 2 считывателя (вход/выход) + электромагнитный замок. Кнопка выхода имеется." });
  await push(tk2.id, "new", "assigned", disp.id, "Назначена бригада №1"); await push(tk2.id, "assigned", "scheduled", disp.id, "Запланирован выезд"); await push(tk2.id, "scheduled", "in_progress", t1.id, "Прибыли на объект");
  await reserve({ ticketId: tk2.id, unitId: ctrlUnits[0].id, actorId: disp.id });
  await reserve({ ticketId: tk2.id, unitId: rdrUnits[0].id, actorId: disp.id });
  await reserve({ ticketId: tk2.id, catalogItemId: lock.id, quantity: 1, actorId: disp.id });
  await install({ ticketId: tk2.id, unitId: rdrUnits[1].id, actorId: t1.id });
  await db.insert(ticketWorks).values({ ticketId: tk2.id, description: "Монтаж считывателя на входе", quantity: "1", durationMinutes: 40, performedBy: t1.id });

  // Демонстрация чата по заявке: диспетчер ↔ бригада, плюс открытое сообщение клиенту.
  await db.insert(ticketComments).values([
    { ticketId: tk2.id, authorId: disp.id, authorName: "Кузнецова Мария", text: "Бригада, на объекте узкий дверной проём — возьмите короткий кронштейн.", isInternal: true, createdAt: new Date(now - 3 * h) },
    { ticketId: tk2.id, authorId: t1.id, authorName: "Соколов Алексей", text: "Принято. Выехали, будем через 40 минут.", isInternal: true, createdAt: new Date(now - 2.5 * h) },
    { ticketId: tk2.id, authorId: t1.id, authorName: "Соколов Алексей", text: "Считыватель на входе смонтирован, ставим контроллер.", isInternal: true, createdAt: new Date(now - 1 * h) },
    { ticketId: tk2.id, authorId: disp.id, authorName: "Кузнецова Мария", text: "Работы идут по графику, ориентировочное завершение — сегодня до 18:00.", isInternal: false, createdAt: new Date(now - 0.5 * h) },
  ]);

  // 3. Запланирована: ТО паркинга (бригада 2)
  const tk3 = await mk({ clientId: c2.id, siteId: s3.id, title: "Плановое ТО видеонаблюдения паркинга (12 камер)", typeId: T("maintenance"), priorityId: P("low"), teamId: team2.id, createdAt: new Date(now - 50 * h), scheduledStart: new Date(now + 20 * h), scheduledEnd: new Date(now + 26 * h), dueAt: new Date(now + 72 * h), status: "scheduled" });
  await push(tk3.id, "new", "assigned", disp.id, "Назначена бригада №2"); await push(tk3.id, "assigned", "scheduled", disp.id);

  // 4. Просроченная назначенная: ремонт камеры (бригада 2)
  const tk4 = await mk({ clientId: c2.id, siteId: s3.id, title: "Не работает камера у шлагбаума (нет изображения)", typeId: T("repair"), priorityId: P("critical"), teamId: team2.id, createdAt: new Date(now - 20 * h), dueAt: new Date(now - 5 * h), status: "assigned", description: "Со вчерашнего вечера нет картинки с камеры №7. Питание проверяли." });
  await push(tk4.id, "new", "assigned", disp.id, "Назначена бригада №2");
  await reserve({ ticketId: tk4.id, unitId: camUnits[4].id, actorId: disp.id });
  await db.insert(ticketComments).values({ ticketId: tk4.id, authorId: disp.id, authorName: "Кузнецова Мария", text: "Заявка критическая и уже просрочена — выезжайте первым делом завтра утром.", isInternal: true, createdAt: new Date(now - 4 * h) });

  // 5. Новая от клиента
  await mk({ clientId: c1.id, siteId: s1.id, title: "Добавить карты доступа для 5 новых сотрудников", typeId: T("other"), priorityId: P("normal"), dueAt: new Date(now + 96 * h), createdBy: cl.id, dispatcherId: null });
  // 6. Новая — обследование
  await mk({ clientId: c2.id, siteId: s3.id, title: "Обследование под расширение СКУД на калитки", typeId: T("inspection"), priorityId: P("normal"), dueAt: new Date(now + 120 * h) });

  return true;
}
