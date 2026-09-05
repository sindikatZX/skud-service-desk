"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls, btnSecondaryCls } from "@/components/ui";
import { BrandLogo } from "@/components/BrandLogo";
import type { Branding } from "@/lib/services/branding";

/**
 * Оформление приложения — по образцу «Тема оформления» Nextcloud: название, слоган,
 * основной цвет (палитра готовых цветов + произвольный), логотип и фон страницы входа.
 * Изображения уменьшаются в браузере (canvas) и отправляются как data-URL — без
 * отдельного файлового хранилища.
 */
type Props = { branding: Branding; presets: { name: string; color: string }[] };

async function fileToDataUrl(file: File, maxSide: number): Promise<string> {
  if (file.type === "image/svg+xml") {
    if (file.size > 300 * 1024) throw new Error("SVG больше 300 КБ");
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Не удалось прочитать файл")); r.readAsDataURL(file); });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Файл не является изображением")); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    // PNG сохраняет прозрачность логотипа; для фотографий фона — JPEG
    return maxSide > 600 ? c.toDataURL("image/jpeg", 0.82) : c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandingPanel({ branding, presets }: Props) {
  const router = useRouter();
  const [appName, setAppName] = useState(branding.appName);
  const [tagline, setTagline] = useState(branding.tagline);
  const [color, setColor] = useState(branding.primaryColor);
  const [logo, setLogo] = useState<string | null>(branding.logoDataUrl);
  const [bg, setBg] = useState<string | null>(branding.loginBgDataUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);

  const dirty = appName !== branding.appName || tagline !== branding.tagline || color !== branding.primaryColor || logo !== branding.logoDataUrl || bg !== branding.loginBgDataUrl;

  async function pick(input: HTMLInputElement | null, maxSide: number, set: (v: string) => void) {
    const f = input?.files?.[0];
    if (!f) return;
    setMsg(null);
    try { set(await fileToDataUrl(f, maxSide)); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { if (input) input.value = ""; }
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api("/admin/branding", { method: "PATCH", json: { appName, tagline, primaryColor: color, logoDataUrl: logo, loginBgDataUrl: bg } });
      setMsg({ ok: true, text: "Оформление сохранено" });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!window.confirm("Вернуть стандартное оформление (название, цвет, логотип)?")) return;
    setBusy(true); setMsg(null);
    try {
      const b = await api<Branding>("/admin/branding", { method: "DELETE" });
      setAppName(b.appName); setTagline(b.tagline); setColor(b.primaryColor); setLogo(b.logoDataUrl); setBg(b.loginBgDataUrl);
      setMsg({ ok: true, text: "Стандартное оформление восстановлено" });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Оформление" action={<span className="text-xs text-slate-500">название · цвет · логотип</span>}>
      <p className="mb-3 text-sm text-slate-600">Название и логотип показываются в шапке, на странице входа, во вкладке браузера и в установленном приложении; основной цвет перекрашивает кнопки, ссылки и активные элементы меню.</p>
      {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Наименование" hint="до 60 символов, сейчас в шапке">
              <input value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={60} className={inputCls} placeholder="СКУД•Сервис" />
            </Field>
            <Field label="Слоган / подпись" hint="строка под названием (можно оставить пустой)">
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} className={inputCls} placeholder="Service Desk / FSM" />
            </Field>
          </div>

          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Основной цвет</div>
            <div className="flex flex-wrap items-center gap-2">
              {presets.map((p) => (
                <button key={p.color} type="button" title={p.name} onClick={() => setColor(p.color)} className={`h-8 w-8 rounded-full border-2 transition ${color.toLowerCase() === p.color ? "scale-110 border-slate-900" : "border-white shadow"}`} style={{ background: p.color }} aria-label={p.name} />
              ))}
              <label className="ml-2 inline-flex items-center gap-2 text-sm">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5" />
                <input value={color} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setColor(e.target.value)} className={`${inputCls} w-28 font-mono`} />
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Логотип</div>
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 place-items-center rounded-2xl border border-slate-200 bg-slate-50"><BrandLogo src={logo} size={48} className="rounded-xl" /></div>
                <div className="flex flex-col gap-1">
                  <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={() => pick(logoRef.current, 256, setLogo)} />
                  <button type="button" className={btnSecondaryCls} onClick={() => logoRef.current?.click()}>Загрузить…</button>
                  {logo && <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setLogo(null)}>убрать логотип</button>}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">PNG/SVG с прозрачным фоном, квадратный; уменьшается до 256 px.</div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Фон страницы входа</div>
              <div className="flex items-center gap-3">
                <div className="h-16 w-24 overflow-hidden rounded-xl border border-slate-200" style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: `linear-gradient(135deg, ${color}, #0f172a)` }} />
                <div className="flex flex-col gap-1">
                  <input ref={bgRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={() => pick(bgRef.current, 1600, setBg)} />
                  <button type="button" className={btnSecondaryCls} onClick={() => bgRef.current?.click()}>Загрузить…</button>
                  {bg && <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setBg(null)}>убрать (градиент из цвета)</button>}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">JPEG/PNG, уменьшается до 1600 px по большей стороне.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className={btnCls} disabled={busy || !dirty || !appName.trim()} onClick={save}>{busy ? "Сохранение…" : "Сохранить оформление"}</button>
            <button type="button" className={btnSecondaryCls} disabled={busy} onClick={reset}>Стандартное оформление</button>
            {dirty && <span className="text-xs text-amber-700">есть несохранённые изменения</span>}
          </div>
        </div>

        {/* Предпросмотр: как будет выглядеть шапка и кнопка */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3" style={{ ["--brand" as string]: color }}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Предпросмотр</div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
              <BrandLogo src={logo} size={28} className="rounded-lg" />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-indigo-700">{appName || "Название"}</div>
                {tagline && <div className="truncate text-[10px] text-slate-500">{tagline}</div>}
              </div>
            </div>
            <div className="space-y-1 p-2 text-xs">
              <div className="rounded-lg bg-indigo-50 px-2 py-1 font-medium text-indigo-700">Заявки</div>
              <div className="px-2 py-1 text-slate-600">Клиенты</div>
              <div className="px-2 py-1 text-slate-600">Склад</div>
              <button type="button" className="mt-1 w-full rounded-lg bg-indigo-600 px-2 py-1.5 font-semibold text-white">Кнопка</button>
            </div>
          </div>
          <div className="mt-2 h-14 rounded-xl" style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: `linear-gradient(135deg, ${color}, #0f172a)` }} />
        </div>
      </div>
    </Card>
  );
}
