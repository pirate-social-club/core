#!/usr/bin/env bash

# Shared helpers for immutable S3-compatible backup uploads. Callers provide
# the BACKUP_* environment variables and upload objects before invoking
# verify_object_retention.

backup_require_retention_config() {
  local name
  for name in BACKUP_RCLONE_REMOTE BACKUP_S3_ENDPOINT BACKUP_S3_REGION \
    BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY \
    BACKUP_MIN_RETENTION_DAYS; do
    if [[ -z "${!name:-}" ]]; then
      echo "missing required environment variable: $name" >&2
      return 1
    fi
  done
  if ! [[ "$BACKUP_MIN_RETENTION_DAYS" =~ ^[0-9]+$ ]] \
    || (( BACKUP_MIN_RETENTION_DAYS < 1 )); then
    echo "BACKUP_MIN_RETENTION_DAYS must be a positive integer" >&2
    return 1
  fi
}

backup_object_key() {
  local object_name=$1
  local remote_base=${BACKUP_RCLONE_REMOTE%/}
  local remote_path=${remote_base#*:}
  local bucket=${remote_path%%/*}
  local prefix=${remote_path#"$bucket"}
  prefix=${prefix#/}

  if [[ -z "$bucket" || "$remote_path" == "$remote_base" ]]; then
    echo "cannot derive bucket from BACKUP_RCLONE_REMOTE '$BACKUP_RCLONE_REMOTE'" >&2
    return 1
  fi
  printf '%s\n' "${prefix:+$prefix/}$object_name"
}

verify_object_retention() {
  local object_name=$1
  local object_key url sigv4 head_output version_id retention_xml mode
  local retain_until retain_epoch minimum_epoch
  local remote_path bucket

  backup_require_retention_config
  object_key=$(backup_object_key "$object_name")
  remote_path=${BACKUP_RCLONE_REMOTE%/}
  remote_path=${remote_path#*:}
  bucket=${remote_path%%/*}
  url="${BACKUP_S3_ENDPOINT%/}/$bucket/$object_key"
  sigv4="aws:amz:$BACKUP_S3_REGION:s3"

  if ! head_output="$(curl --fail --silent --show-error --head --max-time 30 \
    --aws-sigv4 "$sigv4" \
    --user "$BACKUP_S3_ACCESS_KEY_ID:$BACKUP_S3_SECRET_ACCESS_KEY" \
    "$url")"; then
    echo "retention verification: HEAD failed for $object_key" >&2
    return 1
  fi
  version_id=$(sed -nE \
    's/^x-amz-version-id:[[:space:]]*([^[:space:]]+).*$/\1/Ip' \
    <<< "$head_output" | head -n 1)
  if [[ -z "$version_id" ]]; then
    echo "retention verification: no x-amz-version-id on $object_key (bucket not versioned/locked?)" >&2
    return 1
  fi

  if ! retention_xml="$(curl --fail --silent --show-error --max-time 30 \
    --aws-sigv4 "$sigv4" \
    --user "$BACKUP_S3_ACCESS_KEY_ID:$BACKUP_S3_SECRET_ACCESS_KEY" \
    "$url?retention=&versionId=$version_id")"; then
    echo "retention verification: GetObjectRetention failed for $object_key" >&2
    return 1
  fi
  mode=$(sed -nE 's/.*<Mode>([^<]+)<\/Mode>.*/\1/p' \
    <<< "$retention_xml" | head -n 1)
  retain_until=$(sed -nE \
    's/.*<RetainUntilDate>([^<]+)<\/RetainUntilDate>.*/\1/p' \
    <<< "$retention_xml" | head -n 1)
  if [[ "${mode^^}" != COMPLIANCE ]]; then
    echo "retention verification: $object_key mode is '${mode:-absent}', expected COMPLIANCE" >&2
    return 1
  fi
  if ! retain_epoch=$(date -u -d "$retain_until" +%s 2>/dev/null); then
    echo "retention verification: unparseable RetainUntilDate '$retain_until' on $object_key" >&2
    return 1
  fi
  # One hour of slack covers upload duration and clock skew.
  minimum_epoch=$(( $(date -u +%s) + BACKUP_MIN_RETENTION_DAYS * 86400 - 3600 ))
  if (( retain_epoch < minimum_epoch )); then
    echo "retention verification: $object_key locked only until $retain_until, weaker than the ${BACKUP_MIN_RETENTION_DAYS}-day policy" >&2
    return 1
  fi
  echo "retention verified: $object_key COMPLIANCE until $retain_until"
}
