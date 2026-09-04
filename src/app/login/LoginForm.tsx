"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { inputCls, btnCls, Field } from "@/components/ui";

const DEMO = [
  { email: "admin@fsm.local", label: "Администратор" },
  { email: "dispatcher@fsm.local", label: "Диспетчер" },
  { email: "tech1@fsm.local", label: "Монтажник" },
  { email: "warehouse@fsm.local", label: "Склад" },
  { email: "client@fsm.local", label: "Заказчик" },
];

export function LoginForm({ showDemo }: { showDemo?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ user: { scope: string } }>("/auth/login", { method: "POST", json: { email: email.trim(), password } });
      router.replace(r.user.scope === "client" ? "/tickets" : "/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className={inputCls} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Пароль">
          <div className="relative">
            <input className={`${inputCls} pr-16`} type={showPwd ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500" aria-label={showPwd ? "Скрыть пароль" : "Показать пароль"}>
              {showPwd ? "Скрыть" : "Показать"}
            </button>
          </div>
        </Field>
        {error && <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <button className={`${btnCls} w-full py-2.5`} disabled={loading}>{loading ? "Вход…" : "Войти"}</button>
      </form>

      {showDemo && (
        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          <div className="mb-2 font-semibold text-slate-600">Демо-доступы (пароль: <code>password</code>)</div>
          <div className="flex flex-wrap gap-1.5">
            {DEMO.map((d) => (
              <button key={d.email} type="button" onClick={() => { setEmail(d.email); setPassword("password"); setError(null); }} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 active:bg-indigo-50">
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
