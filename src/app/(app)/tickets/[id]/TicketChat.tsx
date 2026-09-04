"use client";
/* eslint-disable @next/next/no-img-element -- превью вложений: blob-URL выбранных файлов
   и приватные файлы из /api/v1/files/[id] с проверкой доступа. Оптимизатор next/image
   не работает с blob: и не должен кэшировать файлы, закрытые правами доступа. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { Card, inputCls, btnCls } from "@/components/ui";
import { fmtDate, fmtBytes } from "@/lib/labels";

export type Attachment = { id: number; name: string; size: number; mimeType: string; kind: "image" | "video" | "audio" | "pdf" | "file"; url: string; downloadUrl: string };

export type ChatMessage = {
  id: number;
  authorId: number | null;
  authorName: string;
  authorRole: string | null;
  text: string;
  isInternal: boolean;
  editedAt: string | null;
  createdAt: string;
  own: boolean;
  canDelete: boolean;
  attachments: Attachment[];
};

type Props = {
  ticketId: number;
  initial: ChatMessage[];
  canWrite: boolean;
  canInternal: boolean;
  /** Заявка завершена — лента только для чтения. */
  readOnly?: boolean;
};

const POLL_MS = 7000;
const MAX_FILES = 10;

const KIND_ICON: Record<Attachment["kind"], string> = { image: "🖼", video: "🎬", audio: "🎵", pdf: "📄", file: "📎" };

/**
 * Обсуждение заявки: диспетчер, бригада и склад в одной ленте.
 * Вложения: изображения и видео показываются в ленте, любой файл можно скачать.
 * Новые сообщения подтягиваются опросом по afterId — без веб-сокетов.
 */
