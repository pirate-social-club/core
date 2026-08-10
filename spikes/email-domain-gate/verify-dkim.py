#!/usr/bin/env python3

"""Cryptographically verify DKIM without emitting private message material."""

from __future__ import annotations

import argparse
import base64
from contextlib import nullcontext
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import json
import os
import re
import tempfile
from pathlib import Path
from time import time as wall_time
from unittest.mock import patch

import dkim


LABEL_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
REQUIRED_SIGNED_HEADERS = (b"from", b"subject")
SIGNATURE_TIME_POLICIES = ("enforce", "record-only")


def has_from_oversigning(signed_headers: list[bytes]) -> bool:
    return signed_headers.count(b"from") >= 2


def canonicalization_modes(value: bytes | None) -> tuple[str, str, str]:
    raw_value = value or b"simple/simple"
    parts = raw_value.decode("ascii", errors="replace").lower().split("/", 1)
    header = parts[0]
    body = parts[1] if len(parts) == 2 else "simple"
    return f"{header}/{body}", header, body


def parse_unix_tag(value: bytes | None) -> int | None:
    if value is None or re.fullmatch(br"\d+", value) is None:
        return None
    return int(value)


def signature_time_metadata(
    tags: dict[bytes, bytes],
    observed_at: int,
) -> dict[str, int | str | None]:
    timestamp = parse_unix_tag(tags.get(b"t"))
    expiration = parse_unix_tag(tags.get(b"x"))
    validity_seconds = (
        expiration - timestamp
        if timestamp is not None
        and expiration is not None
        and expiration >= timestamp
        else None
    )
    if b"t" not in tags:
        timestamp_status = "not-declared"
    elif timestamp is None:
        timestamp_status = "invalid"
    elif timestamp > observed_at:
        timestamp_status = "future"
    else:
        timestamp_status = "not-future"
    if b"x" not in tags:
        expiration_status = "not-declared"
    elif expiration is None:
        expiration_status = "invalid"
    elif expiration < observed_at:
        expiration_status = "expired"
    else:
        expiration_status = "unexpired"
    return {
        "signature_timestamp": timestamp,
        "signature_timestamp_status": timestamp_status,
        "signature_expiration": expiration,
        "signature_validity_seconds": validity_seconds,
        "signature_expiration_status": expiration_status,
    }


def record_only_verification_time(tags: dict[bytes, bytes], observed_at: int) -> int:
    timestamp = parse_unix_tag(tags.get(b"t"))
    expiration = parse_unix_tag(tags.get(b"x"))
    if timestamp is not None:
        return timestamp
    if expiration is not None:
        return min(observed_at, expiration)
    return observed_at


def signature_time_validation_context(
    tags: dict[bytes, bytes],
    observed_at: int,
    policy: str,
):
    if policy == "enforce":
        return nullcontext()

    effective_time = record_only_verification_time(tags, observed_at)
    original_validate = dkim.validate_signature_fields

    def validate_at_effective_time(*args, **kwargs):
        with patch.object(dkim.time, "time", return_value=effective_time):
            return original_validate(*args, **kwargs)

    return patch.object(
        dkim,
        "validate_signature_fields",
        side_effect=validate_at_effective_time,
    )


def classify_error(error: Exception) -> str:
    message = str(error).lower()
    if "body hash mismatch" in message:
        return "body_hash_mismatch"
    if "x= value is past" in message:
        return "signature_expired"
    if "t= value is in the future" in message:
        return "signature_timestamp_in_future"
    if isinstance(error, dkim.ValidationError):
        return "validation_error"
    if isinstance(error, dkim.MessageFormatError):
        return "message_format_error"
    return "verification_error"


def canonical_domain(value: bytes | str | None) -> str | None:
    if value is None:
        return None
    text = value.decode("ascii", errors="strict") if isinstance(value, bytes) else value
    candidate = text.strip().rstrip(".").lower()
    if not candidate:
        return None
    try:
        return candidate.encode("idna").decode("ascii")
    except UnicodeError:
        return None


def parse_single_from_domain(raw_message: bytes) -> str | None:
    message = BytesParser(policy=policy.default).parsebytes(raw_message, headersonly=True)
    from_headers = message.get_all("from", [])
    if len(from_headers) != 1:
        return None
    addresses = [(name, address) for name, address in getaddresses(from_headers) if address]
    if len(addresses) != 1:
        return None
    _name, address = addresses[0]
    _local, separator, domain = address.rpartition("@")
    return canonical_domain(domain) if separator else None


