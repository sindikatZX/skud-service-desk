import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/page-auth";
import { PageHeader } from "@/components/ui";
import { listTicketTypes, listPriorities, listCategories, listMeasureUnits } from "@/lib/services/directories";
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
    load: () => Promise<DictRow[]>;
  }
> = {
  "ticket-types": {
    title: "Типы работ",
    subtitle: "Подставляются в поле «Тип работ» при создании и редактировании заявки",
    usageLabel: "Заявок",
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
    load: () => listPriorities() as Promise<DictRow[]>,
  },
  categories: {
    title: "Категории оборудования",
    subtitle: "Группировка номенклатуры на складе и в отчётах",
    usageLabel: "Позиций",
    load: () => listCategories() as Promise<DictRow[]>,
  },
  "measure-units": {
    title: "Единицы измерения",
    subtitle: "Используются в номенклатуре и в актах выполненных работ",
    usageLabel: "Позиций",
    codeHint: "как показывается в интерфейсе: шт, м, компл",
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
        extraFields={spec.extraFields}
        usageLabel={spec.usageLabel}
        codeHint={spec.codeHint}
      />
    </div>
  );
}
