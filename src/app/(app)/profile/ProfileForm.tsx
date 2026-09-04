"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls } from "@/components/ui";

type Me = { fullName: string; email: string; phone: string | null };

/** Самостоятельное редактирование учётной записи: ФИО, телефон, логин, пароль. Роль меняет только администратор. */
export function ProfileForm({ me }: { me: Me }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(json: Record<string, unknown>, okText: string, form?: HTMLFormElement) {
    setBusy(true); setMsg(null);
    try { await api("/auth/me", { method: "PATCH", json }); setMsg({ ok: true, text: okText }); form?.reset(); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <div className={`lg:col-span-2 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      <Card title="Личные данные">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run({ fullName: fd.get("fullName"), phone: fd.get("phone") || null }, "Данные сохранены"); }}>
          <Field label="ФИО"><input name="fullName" className={inputCls} required defaultValue={me.fullName} /></Field>
          <Field label="Телефон"><input name="phone" className={inputCls} defaultValue={me.phone ?? ""} placeholder="+7 …" /></Field>
          <button className={btnCls} disabled={busy}>Сохранить</button>
        </form>
      </Card>
      <Card title="Логин (email)">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run({ email: fd.get("email"), currentPassword: fd.get("currentPassword") }, "Логин изменён", f); }}>
          <Field label="Новый логин" hint="используется для входа"><input name="email" type="email" className={inputCls} required defaultValue={me.email} /></Field>
          <Field label="Текущий пароль" hint="подтверждение смены логина"><input name="currentPassword" type="password" className={inputCls} required autoComplete="current-password" /></Field>
          <button className={btnCls} disabled={busy}>Изменить логин</button>
        </form>
      </Card>
      <Card title="Смена пароля">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); if (fd.get("newPassword") !== fd.get("confirm")) { setMsg({ ok: false, text: "Пароли не совпадают" }); return; } run({ currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") }, "Пароль изменён", f); }}>
          <Field label="Текущий пароль"><input name="currentPassword" type="password" className={inputCls} required autoComplete="current-password" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Новый пароль" hint="минимум 6 символов"><input name="newPassword" type="password" className={inputCls} required minLength={6} autoComplete="new-password" /></Field>
            <Field label="Повторите"><input name="confirm" type="password" className={inputCls} required minLength={6} autoComplete="new-password" /></Field>
          </div>
          <button className={btnCls} disabled={busy}>Изменить пароль</button>
        </form>
      </Card>
    </div>
  );
}