def verify_header_signature(
    raw_message: bytes,
    index: int,
    *,
    dnsfunc=dkim.get_txt,
) -> bool:
    """Verify signed headers while deliberately skipping the DKIM body hash."""
    verifier = dkim.DKIM(raw_message)
    prepared = verifier.verify_headerprep(index)
    if not prepared:
        return False

    signature_tags, include_headers, signature_headers = prepared
    key_name = (
        signature_tags[b"s"]
        + b"._domainkey."
        + signature_tags[b"d"]
        + b"."
    )
    public_key, key_size, key_type, _tls_report = dkim.load_pk_from_dns(
        key_name,
        dnsfunc,
        timeout=verifier.timeout,
    )
    canonicalization = dkim.CanonicalizationPolicy.from_c_value(
        signature_tags.get(b"c", b"simple/simple")
    )
    hasher = dkim.HASH_ALGORITHMS[signature_tags[b"a"]]
    selected_headers = list(include_headers)
    # Mirror dkimpy's fail-closed handling of ambiguous multiple-From messages.
    # This deliberately makes a signature that covers only one of two From
    # fields fail instead of authenticating an attacker-controlled extra From.
    if b"from" in selected_headers:
        selected_headers.append(b"from")
    digest = dkim.HashThrough(hasher(), False)
    canonical_headers = canonicalization.canonicalize_headers(verifier.headers)
    dkim.hash_headers(
        digest,
        canonicalization,
        canonical_headers,
        selected_headers,
        signature_headers[index],
        signature_tags,
    )
    signature = base64.b64decode(re.sub(br"\s+", b"", signature_tags[b"b"]))

    if key_type == b"rsa":
        verified = bool(dkim.RSASSA_PKCS1_v1_5_verify(digest, signature, public_key))
        if verified and key_size < verifier.minkey:
            raise dkim.KeyFormatError(f"public key too small: {key_size}")
        return verified
    if key_type == b"ed25519":
        try:
            public_key.verify(digest.digest(), signature)
            return True
        except Exception:
            return False
    raise dkim.UnknownKeyTypeError(key_type)


