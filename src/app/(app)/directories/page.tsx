import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { PageHeader, Card } from "@/components/ui";
import { listTicketTypes, listPriorities, listCategories, listMeasureUnits, listRoles } from "@/lib/services/directories";

export const dynamic = "force-dynamic";

export default async function DirectoriesPage() {
  await requireUser(["directories.manage"]);
  const [types, priorities, categories, units, roles] = await Promise.all([
    listTicketTypes(), listPriorities(), listCategories(), listMeasureUnits(), listRoles(),
  ]);

  const sections = [
    { href: "/directories/ticket-types", title: "Типы работ", icon: "🛠", count: types.length, text: "Монтаж, ТО, ремонт, обследование — подставляются в форму заявки." },
    { href: "/directories/priorities", title: "Приоритеты и SLA", icon: "⏱", count: priorities.length, text: "Приоритеты заявок и срок исполнения в часах по умолчанию." },
    { href: "/directories/categories", title: "Категории оборудования", icon: "📦", count: categories.length, text: "Группировка номенклатуры: камеры, контроллеры, кабель…" },
    { href: "/directories/measure-units", title: "Единицы измерения", icon: "📏", count: units.length, text: "шт, м, комплект — используются в номенклатуре и работах." },
    { href: "/directories/roles", title: "Роли и права", icon: "🔑", count: roles.length, text: "Наборы прав и область видимости данных для сотрудников." },
  ];

  return (
    <div>
      <PageHeader
        title="Справочники"
        subtitle="Списки, из которых заполняются формы. Добавляйте свои записи — они сразу появятся в выпадающих списках."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="block transition hover:-translate-y-0.5">
            <Card>
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none">{s.icon}</span>
                <div>
                  <div className="font-semibold text-slate-900">{s.title}</div>
                  <p className="mt-0.5 text-sm text-slate-500">{s.text}</p>
                  <div className="mt-2 text-xs text-indigo-600">{s.count} записей · открыть →</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Статусы заявок в справочники не вынесены намеренно: на них завязан автомат переходов
        (см. <span className="font-mono">docs/07-business-processes.md</span>), поэтому их набор задан в коде.
      </p>
    </div>
  );
}
