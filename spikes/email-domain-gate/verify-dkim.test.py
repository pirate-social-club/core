import unittest
from unittest import mock

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("verify-dkim.py")
SPEC = spec_from_file_location("verify_dkim", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFY_DKIM = module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY_DKIM)

PRIVATE_KEY = b"""-----BEGIN PRIVATE KEY-----
MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAMLiP7CqbBt7pdO7
MTyd5cGo8D6YNJFkY5TJqddRwpqM73+RhM/jQ55P77TcH0XhemzZ4AA0YZ250flC
MoiqUvIqGfZTQ/08gh59oC82Xxtnilil7IF4ENWYF5EeauxCJw/0LjpdPUxNZ0DB
Ui1kHqTSQTLQ1ZxsTI6vt60sW06NAgMBAAECgYEAlqXYwBNtkG0ryhmpPQd+BQ83
79suv7mPtQOTFAxy14/cz4tI1H8E1UtLrE6Aqj9bqOtfWikj0I5FP16pu7WWeZ0D
i/3A+Cfu3z7qEiZwqVdneQNKAA5ipRBkzC0rSVho8H6ZNRudSCBionooiFQdHPVZ
WuPrc6MyiITU1BXXNeECQQDnMiC4Pfw80mldUuITAGK1auPkVvI9L8YDBTGOkUHS
qWOgJ3CiNiTRbEOtesqIhDVxjIL8t5XyFwybkWOCq8t5AkEA18rMd8XF7rUdEQOy
NandFWI9+HtpmhkZOooV79+yWbCil9JbhrxJkd31avvSgo8DtPs/mxXOVUTv3NSZ
ItmCtQJAfOmvlfwfmXkR5pNOhHez3VMoWAnGDdsPADjBIsdGqhxNMI2+pFXepKv7
EPMEFKhh+7ywVPyX7loXvMHb4xEQ+QJALQHyVYTdfKUv082mjMTKBNzBuiLbarWT
an9EhgxtIYHS18GbL2X0HkViG5c8V9jGWCgTIyCQMX64XKHG8trVBQJBAN8FcVfZ
+CPTEFFQzWykUXExwjIqjb6MzrcuOjuOX06mT17s3fRv3hy2CK8aesdlECK142ct
QiVhxfzTliTLEmE=
-----END PRIVATE KEY-----
"""
PUBLIC_KEY_DNS = (
    b"v=DKIM1; k=rsa; p="
    b"MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC4j+wqmwbe6XTuzE8neXBqPA+"
    b"mDSRZGOUyanXUcKajO9/kYTP40OeT++03B9F4Xps2eAANGGdudH5QjKIqlLyKhn2"
    b"U0P9PIIefaAvNl8bZ4pYpeyBeBDVmBeRHmrsQicP9C46XT1MTWdAwVItZB6k0kEy"
    b"0NWcbEyOr7etLFtOjQIDAQAB"
)


def synthetic_dns(_name: bytes, timeout: int = 5) -> bytes:
    del timeout
    return PUBLIC_KEY_DNS


def signed_message(
    *,
    signing_domain: bytes = b"example.test",
    header_canonicalization: bytes = b"relaxed",
    oversign_from: bool = False,
) -> bytes:
    message = (
        b"From: employee@example.test\r\n"
        b"To: personal@example.net\r\n"
        b"Subject: Account verification code: synthetic-nonce\r\n"
        b"Date: Tue, 5 Aug 2026 12:00:00 +0000\r\n\r\n"
        b"synthetic body\r\n"
    )
    include_headers = [b"from", b"to", b"subject", b"date"]
    if oversign_from:
        include_headers.append(b"from")
    signature = VERIFY_DKIM.dkim.sign(
        message,
        b"test",
        signing_domain,
        PRIVATE_KEY,
        canonicalize=(header_canonicalization, b"relaxed"),
        include_headers=include_headers,
    )
    return signature + message


