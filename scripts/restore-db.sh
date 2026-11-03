#!/usr/bin/env bash
# Restore a bloodwar dump into a running compose db service. The target database is
# DROPPED and recreated first -- this wipes the current save data.
#
#   scripts/restore-db.sh backups/bloodwar-20260101-040000.sql.gz
#   scripts/restore-db.sh --dev legacy/db/bloodwar_full.sql
#   scripts/restore-db.sh                    # newest backups/bloodwar-*.sql.gz into prod
#
# Charset/engine semantics come from tools/src/lib/migrate-sql.ts (the transform behind
# `pnpm db:migrate`): a dump still in the original MySQL 5.x shape (MyISAM / utf8, e.g.
# legacy/db/bloodwar_full.sql) is converted on the fly with the very same migrateDump() --
# ENGINE=InnoDB, utf8mb4 with PAD SPACE collations (utf8mb4_general_ci / utf8mb4_bin) and
# the import prologue/epilogue (sql_mode='', mem_maneuver combat columns). A dump taken
# from an already migrated 8.4 database (scripts/backup-db.sh output) is imported as-is.
#
# Do NOT point this at the docker/legacy oracle: it must keep its original utf8/MyISAM
# shape for the differential tests, and legacy:up provisions it from
# legacy/db/bloodwar_full.sql directly.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
compose_file=$repo_root/docker/prod/docker-compose.yml
dump=
keep_tmp=

cleanup() {
  [[ -n $keep_tmp ]] && rm -f "$keep_tmp" "$keep_tmp.migrated"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case $1 in
    --dev) compose_file=$repo_root/docker/dev/docker-compose.yml ;;
    --compose) compose_file=$2; shift ;;
    -h | --help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "restore-db: unknown option: $1 (see --help)" >&2
      exit 2
      ;;
    *) dump=$1 ;;
  esac
  shift
done

cd "$repo_root"
[[ -f $compose_file ]] || { echo "restore-db: compose file not found: $compose_file" >&2; exit 1; }

if [[ -z $dump ]]; then
  dump=$(ls -1t "$repo_root"/backups/bloodwar-*.sql.gz 2>/dev/null | head -n 1 || true)
  [[ -n $dump ]] || { echo "restore-db: no dump given and no backups/bloodwar-*.sql.gz found" >&2; exit 1; }
  echo "restore-db: no dump given, using newest: $dump"
fi
[[ -f $dump ]] || { echo "restore-db: dump not found: $dump" >&2; exit 1; }

# Start (or wait for) just the db service, like tools/src/migrate-db.ts does.
docker compose -f "$compose_file" up -d --wait db

# Decode into a temp file so format detection, the CREATE TABLE count and the import all
# read one consistent copy (the dump may be gzipped).
keep_tmp=$(mktemp "${TMPDIR:-/tmp}/bloodwar-restore.XXXXXX")
if [[ $dump == *.gz ]]; then
  gzip -cd "$dump" > "$keep_tmp"
else
  cat "$dump" > "$keep_tmp"
fi

# Original-format dumps still carry MyISAM tables; migrated 8.4 dumps cannot (the
# migrate-db verification rejects anything not converted to InnoDB).
if grep -q 'ENGINE=MyISAM' "$keep_tmp"; then
  echo "restore-db: original 5.x format detected -- applying the tools/src/migrate-db.ts transform (InnoDB / utf8mb4 / import epilogue)"
  node --input-type=module -e '
const { pathToFileURL } = await import("node:url");
const { migrateDump } = await import(pathToFileURL(`${process.argv[1]}/tools/src/lib/migrate-sql.ts`).href);
let sql = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) sql += chunk;
process.stdout.write(migrateDump(sql));
' "$repo_root" < "$keep_tmp" > "$keep_tmp.migrated"
  mv "$keep_tmp.migrated" "$keep_tmp"
else
  echo "restore-db: migrated 8.4 dump detected -- importing as-is"
fi

tables=$(grep -c '^CREATE TABLE' "$keep_tmp" || true)
[[ $tables -gt 0 ]] || { echo "restore-db: no CREATE TABLE statements found in $dump" >&2; exit 1; }

# Same database (re)creation as migrate-db.ts: utf8mb4 / utf8mb4_general_ci, grants for the
# app user. Names come from the container environment so docker/prod/.env is followed.
db_name=$(docker compose -f "$compose_file" exec -T db printenv MYSQL_DATABASE)
db_user=$(docker compose -f "$compose_file" exec -T db printenv MYSQL_USER)
printf "DROP DATABASE IF EXISTS \`%s\`; CREATE DATABASE \`%s\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; GRANT ALL ON \`%s\`.* TO '%s'@'%%';" \
  "$db_name" "$db_name" "$db_name" "$db_user" |
  docker compose -f "$compose_file" exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4'

echo "restore-db: importing $tables tables into $db_name..."
docker compose -f "$compose_file" exec -T db sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYSQL_DATABASE"' \
  < "$keep_tmp"

# Mirror the migrate-db checks: everything must be InnoDB and no table may be missing.
not_innodb=$(docker compose -f "$compose_file" exec -T db sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND engine<>\"InnoDB\"" "$MYSQL_DATABASE"')
if [[ -n $not_innodb ]]; then
  echo "restore-db: WARNING tables not InnoDB: $not_innodb" >&2
  exit 1
fi
found=$(docker compose -f "$compose_file" exec -T db sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()" "$MYSQL_DATABASE"')
if [[ $found -ne $tables ]]; then
  echo "restore-db: WARNING expected $tables tables, found $found" >&2
  exit 1
fi
echo "restore-db: restored $found InnoDB tables into $db_name (compose: $compose_file)"
