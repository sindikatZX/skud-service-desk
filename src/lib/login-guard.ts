/**
 * Защита входа от перебора пароля.
 *
 * Счётчик неудачных попыток держится в памяти процесса: для self-hosted установки
 * с одним контейнером этого достаточно, а внешнего хранилища (Redis) не требуется.
 * Ключ — пара «email + адрес клиента»: так перебор одного пароля по многим учётным
 * записям и перебор многих паролей к одной блокируются одинаково, а честный
 * пользователь с соседнего адреса не страдает из-за чужих попыток.
 *
 * После успешного входа счётчик обнуляется.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

type Entry = { fails: number; first: number; blockedUntil: number };
const attempts = new Map<string, Entry>();

function keyOf(email: string, ip: string | null) {
  return `${email.toLowerCase()}|${ip ?? "?"}`;
}

/** Периодическая уборка, чтобы карта не росла бесконечно. */
function sweep(now: number) {
  if (attempts.size < 500) return;
  for (const [k, e] of attempts) {
    if (now - e.first > WINDOW_MS && now > e.blockedUntil) attempts.delete(k);
  }
}

/** Сколько секунд ждать, если вход временно заблокирован (0 — можно пробовать). */
export function loginBlockedFor(email: string, ip: string | null): number {
  const e = attempts.get(keyOf(email, ip));
  if (!e) return 0;
  const now = Date.now();
  return e.blockedUntil > now ? Math.ceil((e.blockedUntil - now) / 1000) : 0;
}

export function registerFailedLogin(email: string, ip: string | null) {
  const now = Date.now();
  sweep(now);
  const key = keyOf(email, ip);
  const e = attempts.get(key);
  if (!e || now - e.first > WINDOW_MS) {
    attempts.set(key, { fails: 1, first: now, blockedUntil: 0 });
    return;
  }
  e.fails += 1;
  if (e.fails >= MAX_ATTEMPTS) {
    e.blockedUntil = now + BLOCK_MS;
    e.fails = 0;
    e.first = now;
  }
}

export function clearLoginAttempts(email: string, ip: string | null) {
  attempts.delete(keyOf(email, ip));
}

export const LOGIN_LIMITS = { MAX_ATTEMPTS, WINDOW_MINUTES: WINDOW_MS / 60000, BLOCK_MINUTES: BLOCK_MS / 60000 };
