#!/bin/bash
# FASTR v2 backup: one compressed dump of an instance's `main` database.
#
#   fastr-backup.sh <server-id> [manual-label]
#
# In v2 everything an instance owns lives in `main`: products (reports, decks,
# visualizations) with their version history, users, permissions, config,
# facilities and all HMIS/HFA/ICEH data. Results packages (runs/) are NOT
# backed up.
#
# The dump is pg_dump's custom format (-Fc): compressed, and pg_restore can pull
# single tables out of it (see fastr-restore.sh), which a gzipped .sql cannot.
#
# Layout:  $BACKUP_ROOT/<server-id>/<tag>_<UTC timestamp>/{main.dump,metadata.json,backup.log}
#   tag = monthly (1st of the month) | weekly (Sunday) | daily | manual
# Retention (count-based, applied only AFTER a successful backup, so a run of
# failures never eats the last good copies): 7 daily, 4 weekly, 3 monthly;
# manual backups are kept 30 days.
#
# Writes go to a .partial dir that is renamed into place only once the dump has
# been verified, so a half-written dump is never listed as a backup.

set -euo pipefail

SERVER_ID="${1:-}"
MANUAL_LABEL="${2:-}"
DB_HOST="${DB_HOST:-10.136.0.2}"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/fastr-backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-3}"
KEEP_MANUAL_DAYS="${KEEP_MANUAL_DAYS:-30}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-2000000000}"

