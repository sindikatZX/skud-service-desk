import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";
import { seedIfEmpty } from "@/db/seed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage() {
  await seedIfEmpty().catch((e) => console.error("seed failed", e));
  const user = await getCurrentUser();
  if (user) redirect(user.scope === "client" ? "/tickets" : "/");
  const showDemo = process.env.SHOW_DEMO_LOGINS !== "false";
  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-center sm:justify-center">
      <div className="flex flex-1 flex-col justify-center sm:flex-none">
        <div className="mx-auto w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <Image src="/icons/icon-192.png" alt="" width={56} height={56} unoptimized priority className="h-14 w-14 rounded-2xl shadow-md" />
            <div className="mt-3 text-2xl font-bold text-indigo-700">СКУД•Сервис</div>
            <p className="mt-1 text-sm text-slate-500">Заявки · Монтаж · Обслуживание · Склад</p>
          </div>
          <LoginForm showDemo={showDemo} />
        </div>
        <p className="mt-4 text-center text-[11px] text-indigo-200/80">Установите приложение на телефон — работает офлайн с последними данными</p>
      </div>
    </main>
  );
}
