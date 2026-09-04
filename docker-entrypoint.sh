#!/bin/sh
set -e
echo ">> Применение схемы БД (drizzle-kit push)…"
n=0
until npx drizzle-kit push --force >/dev/null 2>&1 || [ $n -ge 10 ]; do
  n=$((n+1)); echo "   БД недоступна, повтор $n/10…"; sleep 3
done
npx drizzle-kit push --force
echo ">> Запуск приложения"
exec npx next start -p "${PORT:-3000}"