if [[ ! "$SERVER_ID" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "Usage: $0 <server-id> [manual-label]" >&2
    exit 1
fi
if [[ -n "$MANUAL_LABEL" && ! "$MANUAL_LABEL" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Error: manual label may only contain letters, digits, - and _" >&2
    exit 1
fi

BASE_DIR="${BACKUP_ROOT}/${SERVER_ID}"
TIMESTAMP=$(date -u +%Y-%m-%d_%H-%M-%S)

if [[ -n "${BACKUP_TAG:-}" ]]; then
    TAG="$BACKUP_TAG"
elif [[ -n "$MANUAL_LABEL" ]]; then
    TAG="manual"
elif [[ "$(date -u +%d)" == "01" ]]; then
    TAG="monthly"
elif [[ "$(date -u +%u)" == "7" ]]; then
    TAG="weekly"
else
    TAG="daily"
fi
if [[ ! "$TAG" =~ ^(daily|weekly|monthly|manual)$ ]]; then
    echo "Error: BACKUP_TAG must be daily, weekly, monthly or manual" >&2
    exit 1
fi

DIR_NAME="${TAG}_${TIMESTAMP}${MANUAL_LABEL:+_${MANUAL_LABEL}}"
FINAL_DIR="${BASE_DIR}/${DIR_NAME}"
WORK_DIR="${BASE_DIR}/.partial_${DIR_NAME}"
STATUS_FILE="${BASE_DIR}/last_status.json"

json_escape() { printf '%s' "$1" | jq -Rs .; }

write_status() { # <ok|failed> <message>
    [[ -d "$BASE_DIR" ]] || return 0  # never create a dir for a mistyped id
    cat >"${STATUS_FILE}.tmp" 2>/dev/null <<EOF || return 0
{
  "server_id": "${SERVER_ID}",
  "status": "$1",
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tag": "${TAG}",
  "folder": "${DIR_NAME}",
  "message": $(json_escape "$2")
}
EOF
    mv "${STATUS_FILE}.tmp" "$STATUS_FILE" 2>/dev/null || true
}

fail() {
    echo "✗ FAILED: $1" >&2
    rm -rf "$WORK_DIR" 2>/dev/null || true
    write_status failed "$1"
    exit 1
}

# Debris from a crashed earlier run is never a backup: clear it first so it
# cannot hold disk space hostage.
rm -rf "${BASE_DIR}"/.partial_* 2>/dev/null || true

# ---- discover the instance's postgres port ---------------------------------
# backup-all.sh looks every port up in ONE ssh call and passes PG_PORT in:
# wb-server's ufw rate-limits ssh (22/tcp LIMIT = refused after ~6 connections
# in 30s), so one ssh per instance gets the droplet locked out mid-run. Only a
# standalone run (e.g. the Admin-Website "Backup now" button) discovers its own.
# Retried: one dropped SSH connection must not cost an instance its night.
PG_PORT="${PG_PORT:-}"
for attempt in 1 2 3; do
    [[ -n "$PG_PORT" ]] && break
    PG_PORT=$(ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no "root@${DB_HOST}" \
        "docker ps --format '{{.Names}}\t{{.Ports}}' | grep -P '^${SERVER_ID}-postgres\t'" 2>/dev/null |
        grep -oP '0\.0\.0\.0:\K[0-9]+(?=->5432)' | head -1) || true
    [[ -n "$PG_PORT" ]] && break
    (( attempt < 3 )) && sleep 10
done
[[ -n "$PG_PORT" ]] || fail "no running container ${SERVER_ID}-postgres on ${DB_HOST} (3 attempts)"

PSQL=(psql -h "$DB_HOST" -p "$PG_PORT" -U postgres -d main -tAX -v ON_ERROR_STOP=1)

# ---- space check ------------------------------------------------------------
mkdir -p "$BASE_DIR" || fail "cannot create ${BASE_DIR}"
LAST_DUMP=$(ls -1t "${BASE_DIR}"/*/main.dump 2>/dev/null | head -1 || true)
NEED=$MIN_FREE_BYTES
if [[ -n "$LAST_DUMP" ]]; then
    LAST_SIZE=$(stat -c %s "$LAST_DUMP")
    (( LAST_SIZE * 2 > NEED )) && NEED=$(( LAST_SIZE * 2 ))
fi
FREE=$(df --output=avail -B1 "$BACKUP_ROOT" | tail -1 | tr -d ' ')
(( FREE >= NEED )) || fail "not enough space on ${BACKUP_ROOT}: $(numfmt --to=iec "$FREE") free, need $(numfmt --to=iec "$NEED")"

mkdir -p "$WORK_DIR" || fail "cannot create ${WORK_DIR}"
exec > >(tee -a "${WORK_DIR}/backup.log") 2>&1

echo "========================================="
echo "Backup started: $(date -u)"
echo "Server: ${SERVER_ID}  (${DB_HOST}:${PG_PORT})"
echo "Tag: ${TAG}"
echo "========================================="

# ---- dump -------------------------------------------------------------------
START=$(date +%s)
echo "Dumping main database..."
nice -n 10 pg_dump \
    -h "$DB_HOST" -p "$PG_PORT" -U postgres -d main \
    --format=custom \
    --lock-wait-timeout=120s \
    --file="${WORK_DIR}/main.dump" ||
    fail "pg_dump exited non-zero"
SECONDS_TAKEN=$(( $(date +%s) - START ))

# A dump whose table of contents cannot be read is not a backup.
TOC_ENTRIES=$(pg_restore --list "${WORK_DIR}/main.dump" 2>/dev/null | grep -vc '^;') ||
    fail "pg_restore cannot read the dump"
DUMP_BYTES=$(stat -c %s "${WORK_DIR}/main.dump")
echo "✓ Dump written: $(numfmt --to=iec "$DUMP_BYTES") in ${SECONDS_TAKEN}s (${TOC_ENTRIES} entries)"

# ---- metadata -----------------------------------------------------------------
q() { "${PSQL[@]}" -c "$1" 2>/dev/null || echo "null"; }
has_table() { [[ "$(q "SELECT to_regclass('public.$1') IS NOT NULL")" == "t" ]]; }

DB_BYTES=$(q "SELECT pg_database_size('main')")
PG_SERVER_VERSION=$(q "SHOW server_version")
USERS=$(q "SELECT count(*) FROM users")
if has_table products; then
    SCHEMA="v2"
    PRODUCTS_JSON=$(q "SELECT coalesce(json_object_agg(type, n), '{}') FROM (SELECT type, count(*) n FROM products GROUP BY type) t")
    TOTAL_PRODUCTS=$(q "SELECT count(*) FROM products")
else
    # v1 instances keep their reports/decks in per-project databases, which
    # this script does not dump.
    SCHEMA="v1"
    PRODUCTS_JSON="{}"
    TOTAL_PRODUCTS=0
    echo "⚠ v1 instance: per-project databases are NOT included in this backup"
fi
[[ "$PRODUCTS_JSON" == "null" || -z "$PRODUCTS_JSON" ]] && PRODUCTS_JSON="{}"
LAST_MIGRATION=$(q "SELECT migration_id FROM schema_migrations ORDER BY applied_at DESC, migration_id DESC LIMIT 1")

cat >"${WORK_DIR}/metadata.json" <<EOF
{
  "format": "fastr-v2-main",
  "server_id": "${SERVER_ID}",
  "tag": "${TAG}",
  "label": $(json_escape "$MANUAL_LABEL"),
  "timestamp": "${TIMESTAMP}",
  "backup_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "schema": "${SCHEMA}",
  "last_migration": $(json_escape "$LAST_MIGRATION"),
  "pg_server_version": "${PG_SERVER_VERSION}",
  "db_bytes": ${DB_BYTES:-null},
  "dump_file": "main.dump",
  "dump_bytes": ${DUMP_BYTES},
  "dump_seconds": ${SECONDS_TAKEN},
  "users": ${USERS:-null},
  "total_products": ${TOTAL_PRODUCTS:-0},
  "products": ${PRODUCTS_JSON}
}
EOF
jq . "${WORK_DIR}/metadata.json" >/dev/null || fail "metadata.json is not valid JSON"

# ---- publish ------------------------------------------------------------------
echo "Backup finished: $(date -u)"
mv "$WORK_DIR" "$FINAL_DIR" || fail "could not move ${WORK_DIR} into place"

# ---- retention (only after success) ------------------------------------------
prune_tag() { # <tag> <keep>
    local dirs=() old
    shopt -s nullglob
    dirs=("${BASE_DIR}/${1}_"*)
    shopt -u nullglob
    (( ${#dirs[@]} > $2 )) || return 0
    # Names embed a sortable UTC timestamp: newest first, drop all past <keep>.
    printf '%s\n' "${dirs[@]}" | sort -r | tail -n +$(( $2 + 1 )) | while read -r old; do
        echo "Pruning ${old##*/}"
        rm -rf "$old"
    done
}
prune_tag daily "$KEEP_DAILY"
prune_tag weekly "$KEEP_WEEKLY"
prune_tag monthly "$KEEP_MONTHLY"
find "$BASE_DIR" -maxdepth 1 -type d -name 'manual_*' -mtime +"$KEEP_MANUAL_DAYS" -print -exec rm -rf {} + |
    sed 's|.*/|Pruning |' || true

write_status ok "$(numfmt --to=iec "$DUMP_BYTES") in ${SECONDS_TAKEN}s"
echo "✓ ${SERVER_ID}: ${FINAL_DIR}"