def expired_signed_message() -> bytes:
    message = (
        b"From: employee@example.test\r\n"
        b"To: personal@example.net\r\n"
        b"Subject: Account verification code: synthetic-expired\r\n"
        b"Date: Tue, 5 Aug 2026 12:00:00 +0000\r\n\r\n"
        b"synthetic body\r\n"
    )
    signer = VERIFY_DKIM.dkim.DKIM(message)
    original_gen_header = signer.gen_header

    def gen_header_with_expiration(fields, *args, **kwargs):
        expanded_fields = []
        for field in fields:
            if field[0] == b"h":
                expanded_fields.append((b"x", b"1003600"))
            expanded_fields.append(field)
        return original_gen_header(expanded_fields, *args, **kwargs)

    with (
        mock.patch.object(VERIFY_DKIM.dkim.time, "time", return_value=1000000),
        mock.patch.object(
            signer,
            "gen_header",
            side_effect=gen_header_with_expiration,
        ),
    ):
        signature = signer.sign(
            b"test",
            b"example.test",
            PRIVATE_KEY,
            canonicalize=(b"relaxed", b"relaxed"),
            include_headers=[b"from", b"to", b"subject", b"date"],
        )
    return signature + message


class VerifyDkimTest(unittest.TestCase):
    def test_from_oversigning_requires_two_h_list_occurrences(self) -> None:
        self.assertFalse(
            VERIFY_DKIM.has_from_oversigning([b"from", b"subject", b"date"])
        )
        self.assertTrue(
            VERIFY_DKIM.has_from_oversigning(
                [b"from", b"subject", b"date", b"from"]
            )
        )

    def test_valid_non_oversigned_signature_remains_gate_usable(self) -> None:
        result = VERIFY_DKIM.verify_message(
            signed_message(),
            "synthetic-non-oversigned",
            dnsfunc=synthetic_dns,
        )

        self.assertTrue(result["has_verified_dkim"])
        self.assertTrue(result["has_gate_usable_dkim"])
        self.assertFalse(result["signatures"][0]["from_oversigned"])

    def test_records_header_and_body_canonicalization_modes(self) -> None:
        result = VERIFY_DKIM.verify_message(
            signed_message(header_canonicalization=b"simple"),
            "synthetic-simple-canonicalization",
            dnsfunc=synthetic_dns,
        )
        signature = result["signatures"][0]

        self.assertEqual(signature["canonicalization"], "simple/relaxed")
        self.assertEqual(signature["header_canonicalization"], "simple")
        self.assertEqual(signature["body_canonicalization"], "relaxed")
        self.assertFalse(signature["draft_regex_header_assumption_met"])
        self.assertEqual(signature["algorithm"], "rsa-sha256")
        self.assertIn("from", signature["signed_headers"])
        self.assertIn("subject", signature["signed_headers"])

    def test_no_signature_result_contains_no_message_material(self) -> None:
        message = (
            b"From: private@example.com\r\n"
            b"To: private@example.com\r\n"
            b"Subject: private subject\r\n\r\n"
            b"private body"
        )

        result = VERIFY_DKIM.verify_message(message, "synthetic-no-signature")
        serialized = __import__("json").dumps(result)

        self.assertEqual(result["dkim_signature_count"], 0)
        self.assertFalse(result["has_verified_dkim"])
        self.assertFalse(result["has_gate_usable_dkim"])
        self.assertTrue(VERIFY_DKIM.expectation_met(result, "no-signature"))
        self.assertFalse(VERIFY_DKIM.expectation_met(result, "pass"))
        self.assertIsNone(result["header_signature_only_verified"])
        self.assertNotIn("private", serialized)
        self.assertNotIn("example.com", serialized)

    def test_body_hash_failures_are_sanitized(self) -> None:
        error = VERIFY_DKIM.dkim.ValidationError(
            "body hash mismatch (got secret-computed-hash, expected secret-signed-hash)"
        )
        self.assertEqual(VERIFY_DKIM.classify_error(error), "body_hash_mismatch")

    def test_expiration_failure_has_a_distinct_code(self) -> None:
        result = VERIFY_DKIM.verify_message(
            expired_signed_message(),
            "synthetic-expired-enforced",
            signature_time_policy="enforce",
            dnsfunc=synthetic_dns,
        )
        signature = result["signatures"][0]

        self.assertFalse(signature["verified"])
        self.assertEqual(signature["failure_code"], "signature_expired")
        self.assertEqual(signature["signature_timestamp_status"], "not-future")
        self.assertEqual(signature["signature_expiration_status"], "expired")
        self.assertTrue(signature["signature_expiration_enforced"])

    def test_record_only_policy_verifies_expired_signature_bytes(self) -> None:
        result = VERIFY_DKIM.verify_message(
            expired_signed_message(),
            "synthetic-expired-record-only",
            signature_time_policy="record-only",
            dnsfunc=synthetic_dns,
        )
        signature = result["signatures"][0]

        self.assertTrue(signature["verified"])
        self.assertTrue(signature["gate_usable"])
        self.assertEqual(signature["signature_expiration_status"], "expired")
        self.assertEqual(signature["signature_validity_seconds"], 3600)
        self.assertFalse(signature["signature_expiration_enforced"])

    def test_pass_expectation_requires_an_aligned_gate_usable_signature(self) -> None:
        result = {
            "dkim_signature_count": 2,
            "has_verified_dkim": True,
            "has_gate_usable_dkim": False,
        }
        self.assertFalse(VERIFY_DKIM.expectation_met(result, "pass"))
        self.assertTrue(VERIFY_DKIM.expectation_met(result, "fail"))

    def test_header_only_verification_accepts_body_only_tampering(self) -> None:
        message = signed_message().replace(b"synthetic body", b"tampered body")
        result = VERIFY_DKIM.verify_message(
            message,
            "synthetic-body-tamper",
            ignore_body_hash=True,
            dnsfunc=synthetic_dns,
        )
        self.assertFalse(result["has_verified_dkim"])
        self.assertEqual(result["signatures"][0]["failure_code"], "body_hash_mismatch")
        self.assertTrue(result["header_signature_only_verified"])
        self.assertFalse(result["signatures"][0]["from_oversigned"])

    def test_header_only_verification_rejects_signed_subject_tampering(self) -> None:
        message = signed_message().replace(b"synthetic-nonce", b"tampered-nonce")
        result = VERIFY_DKIM.verify_message(
            message,
            "synthetic-subject-tamper",
            ignore_body_hash=True,
            dnsfunc=synthetic_dns,
        )
        self.assertFalse(result["has_verified_dkim"])
        self.assertFalse(result["header_signature_only_verified"])

    def test_valid_unaligned_signature_does_not_pass_gate(self) -> None:
        result = VERIFY_DKIM.verify_message(
            signed_message(signing_domain=b"relay.test"),
            "synthetic-unaligned",
            ignore_body_hash=True,
            dnsfunc=synthetic_dns,
        )
        self.assertTrue(result["has_verified_dkim"])
        self.assertFalse(result["has_verified_aligned_dkim"])
        self.assertFalse(result["has_gate_usable_dkim"])
        self.assertFalse(VERIFY_DKIM.expectation_met(result, "pass"))

    def test_ambiguous_second_from_fails_closed(self) -> None:
        message = signed_message().replace(
            b"From: employee@example.test\r\n",
            b"From: attacker@evil.test\r\nFrom: employee@example.test\r\n",
        )
        result = VERIFY_DKIM.verify_message(
            message,
            "synthetic-double-from",
            ignore_body_hash=True,
            dnsfunc=synthetic_dns,
        )
        self.assertFalse(result["has_verified_dkim"])
        self.assertFalse(result["header_signature_only_verified"])
        self.assertFalse(result["has_gate_usable_dkim"])


if __name__ == "__main__":
    unittest.main()
