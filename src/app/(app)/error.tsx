"use client";
import { useEffect } from "react";
import Link from "next/link";
import { btnCls, btnSecondaryCls } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-50 text-3xl">{offline ? "📡" : "⚠️"}</div>
      <h1 className="mt-4 text-lg font-bold">{offline ? "Нет подключения к сети" : "Не удалось загрузить страницу"}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {offline ? "Проверьте связь и повторите попытку. Ранее открытые экраны доступны из кэша." : "Произошла ошибка на сервере. Попробуйте обновить страницу — если повторяется, сообщите администратору."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-slate-400">код: {error.digest}</p>}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button onClick={reset} className={btnCls}>Повторить</button>
        <Link href="/tickets" className={btnSecondaryCls}>К заявкам</Link>
      </div>
    </div>
  );
}
