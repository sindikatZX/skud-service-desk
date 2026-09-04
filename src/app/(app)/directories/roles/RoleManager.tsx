"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls } from "@/components/ui";
import { PERMISSION_GROUPS, SCOPE_LABELS } from "@/lib/rbac";

export type RoleRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  scope: "all" | "team" | "client";
  isFieldStaff: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  permissions: string[];
  usedBy: number;
};

/**
 * Экран ролей: набор прав задаётся галочками, область видимости — списком.
 * Системные роли переименовываются и перенастраиваются, но не удаляются.
 */
export function RoleManager({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>, role: RoleRow | "new") {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      scope: String(fd.get("scope") ?? "all"),
      isFieldStaff: fd.get("isFieldStaff") === "on",
      isActive: fd.get("isActive") === "on",
      sortOrder: Number(fd.get("sortOrder") ?? 100),
      permissions: fd.getAll("permissions").map(String),
    };
    if (role === "new") {
      run(() => api("/directories/roles", { method: "POST", json: body }), "Роль создана");
    } else {
      run(() => api(`/directories/roles/${role.id}`, { method: "PATCH", json: body }), "Роль обновлена");
    }
  }

  const form = (role: RoleRow | "new") => {
    const r = role === "new" ? null : role;
    return (
      <form onSubmit={(e) => submit(e, role)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Код" hint="формат RL_ГГГГ_NNNNN, присваивается системой">
            <input name="code" className={`${inputCls} font-mono`} defaultValue={r?.code ?? ""} disabled placeholder="генерируется автоматически" />
          </Field>
          <Field label="Название">
            <input name="name" className={inputCls} required defaultValue={r?.name ?? ""} placeholder="Старший монтажник" />
          </Field>
          <Field label="Описание">
            <input name="description" className={inputCls} defaultValue={r?.description ?? ""} placeholder="Чем занимается роль" />
          </Field>
          <Field label="Область видимости данных" hint="что видит пользователь этой роли">
            <select name="scope" className={inputCls} defaultValue={r?.scope ?? "all"}>
              {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Порядок сортировки">
            <input name="sortOrder" type="number" className={inputCls} defaultValue={r?.sortOrder ?? 100} />
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isFieldStaff" defaultChecked={r?.isFieldStaff ?? false} className="h-4 w-4" />
              Полевой персонал (может входить в бригаду)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={r?.isActive ?? true} className="h-4 w-4" />
              Роль активна
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-3">
          <div className="mb-2 text-sm font-semibold">Права</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.group}</div>
                <ul className="space-y-1">
                  {g.items.map((p) => (
                    <li key={p.key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="permissions"
                          value={p.key}
                          defaultChecked={r?.permissions.includes(p.key) ?? false}
                          className="mt-0.5 h-4 w-4 shrink-0"
                        />
                        <span>{p.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button className={btnCls} disabled={busy}>{role === "new" ? "Создать роль" : "Сохранить"}</button>
          <button type="button" className={btnSecondaryCls} onClick={() => setEditing(null)}>Отмена</button>
        </div>
      </form>
    );
  };

  return (
    <div className="space-y-4">
      {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      {editing === "new" ? (
        <Card title="Новая роль">{form("new")}</Card>
      ) : (
        <div><button className={btnCls} onClick={() => setEditing("new")}>+ Добавить роль</button></div>
      )}

      {editing && editing !== "new" && <Card title={`Роль: ${editing.name}`}>{form(editing)}</Card>}

      <Card title={`Роли (${roles.length})`}>
        <Table head={["Код", "Роль", "Область данных", "Прав", "Сотрудников", "Статус", ""]} empty={!roles.length}>
          {roles.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td><span className="font-mono text-xs">{r.code}</span></Td>
              <Td>
                <div className="font-medium">{r.name}{r.isSystem && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">системная</span>}</div>
                {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
                {r.isFieldStaff && <div className="text-[11px] text-indigo-600">полевой персонал</div>}
              </Td>
              <Td className="text-xs">{SCOPE_LABELS[r.scope]}</Td>
              <Td className="text-xs">{r.permissions.length}</Td>
              <Td className="text-xs">{r.usedBy}</Td>
              <Td>{r.isActive ? <Badge tone="green">активна</Badge> : <Badge>отключена</Badge>}</Td>
              <Td>
                <div className="flex items-center gap-3">
                  <button className="text-xs text-indigo-600 hover:underline" onClick={() => setEditing(r)}>изменить</button>
                  {r.isSystem ? (
                    <span className="text-xs text-slate-300" title="Системную роль можно отключить, но не удалить">удалить</span>
                  ) : (
                    <button
                      className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Удалить роль «${r.name}»?${r.usedBy ? `\n\nРоль назначена ${r.usedBy} сотрудникам — удаление будет отклонено.` : ""}`)) return;
                        run(() => api(`/directories/roles/${r.id}`, { method: "DELETE" }), "Роль удалена");
                      }}
                    >
                      удалить
                    </button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
