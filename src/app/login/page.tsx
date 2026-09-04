import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import { seedIfEmpty } from "@/db/seed";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await seedIfEmpty().catch((e) => console.error("seed failed", e));
  const user = await getCurrentUser();
  if (user) redirect(user.scope === "client" ? "/tickets" : "/");
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-indigo-700">СКУД•Сервис</div>
          <p className="mt-1 text-sm text-slate-500">Заявки · Монтаж · Обслуживание · Склад</p>
        </div>
        <LoginForm />
        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          <div className="mb-1 font-semibold text-slate-600">Демо-доступы (пароль: <code>password</code>)</div>
          <div>admin@fsm.local · dispatcher@fsm.local</div>
          <div>tech1@fsm.local · warehouse@fsm.local · client@fsm.local</div>
        </div>
      </div>
    </main>
  );
}
