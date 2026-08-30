#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REMOTE="${FALL_RECRUITMENT_SYNC_REMOTE:-}"
readonly PORT="${FALL_RECRUITMENT_SYNC_SSH_PORT:-22}"
readonly REMOTE_DIR='.local/share/fall-recruitment-sync'
readonly EXPECTED_HOST_FINGERPRINT="${FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT:-}"
readonly IDENTITY="${FALL_RECRUITMENT_SYNC_SSH_IDENTITY:-${HOME}/.ssh/id_ed25519}"
readonly KNOWN_HOSTS="${FALL_RECRUITMENT_SYNC_KNOWN_HOSTS:-${HOME}/.ssh/known_hosts}"
readonly AGE_CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/fall-recruitment-sync"
readonly AGE_IDENTITY="${FALL_RECRUITMENT_SYNC_AGE_IDENTITY:-${AGE_CONFIG_DIR}/age-identity.txt}"
readonly AGE_RECIPIENT="${FALL_RECRUITMENT_SYNC_AGE_RECIPIENT:-${AGE_CONFIG_DIR}/age-recipient.txt}"
readonly CLIENT_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/fall-recruitment-sync-client"

TEMP_DIR=''
RESTORE_STAGE=''
LOCAL_PUBLISH_STAGE=''
LOCAL_PUBLISHED_AGE=''
LOCAL_PUBLISHED_SUM=''
SNAPSHOT_NAME=''
SNAPSHOT_SUM_NAME=''
SNAPSHOT_ENCRYPTED=''
SNAPSHOT_CHECKSUM=''
SNAPSHOT_NONCE=''

