import unittest

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("verify-dkim.py")
SPEC = spec_from_file_location("verify_dkim", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFY_DKIM = module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY_DKIM)


class VerifyDkimTest(unittest.TestCase):
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
        self.assertTrue(VERIFY_DKIM.expectation_met(result, "no-signature"))
        self.assertFalse(VERIFY_DKIM.expectation_met(result, "pass"))
        self.assertNotIn("private", serialized)
        self.assertNotIn("example.com", serialized)

    def test_body_hash_failures_are_sanitized(self) -> None:
        error = VERIFY_DKIM.dkim.ValidationError(
            "body hash mismatch (got secret-computed-hash, expected secret-signed-hash)"
        )
        self.assertEqual(VERIFY_DKIM.classify_error(error), "body_hash_mismatch")


if __name__ == "__main__":
    unittest.main()
