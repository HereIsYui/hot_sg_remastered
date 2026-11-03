#!/usr/bin/env bash
# mysqldump of the bloodwar database through a running compose db service.
#
#   scripts/backup-db.sh                          # prod stack (docker/prod/docker-compose.yml)
#   scripts/backup-db.sh --dev                    # development db (docker/dev/docker-compose.yml)
#   scripts/backup-db.sh --compose <file> --out <dir> --keep <n>
#
# Output: <out>/bloodwar-YYYYmmdd-HHMMSS.sql.gz; keeps the newest --keep dumps (default 14).
#
# What gets backed up -- three databases live in this repo, and only two are save data:
#   1. prod stack   (docker/prod, MySQL 8.4) -- the deployed save data. Back this up.
#   2. dev db       (docker/dev,  MySQL 8.4, port 3318) -- throwaway development data;
#                     backing it up is optional (--dev), e.g. before a risky migration.
#   3. diff baseline (docker/legacy, MySQL 5.7, port 3317) -- the original PHP oracle for the
#                     differential tests; NEVER deployed and NEVER backed up here. It is
#                     reproducible from the original material (`pnpm legacy:dump-db`), and an
#                     8.4 dump must not be restored into it -- utf8mb4/InnoDB do not map back
#                     to its utf8/MyISAM shape. Use scripts/restore-db.sh for 8.4 targets.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
compose_file=$repo_root/docker/prod/docker-compose.yml
out_dir=$repo_root/backups
keep=14

while [[ $# -gt 0 ]]; do
  case $1 in
    --dev) compose_file=$repo_root/docker/dev/docker-compose.yml ;;
    --compose) compose_file=$2; shift ;;
    --out) out_dir=$2; shift ;;
    --keep) keep=$2; shift ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "backup-db: unknown option: $1 (see --help)" >&2
      exit 2
      ;;
  esac
  shift
done

cd "$repo_root"
[[ -f $compose_file ]] || { echo "backup-db: compose file not found: $compose_file" >&2; exit 1; }

# Start (or wait for) just the db service, like tools/src/migrate-db.ts does.
docker compose -f "$compose_file" up -d --wait db

mkdir -p "$out_dir"
target=$out_dir/bloodwar-$(date +%Y%m%d-%H%M%S).sql.gz

echo "backup-db: dumping bloodwar via $compose_file -> $target"
# --single-transaction takes a consistent snapshot without locking; every table is InnoDB
# after the tools/src/migrate-db.ts migration. Credentials come from the container
# environment (MYSQL_ROOT_PASSWORD / MYSQL_DATABASE), so the script follows docker/prod/.env.
# mysqldump writes to stdout (docker compose exec -T keeps the pipe binary-safe).
docker compose -f "$compose_file" exec -T db sh -c \
  'exec mysqldump --default-character-set=utf8mb4 --single-transaction --quick --routines --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > "$target"

bytes=$(wc -c < "$target" | tr -d ' ')
# An empty database with header/footer is ~2 KB; anything smaller means the pipe broke.
if [[ $bytes -lt 2000 ]]; then
  echo "backup-db: dump is only $bytes bytes -- likely failed; removing it" >&2
  rm -f "$target"
  exit 1
fi
echo "backup-db: wrote $target ($bytes bytes)"

# Retention: prune all but the newest $keep dumps.
ls -1t "$out_dir"/bloodwar-*.sql.gz | tail -n +$((keep + 1)) | while read -r old; do
  echo "backup-db: pruning $old"
  rm -f "$old"
done
