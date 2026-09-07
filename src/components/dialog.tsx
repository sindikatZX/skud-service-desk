"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { btnCls, btnSecondaryCls, btnDangerCls } from "@/components/ui";

/**
 * Модальные окна приложения.
 *
 * Системные `window.confirm`/`alert` намеренно не используются: в установленном PWA они
 * выглядят чужеродно (браузерный диалог поверх приложения) и не поддаются оформлению —
 * та же причина, по которой раньше убрали `alert()` из кнопок действий.
 */

/** Оверлей с панелью: Esc и клик по фону закрывают, фон не прокручивается. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  labelledBy = "modal-title",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    // Фокус уходит в окно, чтобы клавиатура работала внутри диалога, а не под ним
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus() ?? panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={title ? labelledBy : undefined}>
      <button type="button" aria-label="Закрыть" className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl outline-none sm:max-w-md sm:rounded-2xl sm:p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        {title && <h2 id={labelledBy} className="mb-2 text-base font-semibold text-slate-900">{title}</h2>}
        <div className="text-sm text-slate-700">{children}</div>
        {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export type ConfirmOptions = {
  title?: string;
  /** Пояснение: чем именно обернётся подтверждение. */
  text?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Для необратимых действий — красная кнопка подтверждения. */
  danger?: boolean;
};

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Провайдер подтверждений: держит единственный диалог на всё приложение.
 * Благодаря этому компоненту-инициатору не нужно отрисовывать окно у себя —
 * достаточно вызвать `confirm()` и дождаться ответа.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((options = {}) => new Promise<boolean>((resolve) => setState({ options, resolve })), []);

  const close = useCallback((value: boolean) => {
    setState((s) => {
      s?.resolve(value);
      return null;
    });
  }, []);

  const o = state?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={o?.title ?? "Подтвердите действие"}
        footer={
          <>
            <button type="button" className={btnSecondaryCls} onClick={() => close(false)}>
              {o?.cancelLabel ?? "Отмена"}
            </button>
            <button type="button" data-autofocus className={o?.danger ? btnDangerCls : btnCls} onClick={() => close(true)}>
              {o?.confirmLabel ?? "Подтвердить"}
            </button>
          </>
        }
      >
        {o?.text && <p className="whitespace-pre-line">{o.text}</p>}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Подтверждение действия. Вне провайдера (например, на экране входа) возвращается
 * к системному диалогу — чтобы действие не осталось без подтверждения вовсе.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (ctx) return ctx;
  // Вне провайдера (редкий случай) не оставляем действие без подтверждения вовсе
  return async (options: ConfirmOptions = {}) => {
    if (typeof window === "undefined") return true;
    const text = typeof options.text === "string" ? options.text : "";
    return window.confirm([options.title, text].filter(Boolean).join(" ") || "Подтвердите действие");
  };
}

