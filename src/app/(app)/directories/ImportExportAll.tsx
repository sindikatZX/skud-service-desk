"use client";
import { useState } from "react";
import { Card, btnSecondaryCls } from "@/components/ui";
import { CsvImport } from "@/components/CsvImport";

const ENTITIES: { entity: string; title: string }[] = [
  { entity: "catalog", title: "Товары (номенклатура)" },
  { entity: "categories", title: "Категории товаров" },
  { entity: "measure-units", title: "Единицы измерения" },
  { entity: "ticket-types", title: "Типы работ" },
  { entity: "priorities", title: "Приоритеты и SLA" },
  { entity: "works", title: "Справочник работ" },
  { entity: "warehouses", title: "Склады" },
  { entity: "clients", title: "Клиенты" },
  { entity: "sites", title: "Объекты" },
  { entity: "teams", title: "Бригады" },
  { entity: "vehicles", title: "Автопарк" },
  { entity: "employees", title: "Сотрудники" },
  { entity: "roles", title: "Роли и права" },
];

/** Импорт/экспорт CSV для каждого справочника (с шаблоном) в одном месте. */
export function ImportExportAll() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Импорт и экспорт справочников (CSV)" className="mt-6">
      <p className="mb-3 text-sm text-slate-600">Экспорт выгружает справочник с колонкой «Код»; тот же файл после правок можно загрузить обратно — записи сопоставятся по коду и будут перезаписаны, новые строки без кода создадутся.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ENTITIES.map((e) => (
          <div key={e.entity} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <span className="font-medium">{e.title}</span>
            <span className="flex items-center gap-2 text-xs">
              <a href={`/api/v1/import/${e.entity}?template=1`} className="text-slate-500 hover:underline">шаблон</a>
              <a href={`/api/v1/import/${e.entity}?export=1`} className="text-indigo-600 hover:underline" download>экспорт</a>
              <button type="button" className={`${btnSecondaryCls} min-h-[1.75rem] px-2 py-0.5 text-xs`} onClick={() => setOpen(open === e.entity ? null : e.entity)}>{open === e.entity ? "закрыть" : "импорт"}</button>
            </span>
          </div>
        ))}
      </div>
      {open && <div className="mt-3"><CsvImport entity={open} onDone={() => undefined} /></div>}
    </Card>
  );
}
