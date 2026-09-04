import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/page-auth";
import { PageHeader } from "@/components/ui";
import { listTicketTypes, listPriorities, listCategories, listMeasureUnits, listWorkCatalog, listWarehousesDict } from "@/lib/services/directories";
import { WAREHOUSE_KIND_LABELS } from "@/lib/labels";
import { DirectoryManager, type DictField, type DictRow } from "../DirectoryManager";

export const dynamic = "force-dynamic";

/** Описание простых справочников (роли живут на отдельной странице — там редактор прав). */
const DICTS: Record<
  string,
  {
    title: string;
    subtitle: string;
    usageLabel: string;
    codeHint?: string;
    extraFields?: DictField[];
    importEntity?: string;
    load: () => Promise<DictRow[]>;
    /** Динамические поля (зависят от данных). */
    fieldsFor?: (rows: DictRow[]) => DictField[];
  }
> = {
  "ticket-types": {
    title: "Типы работ",
    subtitle: "Подставляются в поле «Тип работ» при создании и редактировании заявки",
    usageLabel: "Заявок",
    importEntity: "ticket-types",
    load: () => listTicketTypes() as Promise<DictRow[]>,
  },
  priorities: {
    title: "Приоритеты и SLA",
    subtitle: "Срок исполнения подставляется в заявку автоматически, если он не задан вручную",
    usageLabel: "Заявок",
    extraFields: [
      { name: "slaHours", label: "SLA, часов", type: "number", hint: "срок по умолчанию от момента создания" },
      { name: "colorClass", label: "CSS-классы подсветки", placeholder: "text-rose-600 font-bold", hint: "классы Tailwind для выделения в списках" },
    ],
    importEntity: "priorities",
    load: () => listPriorities() as Promise<DictRow[]>,
  },
  categories: {
    title: "Категории (папки товаров)",
    subtitle: "Иерархические группы товаров, как в 1С: папка может быть вложена в другую",
    usageLabel: "Товаров",
    importEntity: "categories",
    load: () => listCategories() as Promise<DictRow[]>,
    fieldsFor: (rows) => {
      const path = (id: number | null): string => { const c = rows.find((r) => r.id === id); if (!c) return ""; const p = path((c.parentId as number | null) ?? null); return p ? `${p} / ${c.name}` : c.name; };
      return [{ name: "parentId", label: "Родительская папка", type: "select", numeric: true, nullable: true, options: rows.map((r) => ({ value: r.id, label: path(r.id) })).sort((a, b) => a.label.localeCompare(b.label, "ru")) }];
    },
  },
  works: {
    title: "Справочник работ",
    subtitle: "Виды работ/услуг — подставляются в акт выполненных работ по заявке",
    usageLabel: "В актах",
    importEntity: "works",
    extraFields: [
      { name: "unit", label: "Ед. изм.", placeholder: "шт" },
      { name: "defaultMinutes", label: "Норматив, мин", type: "number" },
      { name: "price", label: "Цена", type: "number" },
    ],
    load: () => listWorkCatalog() as unknown as Promise<DictRow[]>,
  },
  warehouses: {
    title: "Склады",
    subtitle: "Центральный и транзитный склады, а также склады-автомобили создаются автоматически; здесь добавляют дополнительные",
    usageLabel: "Позиций/единиц",
    importEntity: "warehouses",
    extraFields: [
      { name: "kind", label: "Вид склада", type: "select", options: Object.entries(WAREHOUSE_KIND_LABELS).filter(([k]) => !["team", "central", "vehicle"].includes(k)).map(([value, label]) => ({ value, label })) },
      { name: "address", label: "Адрес" },
    ],
    load: () => listWarehousesDict() as unknown as Promise<DictRow[]>,
  },
  "measure-units": {
    title: "Единицы измерения",
    subtitle: "Используются в справочнике товаров и в актах выполненных работ",
    usageLabel: "Товаров",
    importEntity: "measure-units",
    extraFields: [{ name: "symbol", label: "Обозначение", required: true, placeholder: "шт", hint: "как показывается в интерфейсе: шт, м, компл" }],
    load: () => listMeasureUnits() as Promise<DictRow[]>,
  },
};

export default async function DictionaryPage({ params }: { params: Promise<{ dict: string }> }) {
  await requireUser(["directories.manage"]);
  const { dict } = await params;
  const spec = DICTS[dict];
  if (!spec) notFound();
  const rows = await spec.load();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={spec.title}
        subtitle={spec.subtitle}
        action={<Link href="/directories" className="text-sm text-indigo-600">← Все справочники</Link>}
      />
      <DirectoryManager
        dict={dict}
        rows={rows}
        extraFields={[...(spec.extraFields ?? []), ...(spec.fieldsFor?.(rows) ?? [])]}
        usageLabel={spec.usageLabel}
        codeHint={spec.codeHint}
        importEntity={spec.importEntity}
      />
    </div>
  );
}
