"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls, btnSecondaryCls, FormMessage, FormActions, Badge } from "@/components/ui";
import { MODULES, PRESETS, withDependencies, dependents, MODULE_BY_ID, type ModuleId } from "@/lib/modules";

/**
 * Мастер настройки установки: как называется система, чем она занимается
 * и какие модули включены. Итог сохраняется в конфигурацию установки, а интерфейс
 * (навигация, доступные разделы, названия) собирается уже по ней.
 */
export function SetupWizard({
  initial,
  appName,
}: {
  initial: { preset: string; enabledModules: ModuleId[]; configured: boolean };
  appName: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(appName);
  const [preset, setPreset] = useState(initial.preset);
  const [modules, setModules] = useState<ModuleId[]>(initial.enabledModules);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const optional = useMemo(() => MODULES.filter((m) => !m.core), []);
  const core = useMemo(() => MODULES.filter((m) => m.core), []);
  const effective = useMemo(() => withDependencies(modules), [modules]);

  function choosePreset(id: string) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p && id !== "custom") setModules(withDependencies(p.modules));
  }

  function toggle(id: ModuleId) {
    setModules((cur) => {
      if (cur.includes(id)) {
        // Выключая модуль, выключаем и те, что без него не работают
        const broken = dependents(id).filter((d) => cur.includes(d));
        return withDependencies(cur.filter((m) => m !== id && !broken.includes(m)));
      }
      return withDependencies([...cur, id]);
    });
    setPreset("custom");
  }

  async function save(finish: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const p = PRESETS.find((x) => x.id === preset);
      await api("/setup", {
        method: "POST",
        json: { preset, enabledModules: effective, labels: p?.labels ?? {}, appName: name, configured: finish || initial.configured },
      });
      setMsg({ ok: true, text: finish ? "Система настроена" : "Настройки сохранены" });
      router.refresh();
      if (finish) router.push("/");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const steps = ["Система", "Модули", "Проверка"];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`rounded-xl px-3 py-1.5 font-medium ${i === step ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card title="Название и род занятий">
          <div className="max-w-md">
            <Field label="Название системы" hint="Показывается в шапке, на входе и в установленном приложении">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="СКУД•Сервис" />
            </Field>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-slate-700">Род занятий</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePreset(p.id)}
                  className={`rounded-2xl border p-3 text-left ${preset === p.id ? "border-indigo-600 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
          <FormActions className="mt-4">
            <button className={btnCls} onClick={() => setStep(1)}>Дальше: модули</button>
          </FormActions>
        </Card>
      )}

      {step === 1 && (
        <Card title="Что входит в систему" action={<span className="text-xs text-slate-500">Отметьте нужное</span>}>
          <div className="space-y-2">
            {optional.map((m) => {
              const checked = effective.includes(m.id);
              const forced = checked && !modules.includes(m.id);
              return (
                <label key={m.id} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${checked ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} onChange={() => toggle(m.id)} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{m.name}</span>
                      {m.requires?.map((r) => <Badge key={r} tone="slate">нужен «{MODULE_BY_ID.get(r)?.name}»</Badge>)}
                      {forced && <Badge tone="amber">включён как зависимость</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{m.description}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">Разделы: {m.sections.join(", ")}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Всегда включены</div>
            <div className="mt-1 text-xs text-slate-600">{core.map((m) => m.name).join(" · ")} — без них система не работает.</div>
          </div>
          <FormActions className="mt-4">
            <button className={btnSecondaryCls} onClick={() => setStep(0)}>Назад</button>
            <button className={btnCls} onClick={() => setStep(2)}>Дальше: проверка</button>
          </FormActions>
        </Card>
      )}

      {step === 2 && (
        <Card title="Проверьте настройку">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Название системы</dt><dd className="font-medium">{name || "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Род занятий</dt><dd className="font-medium">{PRESETS.find((p) => p.id === preset)?.name}</dd></div>
            <div><dt className="text-xs text-slate-500">Модулей включено</dt><dd className="font-medium">{effective.length} из {MODULES.length}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MODULES.map((m) => (
              <Badge key={m.id} tone={effective.includes(m.id) ? "green" : "slate"}>{m.name}{effective.includes(m.id) ? "" : " — выключен"}</Badge>
            ))}
          </div>
          {msg && <div className="mt-3"><FormMessage ok={msg.ok} onHide={() => setMsg(null)}>{msg.text}</FormMessage></div>}
          <FormActions className="mt-4">
            <button className={btnSecondaryCls} onClick={() => setStep(1)}>Назад</button>
            <button className={btnCls} disabled={busy} onClick={() => save(true)}>{busy ? "Сохранение…" : initial.configured ? "Сохранить настройку" : "Завершить настройку"}</button>
          </FormActions>
          <p className="mt-2 text-xs text-slate-500">
            Настройку можно изменить позже: «Администрирование → Модули и назначение системы». Выключенный модуль
            только скрывается — данные остаются в базе и вернутся, если включить его снова.
          </p>
        </Card>
      )}
    </div>
  );
}
