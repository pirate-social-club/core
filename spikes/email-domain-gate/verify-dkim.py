#!/usr/bin/env python3

"""Cryptographically verify DKIM without emitting private message material."""

from __future__ import annotations

import argparse
import base64
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import json
import os
import re
import tempfile
from pathlib import Path

import dkim


LABEL_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
REQUIRED_SIGNED_HEADERS = (b"from", b"subject")


def classify_error(error: Exception) -> str:
    message = str(error).lower()
    if "body hash mismatch" in message:
        return "body_hash_mismatch"
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
    dnsfunc=dkim.get_txt,
) -> dict[str, object]:
    if not LABEL_PATTERN.fullmatch(label):
        raise ValueError("label must be a non-identifying slug of 1-64 characters")

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
        signed_headers = [
            item.strip().lower()
            for item in tags.get(b"h", b"").split(b":")
            if item.strip()
        ]
        required_headers_signed = {
            name.decode("ascii"): name in signed_headers
            for name in REQUIRED_SIGNED_HEADERS
        }
        strict_from_alignment = (
            signing_domain is not None
            and from_domain is not None
            and signing_domain == from_domain
        )
        verifier = dkim.DKIM(raw_message)
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
            "strict_from_alignment": strict_from_alignment,
            "required_headers_signed": required_headers_signed,
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
        "schema_version": 1,
        "label": label,
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
            "and does not make a DKIM-invalid message valid; no message or key material emitted."
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
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = verify_message(
        args.file.read_bytes(),
        args.label,
        ignore_body_hash=args.ignore_body_hash,
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
