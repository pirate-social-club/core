#!/usr/bin/env python3

import argparse
import json
import os
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


TEST_MODULE_PATH = Path(__file__).with_name("verify-dkim.test.py")


def load_test_module():
    spec = spec_from_file_location("verify_dkim_test_fixture", TEST_MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_private(path: Path, payload: bytes) -> None:
    path.write_bytes(payload)
    os.chmod(path, 0o600)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email-out", type=Path, required=True)
    parser.add_argument("--evidence-out", type=Path, required=True)
    parser.add_argument("--dns-out", type=Path, required=True)
    args = parser.parse_args()

    fixture = load_test_module()
    raw_email = fixture.expired_signed_message()
    verifier_result = fixture.VERIFY_DKIM.verify_message(
        raw_email,
        "synthetic-adapter-parity",
        ignore_body_hash=True,
        signature_time_policy="record-only",
        dnsfunc=fixture.synthetic_dns,
    )

    write_private(args.email_out, raw_email)
    write_private(
        args.evidence_out,
        f"{json.dumps(verifier_result, indent=2)}\n".encode(),
    )
    write_private(
        args.dns_out,
        f'{json.dumps({"record": fixture.PUBLIC_KEY_DNS.decode("ascii")}, indent=2)}\n'.encode(),
    )


if __name__ == "__main__":
    main()
