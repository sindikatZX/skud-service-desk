import type { Metadata } from "next";
import { OfflineActions } from "./OfflineActions";

export const metadata: Metadata = { title: "Нет сети" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-6 text-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-3xl">📡</div>
        <h1 className="mt-4 text-xl font-bold">Нет подключения к сети</h1>
        <p className="mt-2 text-sm text-slate-600">
          Эта страница ещё не сохранена для офлайн-доступа. Ранее открытые заявки и разделы доступны из кэша — вернитесь к ним через навигацию.
        </p>
        <OfflineActions />
      </div>
    </main>
  );
}