export function TicketChat({ ticketId, initial, canWrite, canInternal, readOnly }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(canInternal);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Attachment | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastIdRef = useRef<number>(initial.at(-1)?.id ?? 0);

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const pull = useCallback(async () => {
    try {
      const fresh = await api<ChatMessage[]>(`/tickets/${ticketId}/chat?afterId=${lastIdRef.current}`);
      if (fresh.length) {
        lastIdRef.current = fresh.at(-1)!.id;
        setMessages((prev) => [...prev, ...fresh]);
      }
    } catch {
      // молча: опрос повторится
    }
  }, [ticketId]);

  useEffect(() => {
    const timer = setInterval(pull, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [pull]);

  useEffect(scrollToEnd, [messages.length, scrollToEnd]);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_FILES));
  }

  /** Отправка через XHR — чтобы показывать прогресс загрузки крупных файлов. */
  function uploadWithProgress(fd: FormData) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/v1/tickets/${ticketId}/attachments`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText) as { ok: boolean; error?: { message: string } };
          if (xhr.status >= 200 && xhr.status < 300 && body.ok) resolve(); else reject(new Error(body.error?.message ?? `Ошибка ${xhr.status}`));
        } catch { reject(new Error(`Ошибка ${xhr.status}`)); }
      };
      xhr.onerror = () => reject(new Error("Сетевая ошибка при загрузке"));
      xhr.send(fd);
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value && !files.length) return;
    setBusy(true); setErr(null);
    try {
      if (files.length) {
        const fd = new FormData();
        fd.set("text", value);
        fd.set("isInternal", String(canInternal ? internal : false));
        for (const f of files) fd.append("files", f, f.name);
        setProgress(0);
        await uploadWithProgress(fd);
      } else {
        await api(`/tickets/${ticketId}/chat`, { method: "POST", json: { text: value, isInternal: canInternal ? internal : false } });
      }
      setText(""); setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      await pull();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить сообщение вместе с вложениями?")) return;
    try {
      await api(`/tickets/${ticketId}/chat/${id}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const filesTotal = messages.reduce((a, m) => a + m.attachments.length, 0);

  return (
    <Card title={<>Обсуждение заявки{messages.length ? ` (${messages.length})` : ""}{filesTotal ? <span className="ml-2 text-xs font-normal text-slate-500">📎 {filesTotal}</span> : null}</>}>
      <div ref={listRef} className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Сообщений пока нет. Напишите первым.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.own ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.own ? "bg-indigo-600 text-white" : m.isInternal ? "bg-slate-100 text-slate-900" : "bg-emerald-50 text-slate-900"}`}>
              <div className={`flex items-center gap-2 text-[11px] ${m.own ? "text-indigo-100" : "text-slate-500"}`}>
                <span className="font-medium">{m.authorName}</span>
                {m.authorRole && <span>· {m.authorRole}</span>}
                {!m.isInternal && <span className={m.own ? "text-emerald-100" : "text-emerald-700"}>· виден клиенту</span>}
              </div>
              {m.text && <p className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</p>}
              {m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <AttachmentView key={a.id} a={a} own={m.own} onOpen={() => setViewer(a)} />
                  ))}
                </div>
              )}
              <div className={`mt-0.5 flex items-center gap-2 text-[10px] ${m.own ? "text-indigo-200" : "text-slate-400"}`}>
                <span>{fmtDate(m.createdAt)}</span>
                {m.editedAt && <span>· изменено</span>}
                {m.canDelete && <button onClick={() => remove(m.id)} className={`hover:underline ${m.own ? "text-indigo-100" : "text-rose-500"}`}>удалить</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {err && <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {readOnly ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Заявка завершена — обсуждение закрыто.</p>
      ) : canWrite ? (
        <form
          onSubmit={send}
          className="mt-3 space-y-2"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <textarea
            className={inputCls}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Сообщение… (файлы можно перетащить сюда или вставить из буфера)"
            onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
                  {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt="" className="h-8 w-8 rounded object-cover" /> : <span>📎</span>}
                  <span className="max-w-[10rem] truncate">{f.name}</span>
                  <span className="text-slate-400">{fmtBytes(f.size)}</span>
                  <button type="button" className="text-rose-500" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
          {progress !== null && <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                📎 Файл
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 lg:hidden">
                📷 Фото
                <input type="file" accept="image/*,video/*" capture="environment" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              {canInternal ? (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4" />
                  Внутреннее (клиент не увидит)
                </label>
              ) : (
                <span className="text-xs text-slate-400">Сообщение увидят сотрудники по заявке</span>
              )}
            </div>
            <button className={btnCls} disabled={busy || (!text.trim() && !files.length)}>{busy ? (progress !== null ? `${progress}%` : "…") : "Отправить"}</button>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-400">У вашей роли нет права писать в чат.</p>
      )}

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setViewer(null)}>
          <div className="absolute right-4 top-4 flex items-center gap-3 text-sm text-white">
            <a href={viewer.downloadUrl} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={(e) => e.stopPropagation()}>⬇ Скачать</a>
            <button className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" onClick={() => setViewer(null)}>✕ Закрыть</button>
          </div>
          <div className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {viewer.kind === "image" && <img src={viewer.url} alt={viewer.name} className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain" />}
            {viewer.kind === "video" && <video src={viewer.url} controls autoPlay className="max-h-[90vh] max-w-[95vw] rounded-lg" />}
            {viewer.kind === "audio" && <audio src={viewer.url} controls autoPlay className="w-[min(90vw,32rem)]" />}
            {viewer.kind === "pdf" && <iframe src={viewer.url} title={viewer.name} sandbox="" className="h-[90vh] w-[95vw] rounded-lg bg-white" />}
            <div className="mt-2 text-center text-xs text-slate-300">{viewer.name} · {fmtBytes(viewer.size)}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AttachmentView({ a, own, onOpen }: { a: Attachment; own: boolean; onOpen: () => void }) {
  if (a.kind === "image") {
    return (
      <button type="button" onClick={onOpen} className="group relative overflow-hidden rounded-xl border border-black/10 bg-black/5" title={`${a.name} · ${fmtBytes(a.size)}`}>
        <img src={a.url} alt={a.name} loading="lazy" className="h-28 w-28 object-cover transition group-hover:scale-105 sm:h-36 sm:w-36" />
      </button>
    );
  }
  if (a.kind === "video") {
    return (
      <div className="w-full max-w-xs overflow-hidden rounded-xl border border-black/10 bg-black">
        <video src={a.url} controls preload="metadata" className="max-h-56 w-full" />
        <div className="flex items-center justify-between bg-black/70 px-2 py-1 text-[10px] text-white"><span className="truncate">{a.name}</span><a href={a.downloadUrl} className="ml-2 shrink-0 hover:underline">⬇ {fmtBytes(a.size)}</a></div>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-xs ${own ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-800"}`}>
      <span className="text-base">{KIND_ICON[a.kind]}</span>
      <div className="min-w-0">
        <div className="max-w-[12rem] truncate font-medium">{a.name}</div>
        <div className={own ? "text-indigo-100" : "text-slate-400"}>{fmtBytes(a.size)}</div>
      </div>
      {(a.kind === "audio" || a.kind === "pdf") && <button type="button" onClick={onOpen} className="ml-1 rounded-lg px-1.5 py-0.5 hover:underline">открыть</button>}
      <a href={a.downloadUrl} className="ml-1 rounded-lg px-1.5 py-0.5 hover:underline">⬇</a>
    </div>
  );
}
