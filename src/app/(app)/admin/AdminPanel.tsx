"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls, btnDangerCls } from "@/components/ui";
import { fmtBytes, fmtDate } from "@/lib/labels";

type Backup = { id: number; fileName: string; size: number; tables: number; rows: number; reason: string; note: string | null; createdAt: string; exists: boolean };
type Stats = { size: string; name: string; version: string; tables: { table: string; rows: number; dead: number; size: string; lastVacuum: string | null; lastAnalyze: string | null }[] };
type Issue = { key: string; title: string; count: number; severity: "error" | "warning" | "info"; fixable: boolean; fix?: string; sample?: string[] };
type Integrity = { issues: Issue[]; ok: boolean; checkedAt: string } | null;

const REASON: Record<string, string> = { manual: "вручную", auto: "автоматически", external: "внешний файл", uploaded: "загружен" };

/**
 * Панель администрирования БД: резервные копии (создать / загрузить / скачать / восстановить /
 * удалить), очистка «с чистого листа», обслуживание и проверка целостности с исправлением.
 * Все разрушительные действия требуют ввода подтверждающего слова и по умолчанию
 * делают резервную копию перед выполнением.
 */
export function AdminPanel({ canBackup, canMaint, backupDir, backups, stats, integrity }: { canBackup: boolean; canMaint: boolean; backupDir: string; backups: Backup[]; stats: Stats; integrity: Integrity }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState("");
  const [backupFirst, setBackupFirst] = useState(true);
  const [showReset, setShowReset] = useState(false);
  const [keepUsers, setKeepUsers] = useState(true);
  const [wipeDirectories, setWipeDirectories] = useState(false);
  const [check, setCheck] = useState<Integrity>(integrity);
  const [repairLog, setRepairLog] = useState<{ key: string; title: string; fixed: number }[] | null>(null);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key); setMsg(null);
    try {
      const text = await fn();
      setMsg({ ok: true, text });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const sev = (s: Issue["severity"]) => (s === "error" ? "rose" : s === "warning" ? "amber" : "slate");

  return (
    <div className="space-y-4">
      {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      {canBackup && (
        <Card title="Резервные копии" action={<span className="text-xs text-slate-500">каталог: <span className="font-mono">{backupDir}</span></span>}>
          <p className="mb-3 text-sm text-slate-600">Копия содержит все таблицы базы данных (справочники, заявки, склад, чат, сотрудников) и значения счётчиков. Формат — сжатый JSON, не зависит от версии PostgreSQL.</p>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Комментарий к копии"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="перед обновлением…" /></Field>
            <button className={btnCls} disabled={busy !== null} onClick={() => run("create", async () => { const b = await api<Backup>("/admin/backups", { method: "POST", json: { note: note || null } }); setNote(""); return `Копия ${b.fileName} создана: ${b.tables} таблиц, ${b.rows} строк, ${fmtBytes(b.size)}`; })}>{busy === "create" ? "Создание…" : "Создать копию"}</button>
            <label className={`${btnSecondaryCls} cursor-pointer`}>
              Загрузить файл копии
              <input type="file" accept=".gz,.json" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return;
                run("upload", async () => {
                  const fd = new FormData(); fd.append("file", f);
                  const res = await fetch("/api/v1/admin/backups", { method: "POST", body: fd });
                  const body = await res.json();
                  if (!body.ok) throw new Error(body.error.message);
                  return `Файл ${f.name} загружен в каталог копий — теперь из него можно восстановить базу`;
                });
                e.target.value = "";
              }} />
            </label>
          </div>
          <Table head={["Дата", "Файл", "Размер", "Таблиц / строк", "Причина", "Комментарий", ""]} empty={!backups.length} emptyText="Резервных копий пока нет">
            {backups.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-xs">{fmtDate(b.createdAt)}</Td>
                <Td><span className="font-mono text-xs">{b.fileName}</span>{!b.exists && <Badge tone="rose">файл отсутствует</Badge>}</Td>
                <Td className="text-xs">{fmtBytes(b.size)}</Td>
                <Td className="text-xs">{b.tables} / {b.rows}</Td>
                <Td className="text-xs">{REASON[b.reason] ?? b.reason}</Td>
                <Td className="text-xs text-slate-500">{b.note ?? "—"}</Td>
                <Td>
                  <div className="flex items-center gap-3 text-xs">
                    {b.exists && <a href={`/api/v1/admin/backups/${b.id}`} className="text-indigo-600 hover:underline">скачать</a>}
                    {b.exists && <button className="text-amber-700 hover:underline" onClick={() => { setRestoreId(b.id); setConfirm(""); }}>восстановить</button>}
                    <button className="text-rose-600 hover:underline" disabled={busy !== null} onClick={() => { if (window.confirm(`Удалить копию ${b.fileName}?`)) run("del", async () => { await api(`/admin/backups/${b.id}`, { method: "DELETE" }); return "Копия удалена"; }); }}>удалить</button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>

          {restoreId !== null && (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <div className="font-semibold text-amber-900">Восстановление из копии {backups.find((b) => b.id === restoreId)?.fileName}</div>
              <p className="mt-1 text-sm text-amber-900">Все текущие данные будут заменены содержимым копии. Активные сессии сотрудников могут завершиться. Перед восстановлением по умолчанию создаётся копия текущего состояния.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Field label="Введите ВОССТАНОВИТЬ"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></Field>
                <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} className="h-4 w-4" /> Сначала сделать копию</label>
                <div className="flex items-end gap-2">
                  <button className={btnDangerCls} disabled={confirm !== "ВОССТАНОВИТЬ" || busy !== null} onClick={() => run("restore", async () => { const r = await api<{ restoredRows: number; tables: number; skippedTables: string[] }>(`/admin/backups/${restoreId}`, { method: "POST", json: { confirm, backupFirst } }); setRestoreId(null); return `Восстановлено ${r.restoredRows} строк в ${r.tables} таблицах${r.skippedTables.length ? ` (пропущены: ${r.skippedTables.join(", ")})` : ""}. Обновите страницу.`; })}>{busy === "restore" ? "Восстановление…" : "Восстановить"}</button>
                  <button className={btnSecondaryCls} onClick={() => setRestoreId(null)}>Отмена</button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {canMaint && (
        <>
          <Card title="Проверка и исправление целостности" action={check && <span className="text-xs text-slate-500">проверено {fmtDate(check.checkedAt)}</span>}>
            <p className="mb-3 text-sm text-slate-600">Проверяются ссылки между таблицами без внешних ключей, соответствие статусов серийных единиц местам хранения, отрицательные остатки, зависшие резервы, счётчики документов, коды справочников и наличие складов бригад. Исправление выполняется после автоматической резервной копии.</p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => run("check", async () => { const r = await api<NonNullable<Integrity>>("/admin/maintenance", { method: "POST", json: { action: "check" } }); setCheck(r); setRepairLog(null); return r.ok ? "Проблем не найдено" : `Найдено проблем: ${r.issues.filter((i) => i.count).length}`; })}>{busy === "check" ? "Проверка…" : "Проверить"}</button>
              <button className={btnCls} disabled={busy !== null || !check || check.ok} onClick={() => { if (!window.confirm("Исправить найденные проблемы? Перед этим будет создана резервная копия.")) return; run("repair", async () => { const r = await api<{ fixed: { key: string; title: string; fixed: number }[]; after: NonNullable<Integrity> }>("/admin/maintenance", { method: "POST", json: { action: "repair", backupFirst: true } }); setCheck(r.after); setRepairLog(r.fixed); return `Исправлено: ${r.fixed.reduce((s, f) => s + f.fixed, 0)} записей в ${r.fixed.length} проверках`; }); }}>{busy === "repair" ? "Исправление…" : "Исправить (с копией)"}</button>
              {check && <Badge tone={check.ok ? "green" : "amber"}>{check.ok ? "целостность в порядке" : `проблем: ${check.issues.filter((i) => i.count).length}`}</Badge>}
            </div>
            {check && (
              <Table head={["Проверка", "Найдено", "Уровень", "Исправление"]}>
                {check.issues.map((i) => (
                  <tr key={i.key} className={i.count ? "" : "opacity-60"}>
                    <Td><div>{i.title}</div>{i.sample?.length ? <div className="text-[11px] text-slate-500">{i.sample.join("; ")}</div> : null}</Td>
                    <Td className={`tabular-nums ${i.count ? "font-semibold" : ""}`}>{i.count}</Td>
                    <Td><Badge tone={i.count ? sev(i.severity) : "green"}>{i.count ? (i.severity === "error" ? "ошибка" : i.severity === "warning" ? "предупреждение" : "инфо") : "ок"}</Badge></Td>
                    <Td className="text-xs text-slate-500">{i.fixable ? i.fix : "только вручную"}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {repairLog && repairLog.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-emerald-800">{repairLog.map((f) => <li key={f.key}>{f.title}: исправлено {f.fixed}</li>)}</ul>}
          </Card>

          <Card title="Обслуживание базы данных">
            <div className="mb-3 flex flex-wrap gap-2">
              <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => run("vacuum", async () => { const r = await api<{ ms: number }>("/admin/maintenance", { method: "POST", json: { action: "vacuum" } }); return `VACUUM ANALYZE выполнен за ${r.ms} мс`; })}>VACUUM ANALYZE</button>
              <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => run("analyze", async () => { const r = await api<{ ms: number }>("/admin/maintenance", { method: "POST", json: { action: "analyze" } }); return `ANALYZE выполнен за ${r.ms} мс`; })}>ANALYZE</button>
              <button className={btnSecondaryCls} disabled={busy !== null} onClick={() => run("reindex", async () => { const r = await api<{ ms: number; tables: number }>("/admin/maintenance", { method: "POST", json: { action: "reindex" } }); return `REINDEX ${r.tables} таблиц выполнен за ${r.ms} мс`; })}>REINDEX</button>
            </div>
            <Table head={["Таблица", "Строк", "Мёртвых строк", "Размер", "Vacuum", "Analyze"]}>
              {stats.tables.map((t) => (
                <tr key={t.table}><Td className="font-mono text-xs">{t.table}</Td><Td className="tabular-nums text-xs">{t.rows}</Td><Td className={`tabular-nums text-xs ${t.dead > 1000 ? "text-amber-700" : ""}`}>{t.dead}</Td><Td className="text-xs">{t.size}</Td><Td className="text-xs">{t.lastVacuum ? fmtDate(t.lastVacuum) : "—"}</Td><Td className="text-xs">{t.lastAnalyze ? fmtDate(t.lastAnalyze) : "—"}</Td></tr>
              ))}
            </Table>
          </Card>

          <Card title="Удаление демо-данных и очистка «с чистого листа»">
            <p className="mb-3 text-sm text-slate-600">Демонстрационные данные (клиенты, объекты, бригады, автомобили, товары, заявки, складские документы) нужны, чтобы разобраться в процессах; когда они больше не нужны — удалите их здесь. Удаляются все заявки, чат и вложения, складские документы и остатки, оборудование, клиенты, объекты, бригады, автопарк и товары, а также записи справочников, добавленные вручную. Предустановленные записи справочников (типы работ, приоритеты, категории, единицы измерения, роли, центральный и транзитный склады) по умолчанию сохраняются — их можно удалить вместе с остальным (флажок ниже) либо по одной в разделе «Справочники». Сотрудников можно оставить.</p>
            {!showReset ? (
              <button className={btnDangerCls} onClick={() => { setShowReset(true); setConfirm(""); }}>Очистить данные…</button>
            ) : (
              <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4">
                <div className="grid gap-2 sm:grid-cols-5">
                  <Field label="Введите ОЧИСТИТЬ"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></Field>
                  <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} className="h-4 w-4" /> Сначала сделать копию</label>
                  <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={keepUsers} onChange={(e) => setKeepUsers(e.target.checked)} className="h-4 w-4" /> Оставить сотрудников</label>
                  <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={wipeDirectories} onChange={(e) => setWipeDirectories(e.target.checked)} className="h-4 w-4" /> Удалить и предустановленные справочники</label>
                  <div className="flex items-end gap-2">
                    <button className={btnDangerCls} disabled={confirm !== "ОЧИСТИТЬ" || busy !== null} onClick={() => run("reset", async () => { const r = await api<{ removed: Record<string, number> }>("/admin/reset", { method: "POST", json: { confirm, backupFirst, keepUsers, wipeDirectories } }); setShowReset(false); return `База очищена. Удалено: ${Object.entries(r.removed).filter(([, n]) => n).map(([t, n]) => `${t} — ${n}`).join(", ") || "нечего удалять"}`; })}>{busy === "reset" ? "Очистка…" : "Очистить"}</button>
                    <button className={btnSecondaryCls} onClick={() => setShowReset(false)}>Отмена</button>
                  </div>
                </div>
                {!keepUsers && <p className="mt-2 text-xs text-rose-800">Будут удалены все сотрудники, кроме администраторов (иначе в систему нельзя будет войти).</p>}
                {wipeDirectories && <p className="mt-2 text-xs text-rose-800">Справочники будут пустыми: перед созданием первой заявки заведите типы работ и приоритеты, для товаров — категории и единицы измерения. Останутся только центральный склад и роли, назначенные сотрудникам.</p>}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
