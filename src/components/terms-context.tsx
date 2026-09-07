"use client";
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";

/**
 * Словарь терминов для клиентских компонентов. Серверные страницы получают его
 * напрямую через getTerms(); здесь он раздаётся через контекст, чтобы кнопки и
 * формы не тянули термины пропсами через всё дерево.
 */
const TermsContext = createContext<Terms>(DEFAULT_TERMS);

export function TermsProvider({ terms, children }: { terms: Terms; children: ReactNode }) {
  return <TermsContext.Provider value={terms}>{children}</TermsContext.Provider>;
}

export function useTerms(): Terms {
  return useContext(TermsContext);
}
