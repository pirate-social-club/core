#!/usr/bin/env bash

# Hash the effective systemd unit, including all drop-ins. systemctl cat emits
# source-path comments that vary with installation layout, so normalize only
# those generated lines plus line endings and trailing whitespace. Internal
# whitespace remains semantic and is preserved.

systemd_unit_is_valid() {
  [[ "${1:-}" =~ ^[A-Za-z0-9_.@:%+~-]+\.(service|timer|socket|mount|path|target|slice|scope|automount|swap|device)$ ]]
}

systemd_unit_hash() {
  local unit="${1:?systemd unit required}"
  command -v systemctl >/dev/null 2>&1 || return 1
  SYSTEMD_PAGER=cat SYSTEMD_COLORS=0 systemctl cat "$unit" \
    | sed -e '/^# \//d' -e 's/\r$//' -e 's/[[:space:]]*$//' \
    | sha256sum | awk '{print $1}'
}

systemd_unit_from_installed_path() {
  local installed_path="${1:?installed path required}"
  case "$installed_path" in
    /etc/systemd/system/*.service|/etc/systemd/system/*.timer|/etc/systemd/system/*.socket|\
    /etc/systemd/system/*.mount|/etc/systemd/system/*.path|/etc/systemd/system/*.target|\
    /etc/systemd/system/*.slice|/etc/systemd/system/*.scope|/etc/systemd/system/*.automount|\
    /etc/systemd/system/*.swap|/etc/systemd/system/*.device)
      basename "$installed_path"
      ;;
    /etc/systemd/system/*.service.d/*|/etc/systemd/system/*.timer.d/*|/etc/systemd/system/*.socket.d/*|\
    /etc/systemd/system/*.mount.d/*|/etc/systemd/system/*.path.d/*|/etc/systemd/system/*.target.d/*|\
    /etc/systemd/system/*.slice.d/*|/etc/systemd/system/*.scope.d/*|/etc/systemd/system/*.automount.d/*|\
    /etc/systemd/system/*.swap.d/*|/etc/systemd/system/*.device.d/*)
      basename "$(dirname "$installed_path")"
      ;;
    *)
      return 1
      ;;
  esac
}
