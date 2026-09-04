"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { Card, inputCls, btnCls } from "@/components/ui";
import { fmtDate } from "@/lib/labels";

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

/**
 * Обсуждение заявки: диспетчер, бригада и склад в одной ленте.
 * Новые сообщения подтягиваются опросом по afterId — без веб-сокетов,
 * чтобы приложение оставалось self-hosted-простым.
 */
export function TicketChat({ ticketId, initial, canWrite, canInternal, readOnly }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(canInternal);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
      // молча: опрос повторится, чтобы не сыпать ошибками в фоне
    }
  }, [ticketId]);

  useEffect(() => {
    const timer = setInterval(pull, POLL_MS);
    // Возврат на вкладку — сразу проверяем, что пришло, не дожидаясь тика.
    const onVisible = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pull]);

  useEffect(scrollToEnd, [messages.length, scrollToEnd]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setBusy(true); setErr(null);
    try {
      await api(`/tickets/${ticketId}/chat`, { method: "POST", json: { text: value, isInternal: canInternal ? internal : false } });
      setText("");
      await pull();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить сообщение?")) return;
    try {
      await api(`/tickets/${ticketId}/chat/${id}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card title={`Обсуждение заявки${messages.length ? ` (${messages.length})` : ""}`}>
      <div ref={listRef} className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Сообщений пока нет. Напишите первым.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.own ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                m.own ? "bg-indigo-600 text-white" : m.isInternal ? "bg-slate-100 text-slate-900" : "bg-emerald-50 text-slate-900"
              }`}
            >
              <div className={`flex items-center gap-2 text-[11px] ${m.own ? "text-indigo-100" : "text-slate-500"}`}>
                <span className="font-medium">{m.authorName}</span>
                {m.authorRole && <span>· {m.authorRole}</span>}
                {!m.isInternal && <span className={m.own ? "text-emerald-100" : "text-emerald-700"}>· виден клиенту</span>}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</p>
              <div className={`mt-0.5 flex items-center gap-2 text-[10px] ${m.own ? "text-indigo-200" : "text-slate-400"}`}>
                <span>{fmtDate(m.createdAt)}</span>
                {m.editedAt && <span>· изменено</span>}
                {m.canDelete && (
                  <button onClick={() => remove(m.id)} className={`hover:underline ${m.own ? "text-indigo-100" : "text-rose-500"}`}>
                    удалить
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {err && <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {readOnly ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Заявка завершена — обсуждение закрыто.</p>
      ) : canWrite ? (
        <form onSubmit={send} className="mt-3 space-y-2">
          <textarea
            className={inputCls}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Сообщение бригаде или диспетчеру…"
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter — привычная отправка, Enter оставляет перенос строки.
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
          />
          <div className="flex items-center justify-between gap-2">
            {canInternal ? (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4" />
                Внутреннее (клиент не увидит)
              </label>
            ) : (
              <span className="text-xs text-slate-400">Сообщение увидят сотрудники по заявке</span>
            )}
            <button className={btnCls} disabled={busy || !text.trim()}>{busy ? "…" : "Отправить"}</button>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-400">У вашей роли нет права писать в чат.</p>
      )}
    </Card>
  );
}