cleanup() {
  # Remove the .age visibility marker before its checksum during rollback.
  if [[ -n "${LOCAL_PUBLISHED_AGE:-}" ]]; then
    rm -f -- "$LOCAL_PUBLISHED_AGE"
  fi
  if [[ -n "${LOCAL_PUBLISHED_SUM:-}" ]]; then
    rm -f -- "$LOCAL_PUBLISHED_SUM"
  fi
  if [[ -n "${LOCAL_PUBLISH_STAGE:-}" && -d "$LOCAL_PUBLISH_STAGE" && ! -L "$LOCAL_PUBLISH_STAGE" ]]; then
    rm -rf -- "$LOCAL_PUBLISH_STAGE"
  fi
  if [[ -n "${RESTORE_STAGE:-}" && -d "$RESTORE_STAGE" && ! -L "$RESTORE_STAGE" ]]; then
    rm -rf -- "$RESTORE_STAGE"
  fi
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" && ! -L "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

die() { printf 'private-sync: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

allowed_input() {
  local name="$(basename -- "$1")"
  [[ "$name" =~ ^autumn-compass-workspace-[0-9]{4}-[0-9]{2}-[0-9]{2}([_-][A-Za-z0-9_-]+)?\.json$ ||
     "$name" == 'autumn-compass-profile.json' ]]
}

ssh_options() {
  COMMON_SSH_OPTS=(
    -i "$IDENTITY" -o IdentitiesOnly=yes -o BatchMode=yes
    -o PreferredAuthentications=publickey -o PubkeyAuthentication=yes
    -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS"
    -o HostKeyAlgorithms=ssh-ed25519 -o ConnectTimeout=12
  )
  SSH_OPTS=(-p "$PORT" "${COMMON_SSH_OPTS[@]}")
  SCP_OPTS=(-P "$PORT" "${COMMON_SSH_OPTS[@]}")
}

preflight() {
  [[ -n "$REMOTE" ]] || die 'FALL_RECRUITMENT_SYNC_REMOTE is required (user@host)'
  [[ -n "$EXPECTED_HOST_FINGERPRINT" ]] ||
    die 'FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT is required'
  [[ "$REMOTE" =~ ^[A-Za-z_][A-Za-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*$ ]] ||
    die 'remote must be a plain user@host value'
  [[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$PORT <= 65535 )) ||
    die 'SSH port must be an integer from 1 to 65535'
  local host="${REMOTE#*@}" lookup_host found ed25519_fingerprints
  [[ "$EXPECTED_HOST_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] ||
    die 'expected host fingerprint must be one complete SHA256 fingerprint'
  need ssh; need scp; need ssh-keygen; need age; need sha256sum
  [[ -f "$IDENTITY" ]] || die "SSH identity not found: $IDENTITY"
  [[ -f "$KNOWN_HOSTS" ]] || die "known_hosts not found: $KNOWN_HOSTS"
  lookup_host="$host"; [[ "$PORT" == '22' ]] || lookup_host="[$host]:$PORT"
  found="$(ssh-keygen -F "$lookup_host" -f "$KNOWN_HOSTS" 2>/dev/null || true)"
  [[ -n "$found" ]] || die "host is not pinned in known_hosts: $lookup_host"
  ed25519_fingerprints="$(
    printf '%s\n' "$found" |
      awk '!/^#/ && $2 == "ssh-ed25519"' |
      ssh-keygen -lf - -E sha256 2>/dev/null |
      awk '{print $2}' |
      LC_ALL=C sort -u || true
  )"
  [[ "$ed25519_fingerprints" == "$EXPECTED_HOST_FINGERPRINT" ]] ||
    die 'known_hosts must contain exactly the pinned ED25519 fingerprint for this endpoint'
  ssh_options
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    'set -eu; command -v sha256sum >/dev/null; d="$HOME/.local/share/fall-recruitment-sync"; if [ -e "$d" ]; then test -d "$d" && test ! -L "$d" && test -r "$d"; fi; printf "SSH key-only preflight passed.\n"'
}

prepare_snapshot() {
  [[ $# -gt 0 ]] || die 'one or more explicit Autumn Compass JSON exports are required'
  need zip
  need age
  need sha256sum
  [[ -f "$AGE_RECIPIENT" && ! -L "$AGE_RECIPIENT" ]] ||
    die "age recipient must be a regular non-symlink file: $AGE_RECIPIENT (prefer a dedicated age key)"
  local f base seen='|' total=0
  for f in "$@"; do
    [[ -f "$f" && ! -L "$f" ]] || die "input is not a regular non-symlink file: $f"
    allowed_input "$f" || die "refusing non-backup input: $f"
    base="$(basename -- "$f")"
    [[ "$seen" != *"|$base|"* ]] || die "duplicate input basename: $base"
    seen+="$base|"
    total=$((total + $(stat -c %s -- "$f")))
  done
  (( total <= 104857600 )) || die 'input exceeds the 100 MiB safety limit'

  local tmp stamp archive digest
  TEMP_DIR="$(mktemp -d)"; tmp="$TEMP_DIR"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"; SNAPSHOT_NONCE="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  SNAPSHOT_NAME="backup-${stamp}-${SNAPSHOT_NONCE}.age"
  SNAPSHOT_SUM_NAME="${SNAPSHOT_NAME}.sha256"
  archive="$tmp/payload.zip"
  SNAPSHOT_ENCRYPTED="$tmp/$SNAPSHOT_NAME"
  SNAPSHOT_CHECKSUM="$tmp/$SNAPSHOT_SUM_NAME"
  printf 'Autumn Compass private browser exports; no credentials or SSH keys.\n' > "$tmp/SYNC_MANIFEST.txt"
  zip -q -j "$archive" "$@" "$tmp/SYNC_MANIFEST.txt"
  age --encrypt --recipients-file "$AGE_RECIPIENT" --output "$SNAPSHOT_ENCRYPTED" "$archive"
  rm -f -- "$archive"
  digest="$(sha256sum "$SNAPSHOT_ENCRYPTED")"; digest="${digest%% *}"
  printf '%s  %s\n' "$digest" "$SNAPSHOT_NAME" > "$SNAPSHOT_CHECKSUM"
}

push_snapshot() {
  prepare_snapshot "$@"
  local final_age="$SNAPSHOT_NAME" final_sum="$SNAPSHOT_SUM_NAME"
  local upload_age=".upload-${SNAPSHOT_NONCE}.age" upload_sum=".upload-${SNAPSHOT_NONCE}.sha256"

  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    'set -eu; umask 077; d="$HOME/.local/share/fall-recruitment-sync"; mkdir -p "$d"; test -d "$d" && test ! -L "$d"; chmod 700 "$d"'
  scp "${SCP_OPTS[@]}" "$SNAPSHOT_ENCRYPTED" "$REMOTE:$REMOTE_DIR/$upload_age"
  scp "${SCP_OPTS[@]}" "$SNAPSHOT_CHECKSUM" "$REMOTE:$REMOTE_DIR/$upload_sum"
  local publish
  publish="set -eu; umask 077; d=\"\$HOME/$REMOTE_DIR\"; cd \"\$d\"; trap 'rm -f \"$upload_age\" \"$upload_sum\"' EXIT; expected=\$(sed -n '1{s/ .*//;p;}' \"$upload_sum\"); actual=\$(sha256sum \"$upload_age\"); actual=\${actual%% *}; test \"\$expected\" = \"\$actual\"; grep -qx '[0-9a-f]\\{64\\}  $final_age' \"$upload_sum\"; test ! -e \"$final_age\"; test ! -e \"$final_sum\"; chmod 600 \"$upload_age\" \"$upload_sum\"; ln \"$upload_sum\" \"$final_sum\"; ln \"$upload_age\" \"$final_age\"; rm -f \"$upload_age\" \"$upload_sum\"; trap - EXIT"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "$publish"
  printf 'Published immutable encrypted snapshot: %s\n' "$final_age"
}

ensure_local_store() {
  local path
  for path in "$HOME/.local" "$HOME/.local/share" "$HOME/$REMOTE_DIR"; do
    [[ ! -L "$path" ]] || die "local sync path must not be a symlink: $path"
    if [[ -e "$path" ]]; then
      [[ -d "$path" ]] || die "local sync path is not a directory: $path"
    else
      mkdir -- "$path"
    fi
  done
  chmod 700 "$HOME/$REMOTE_DIR"
}

publish_local_snapshot() {
  [[ -n "${FALL_RECRUITMENT_SYNC_AGE_RECIPIENT:-}" ]] ||
    die 'publish-local requires FALL_RECRUITMENT_SYNC_AGE_RECIPIENT to name the client public recipient file'
  prepare_snapshot "$@"
  ensure_local_store

  local store="$HOME/$REMOTE_DIR" expected actual
  local final_age="$store/$SNAPSHOT_NAME" final_sum="$store/$SNAPSHOT_SUM_NAME"
  [[ ! -e "$final_age" && ! -L "$final_age" ]] || die "refusing to overwrite local snapshot: $final_age"
  [[ ! -e "$final_sum" && ! -L "$final_sum" ]] || die "refusing to overwrite local checksum: $final_sum"

  LOCAL_PUBLISH_STAGE="$store/.publish-$SNAPSHOT_NONCE"
  mkdir -- "$LOCAL_PUBLISH_STAGE" || die 'could not reserve a unique local publish stage'
  chmod 700 "$LOCAL_PUBLISH_STAGE"
  cp -- "$SNAPSHOT_ENCRYPTED" "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_NAME"
  cp -- "$SNAPSHOT_CHECKSUM" "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_SUM_NAME"
  chmod 600 "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_NAME" "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_SUM_NAME"

  expected="$(sed -n '1{s/ .*//;p;}' "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_SUM_NAME")"
  actual="$(sha256sum "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_NAME")"; actual="${actual%% *}"
  [[ "$expected" == "$actual" ]] || die 'local encrypted snapshot checksum mismatch'
  grep -qx "[0-9a-f]\\{64\\}  $SNAPSHOT_NAME" "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_SUM_NAME" ||
    die 'local checksum manifest is invalid'

  ln -- "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_SUM_NAME" "$final_sum" || die 'could not publish local checksum without overwriting'
  LOCAL_PUBLISHED_SUM="$final_sum"
  # The .age file is the visibility marker selected by Pull. Publish it last so
  # interruption can leave only an ignored checksum, never an unusable latest snapshot.
  ln -- "$LOCAL_PUBLISH_STAGE/$SNAPSHOT_NAME" "$final_age" || die 'could not publish local snapshot without overwriting'
  LOCAL_PUBLISHED_AGE="$final_age"
  chmod 600 "$final_age" "$final_sum"
  rm -rf -- "$LOCAL_PUBLISH_STAGE"
  LOCAL_PUBLISH_STAGE=''
  LOCAL_PUBLISHED_AGE=''
  LOCAL_PUBLISHED_SUM=''
  printf 'Published immutable encrypted snapshot locally: %s\n' "$final_age"
}

pull_snapshot() {
  need unzip; need python3
  [[ -f "$AGE_IDENTITY" ]] || die "age identity not found: $AGE_IDENTITY"
  local out="${1:-$CLIENT_DIR/restored-$(date +%Y%m%d-%H%M%S)}" latest tmp sum expected actual archive entry parent
  [[ ! -e "$out" && ! -L "$out" ]] || die "restore destination already exists: $out"
  latest="$(ssh "${SSH_OPTS[@]}" "$REMOTE" 'set -eu; d="$HOME/.local/share/fall-recruitment-sync"; test -d "$d"; find "$d" -maxdepth 1 -type f -name "backup-*.age" -printf "%f\n" | LC_ALL=C sort | tail -n 1')"
  [[ "$latest" =~ ^backup-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}\.age$ ]] || die 'no valid remote snapshot found'
  TEMP_DIR="$(mktemp -d)"; tmp="$TEMP_DIR"; RESTORE_STAGE=''
  scp "${SCP_OPTS[@]}" "$REMOTE:$REMOTE_DIR/$latest" "$tmp/$latest"
  scp "${SCP_OPTS[@]}" "$REMOTE:$REMOTE_DIR/$latest.sha256" "$tmp/$latest.sha256"
  (( $(stat -c %s -- "$tmp/$latest") <= 115343360 )) || die 'encrypted snapshot exceeds the 110 MiB safety limit'
  sum="$(<"$tmp/$latest.sha256")"
  [[ "$sum" =~ ^([0-9a-f]{64})\ \ (.+)$ ]] || die 'invalid checksum manifest'
  [[ "${BASH_REMATCH[2]}" == "$latest" ]] || die 'checksum manifest names the wrong snapshot'
  expected="${BASH_REMATCH[1]}"; actual="$(sha256sum "$tmp/$latest")"; actual="${actual%% *}"
  [[ "$expected" == "$actual" ]] || die 'encrypted snapshot checksum mismatch'
  archive="$tmp/payload.zip"
  age --decrypt --identity "$AGE_IDENTITY" --output "$archive" "$tmp/$latest"
  python3 "$SCRIPT_DIR/validate_payload.py" "$archive" || die 'decrypted payload validation failed'
  parent="$(dirname -- "$out")"; mkdir -p -- "$parent"
  [[ ! -L "$parent" ]] || die "restore parent must not be a symlink: $parent"
  RESTORE_STAGE="$parent/.fall-recruitment-restore-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  mkdir -- "$RESTORE_STAGE"; chmod 700 "$RESTORE_STAGE"
  unzip -q "$archive" -d "$RESTORE_STAGE"; find "$RESTORE_STAGE" -type f -exec chmod 600 {} +
  if find "$RESTORE_STAGE" -mindepth 1 ! -type f -print -quit | grep -q .; then
    die 'restored payload contains a non-regular file'
  fi
  mv -- "$RESTORE_STAGE" "$out"; RESTORE_STAGE=''
  printf 'Restored verified snapshot to: %s\n' "$out"
}

usage() {
  printf 'Usage: %s check | push <autumn-compass-*.json>... | pull [output-dir] | publish-local <autumn-compass-*.json>...\n' "$0"
}

[[ $# -gt 0 ]] || { usage; exit 2; }
case "$1" in
  check) preflight ;;
  push) preflight; shift; push_snapshot "$@" ;;
  pull) preflight; shift; pull_snapshot "$@" ;;
  publish-local) shift; publish_local_snapshot "$@" ;;
  *) usage; exit 2 ;;
esac
