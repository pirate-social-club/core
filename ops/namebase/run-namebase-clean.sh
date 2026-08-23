#!/usr/bin/env bash

set -u

namebase_bin="${NAMEBASE_BIN:-/usr/bin/namebase}"
namebase_home="${HOME:-}"
namebase_pid_file="${NAMEBASE_PID_FILE:-${namebase_home}/.namebase/shd.pid}"
nss_database="${NAMEBASE_NSS_DB:-${namebase_home}/.pki/nssdb}"
ca_nickname="${NAMEBASE_CA_NICKNAME:-Namebase Local CA}"

if [[ ! -x "$namebase_bin" ]]; then
  printf 'Namebase binary not found or not executable: %s\n' "$namebase_bin" >&2
  exit 127
fi

gsettings_value() {
  local schema="$1"
  local key="$2"
  gsettings get "$schema" "$key" 2>/dev/null || true
}

gvariant_string() {
  local value="$1"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

proxy_mode="$(gvariant_string "$(gsettings_value org.gnome.system.proxy mode)")"
proxy_autoconfig_url="$(gvariant_string "$(gsettings_value org.gnome.system.proxy autoconfig-url)")"
proxy_http_host="$(gvariant_string "$(gsettings_value org.gnome.system.proxy.http host)")"
proxy_http_port="$(gsettings_value org.gnome.system.proxy.http port)"
proxy_http_port="${proxy_http_port##* }"
child_pid=""

restore_proxy_settings() {
  if ! command -v gsettings >/dev/null 2>&1 || [[ -z "$proxy_mode" ]]; then
    return
  fi

  gsettings set org.gnome.system.proxy mode "$proxy_mode" >/dev/null 2>&1 || true
  gsettings set org.gnome.system.proxy autoconfig-url "$proxy_autoconfig_url" >/dev/null 2>&1 || true
  gsettings set org.gnome.system.proxy.http host "$proxy_http_host" >/dev/null 2>&1 || true
  if [[ "$proxy_http_port" =~ ^[0-9]+$ ]]; then
    gsettings set org.gnome.system.proxy.http port "$proxy_http_port" >/dev/null 2>&1 || true
  fi
}

remove_dead_helper_pid() {
  if [[ ! -f "$namebase_pid_file" ]]; then
    return
  fi

  local recorded_pid
  recorded_pid="$(tr -cd '0-9' < "$namebase_pid_file")"
  if [[ -z "$recorded_pid" ]] || kill -0 "$recorded_pid" 2>/dev/null; then
    return
  fi

  rm -f -- "$namebase_pid_file"
}

remove_namebase_ca() {
  if ! command -v certutil >/dev/null 2>&1 || [[ ! -d "$nss_database" ]]; then
    return
  fi

  # Never remove a CA while another Namebase instance is still alive.
  if command -v pgrep >/dev/null 2>&1 && pgrep -x namebase >/dev/null 2>&1; then
    printf 'Namebase is still running; leaving NSS CA trust unchanged.\n' >&2
    return
  fi

  if certutil -L -d "sql:${nss_database}" -n "$ca_nickname" >/dev/null 2>&1; then
    certutil -D -d "sql:${nss_database}" -n "$ca_nickname" >/dev/null
  fi
}

cleanup() {
  restore_proxy_settings
  remove_dead_helper_pid
  remove_namebase_ca
}

forward_signal() {
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap forward_signal INT TERM HUP

"$namebase_bin" "$@" &
child_pid="$!"
wait "$child_pid"
status="$?"
exit "$status"
