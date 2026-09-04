/** Убирает цены из ответа, если у пользователя нет права их видеть (монтажники и клиенты — никогда). */
export function stripPrices<T extends { price?: string | null; priceUpdatedAt?: Date | null }>(rows: T[], allowed: boolean): T[] {
  if (allowed) return rows;
  return rows.map((r) => ({ ...r, price: null, priceUpdatedAt: null }));
}

export function fmtMoney(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}
