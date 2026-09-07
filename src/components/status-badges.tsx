import { MappedBadge } from "@/components/ui";
import { STATUS_COLORS, STATUS_LABELS, UNIT_STATUS_COLORS, UNIT_STATUS_LABELS } from "@/lib/labels";

/**
 * Бейджи предметной области сервисного модуля: статус заявки и статус складской единицы.
 * Вынесены из общего набора примитивов: другой модуль платформы (например, учёт товаров
 * или запись клиентов) опишет свои словари и соберёт бейджи тем же MappedBadge.
 */

export function StatusBadge({ status }: { status: string }) {
  return <MappedBadge value={status} labels={STATUS_LABELS} colors={STATUS_COLORS} />;
}

export function UnitStatusBadge({ status }: { status: string }) {
  return <MappedBadge value={status} labels={UNIT_STATUS_LABELS} colors={UNIT_STATUS_COLORS} />;
}