def verify_message(
    raw_message: bytes,
    label: str,
    *,
    ignore_body_hash: bool = False,
    signature_time_policy: str = "enforce",
    dnsfunc=dkim.get_txt,
) -> dict[str, object]:
    if not LABEL_PATTERN.fullmatch(label):
        raise ValueError("label must be a non-identifying slug of 1-64 characters")
    if signature_time_policy not in SIGNATURE_TIME_POLICIES:
        raise ValueError(
            f"signature_time_policy must be one of {', '.join(SIGNATURE_TIME_POLICIES)}"
        )

    observed_at = int(wall_time())
    parsed = dkim.DKIM(raw_message)
    from_domain = parse_single_from_domain(raw_message)
    signature_headers = [
        value for name, value in parsed.headers if name.lower() == b"dkim-signature"
    ]
    signature_count = len(signature_headers)
    signatures: list[dict[str, object]] = []

    for index in range(signature_count):
        tags = dkim.parse_tag_value(signature_headers[index])
        signing_domain = canonical_domain(tags.get(b"d"))
        selector = tags.get(b"s")
        selector_text = selector.decode("ascii", errors="replace") if selector else None
        algorithm = tags.get(b"a")
        algorithm_text = (
            algorithm.decode("ascii", errors="replace").lower()
            if algorithm
            else None
        )
        signed_headers = [
            item.strip().lower()
            for item in tags.get(b"h", b"").split(b":")
            if item.strip()
        ]
        required_headers_signed = {
            name.decode("ascii"): name in signed_headers
            for name in REQUIRED_SIGNED_HEADERS
        }
        from_oversigned = has_from_oversigning(signed_headers)
        canonicalization, header_canonicalization, body_canonicalization = (
            canonicalization_modes(tags.get(b"c"))
        )
        time_metadata = signature_time_metadata(tags, observed_at)
        strict_from_alignment = (
            signing_domain is not None
            and from_domain is not None
            and signing_domain == from_domain
        )
        verifier = dkim.DKIM(raw_message)
        with signature_time_validation_context(
            tags,
            observed_at,
            signature_time_policy,
        ):
            try:
                verified = bool(verifier.verify(index, dnsfunc=dnsfunc))
                failure_code = None if verified else "signature_or_key_verification_failed"
            except Exception as error:  # dkimpy exposes several format/validation subclasses.
                verified = False
                failure_code = classify_error(error)

            header_signature_only_verified = None
            header_signature_only_failure_code = None
            if ignore_body_hash:
                try:
                    header_signature_only_verified = verify_header_signature(
                        raw_message,
                        index,
                        dnsfunc=dnsfunc,
                    )
                    if not header_signature_only_verified:
                        header_signature_only_failure_code = "header_signature_verification_failed"
                except Exception as error:
                    header_signature_only_verified = False
                    header_signature_only_failure_code = classify_error(error)
        required_coverage = all(required_headers_signed.values())
        gate_usable = verified and strict_from_alignment and required_coverage
        header_signature_only_gate_usable = (
            header_signature_only_verified
            and strict_from_alignment
            and required_coverage
            if header_signature_only_verified is not None
            else None
        )
        signatures.append({
            "index": index,
            "signing_domain": signing_domain,
            "selector": selector_text,
            "algorithm": algorithm_text,
            "signed_headers": [
                name.decode("ascii", errors="replace") for name in signed_headers
            ],
            "canonicalization": canonicalization,
            "header_canonicalization": header_canonicalization,
            "body_canonicalization": body_canonicalization,
            "draft_regex_header_assumption_met": header_canonicalization == "relaxed",
            **time_metadata,
            "signature_expiration_enforced": signature_time_policy == "enforce",
            "strict_from_alignment": strict_from_alignment,
            "required_headers_signed": required_headers_signed,
            "from_oversigned": from_oversigned,
            "verified": verified,
            "failure_code": failure_code,
            "gate_usable": gate_usable,
            "header_signature_only_verified": header_signature_only_verified,
            "header_signature_only_failure_code": header_signature_only_failure_code,
            "header_signature_only_gate_usable": header_signature_only_gate_usable,
        })

    header_only_results = [
        item["header_signature_only_verified"]
        for item in signatures
        if item["header_signature_only_verified"] is not None
    ]
    return {
        "schema_version": 3,
        "label": label,
        # The policy owns alignment. Expose the canonical From domain only when
        # a DKIM candidate exists; a no-signature diagnostic must not disclose it.
        "from_domain": from_domain if signature_count > 0 else None,
        "observed_at_unix": observed_at,
        "signature_time_policy": signature_time_policy,
        "dkim_signature_count": signature_count,
        "has_verified_dkim": any(item["verified"] for item in signatures),
        "has_verified_aligned_dkim": any(
            item["verified"] and item["strict_from_alignment"] for item in signatures
        ),
        "has_gate_usable_dkim": any(item["gate_usable"] for item in signatures),
        "all_dkim_signatures_verified": signature_count > 0 and all(
            item["verified"] for item in signatures
        ),
        "header_signature_only_verified": (
            any(header_only_results) if header_only_results else None
        ),
        "signatures": signatures,
        "note": (
            "Cryptographic verification against DNS; header-only verification is diagnostic "
            "and does not make a DKIM-invalid message valid; DKIM t=/x= are reported under "
            "the selected signature-time policy; no message or key material emitted."
        ),
    }


def expectation_met(result: dict[str, object], expected: str) -> bool:
    count = int(result["dkim_signature_count"])
    has_gate_usable = bool(result["has_gate_usable_dkim"])
    if expected == "pass":
        return has_gate_usable
    if expected == "fail":
        return count > 0 and not has_gate_usable
    return count == 0


def write_private_json(path: Path, result: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = f"{json.dumps(result, indent=2)}\n"
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(payload)
        os.replace(temporary_path, path)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        Path(temporary_path).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--expect", required=True, choices=("pass", "fail", "no-signature"))
    parser.add_argument(
        "--ignore-body-hash",
        action="store_true",
        help="also diagnose the signed-header signature without validating the body hash",
    )
    parser.add_argument(
        "--signature-time-policy",
        required=True,
        choices=SIGNATURE_TIME_POLICIES,
        help=(
            "enforce signer t=/x= against current time, or record-only to verify archived "
            "signature bytes while reporting timestamp status separately"
        ),
    )
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = verify_message(
        args.file.read_bytes(),
        args.label,
        ignore_body_hash=args.ignore_body_hash,
        signature_time_policy=args.signature_time_policy,
    )
    if args.out:
        write_private_json(args.out, result)
    else:
        print(json.dumps(result, indent=2))

    if not expectation_met(result, args.expect):
        print("DKIM result did not match the declared expectation", file=__import__("sys").stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
