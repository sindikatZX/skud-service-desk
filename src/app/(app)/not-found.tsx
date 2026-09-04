import Link from "next/link";
import { btnCls } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-200 text-2xl font-bold text-slate-500">404</div>
      <h1 className="mt-4 text-lg font-bold">Запись не найдена</h1>
      <p className="mt-2 text-sm text-slate-600">Возможно, она была удалена или у вашей роли нет к ней доступа.</p>
      <Link href="/tickets" className={`${btnCls} mt-5`}>К заявкам</Link>
    </div>
  );
}
