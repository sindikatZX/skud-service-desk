"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Кликабельный заголовок колонки. Сортировка живёт в адресе страницы (sort/dir),
 * поэтому состояние сохраняется при обновлении и в ссылке, которой можно поделиться.
 */
export function SortLink({ field, children, current, dir }: { field: string; children: ReactNode; current?: string; dir?: string }) {
  const sp = useSearchParams();
  const active = current === field;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const p = new URLSearchParams(sp.toString());
  p.set("sort", field);
  p.set("dir", nextDir);
  return (
    <Link
      href={`?${p.toString()}`}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-indigo-700 ${active ? "text-indigo-700" : ""}`}
    >
      {children}
      <span className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : <span className="no-print text-slate-300">↕</span>}</span>
    </Link>
  );
}
