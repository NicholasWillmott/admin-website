#!/bin/bash
# Nightly: back up every running FASTR instance's main database, one at a time.
# Writes a fleet summary to $BACKUP_ROOT/_fleet_status.json and exits non-zero
# if any instance failed.

set -uo pipefail

DB_HOST="${DB_HOST:-10.136.0.2}"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/fastr-backups}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DB_HOST BACKUP_ROOT

LOCK="/run/fastr-backup-all.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
    echo "$(date -u) another backup-all run is still going; skipping"
    exit 0
fi

# Instances that are never backed up (space-separated ids).
SKIP_SERVERS="${SKIP_SERVERS:-central-testing}"

# ONE ssh call for the whole run: names AND published ports. wb-server's ufw
# rate-limits ssh (22/tcp LIMIT), so a connection per instance gets this droplet
# refused partway through the fleet.
containers=""
for attempt in 1 2 3; do
    containers=$(ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no "root@${DB_HOST}" \
        "docker ps --format '{{.Names}}\t{{.Ports}}'" 2>/dev/null) && [[ -n "$containers" ]] && break
    (( attempt < 3 )) && sleep 60   # outlast a ufw LIMIT window
done
if [[ -z "$containers" ]]; then
    echo "$(date -u) ✗ could not list postgres containers on ${DB_HOST}"
    exit 1
fi

# "<id> <port>" per instance postgres container.
instances=$(awk -F'\t' '$1 ~ /-postgres$/ {
        id = $1; sub(/-postgres$/, "", id)
        port = ""
        if (match($2, /0\.0\.0\.0:[0-9]+->5432/)) { port = substr($2, RSTART + 8, RLENGTH - 8 - 6) }
        print id, port
    }' <<<"$containers" | sort)
for skip in $SKIP_SERVERS; do
    instances=$(awk -v s="$skip" '$1 != s' <<<"$instances")
done
server_ids=$(awk '{print $1}' <<<"$instances")

total=$(wc -l <<<"$server_ids")
ok=()
failed=()
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "========================================="
echo "$(date -u) backing up ${total} instances (skipping: ${SKIP_SERVERS:-none})"
echo "========================================="

for id in $server_ids; do
    echo ""
    echo "[$(( ${#ok[@]} + ${#failed[@]} + 1 ))/${total}] ${id}"
    port=$(awk -v s="$id" '$1 == s {print $2}' <<<"$instances")
    if PG_PORT="$port" "${SCRIPT_DIR}/fastr-backup.sh" "$id"; then
        ok+=("$id")
    else
        failed+=("$id")
    fi
done

to_json_array() { if (( $# )); then printf '%s\n' "$@" | jq -R . | jq -s -c .; else echo '[]'; fi; }

cat >"${BACKUP_ROOT}/_fleet_status.json.tmp" <<EOF
{
  "started_at": "${start}",
  "finished_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total": ${total},
  "ok": $(to_json_array "${ok[@]}"),
  "failed": $(to_json_array "${failed[@]}"),
  "disk_free_bytes": $(df --output=avail -B1 "$BACKUP_ROOT" | tail -1 | tr -d ' '),
  "disk_used_percent": $(df --output=pcent "$BACKUP_ROOT" | tail -1 | tr -dc '0-9')
}
EOF
mv "${BACKUP_ROOT}/_fleet_status.json.tmp" "${BACKUP_ROOT}/_fleet_status.json"

echo ""
echo "========================================="
echo "$(date -u) done: ${#ok[@]}/${total} ok"
(( ${#failed[@]} )) && echo "FAILED: ${failed[*]}"
echo "Disk: $(df -h "$BACKUP_ROOT" | tail -1 | awk '{print $4 " free (" $5 " used)"}')"
echo "========================================="

(( ${#failed[@]} == 0 ))
