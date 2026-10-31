#!/bin/bash
set -euo pipefail
work=$(mktemp -d /private/tmp/fc-phase3-test.XXXXXX)
backend=$(cd "$(dirname "$0")/../.." && pwd)
cleanup() {
  if [ -f "$work/redis.pid" ]; then kill "$(cat "$work/redis.pid")" 2>/dev/null || true; fi
  if [ -f "$work/db/postmaster.pid" ]; then pg_ctl -D "$work/db" stop -m immediate >/dev/null || true; fi
}
trap cleanup EXIT
mkdir "$work/app"
cp -R "$backend/src" "$backend/tests" "$work/app/"
cp "$backend/package.json" "$backend/vitest.config.js" "$work/app/"
ln -s "$backend/node_modules" "$work/app/node_modules"
rm -f "$work/app/src/database/migrations/122_"*.sql "$work/app/src/database/migrations/123_"*.sql "$work/app/src/database/migrations/124_"*.sql
initdb -D "$work/db" -A trust -U freshcuts_test --encoding=UTF8 --no-locale > "$work/init.log"
pg_ctl -D "$work/db" -l "$work/postgres.log" -o "-k $work -h '' -p 55439" start >/dev/null
createdb -h "$work" -p 55439 -U freshcuts_test freshcuts_bulk_test
psql -h "$work" -p 55439 -U freshcuts_test -d freshcuts_bulk_test -Atqc "SELECT current_database(), current_user, inet_server_addr() IS NULL"
redis_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
redis-server --bind 127.0.0.1 --port "$redis_port" --save '' --appendonly no --daemonize yes --pidfile "$work/redis.pid" --logfile "$work/redis.log"
cd "$work/app"
export NODE_ENV=test DB_HOST="$work" DB_PORT=55439 DB_NAME=freshcuts_bulk_test DB_USER=freshcuts_test DB_PASSWORD=test REDIS_HOST=127.0.0.1 REDIS_PORT="$redis_port" JWT_ACCESS_SECRET=only_test_key_abcdefghijklmnopqrstuvwxyz123456 JWT_REFRESH_SECRET=only_test_key_abcdefghijklmnopqrstuvwxyz789012 LOG_LEVEL=error
node src/database/migrate.js > "$work/migrate.log" 2>&1 || { tail -20 "$work/migrate.log"; exit 1; }
printf 'Disposable schema migrations completed; demo migrations 122-124 excluded.\n'
npx vitest run tests/integration/product-bulk-import-http-isolated.test.js --reporter=verbose
npx vitest run tests/integration/product-bulk-import.test.js --reporter=verbose
