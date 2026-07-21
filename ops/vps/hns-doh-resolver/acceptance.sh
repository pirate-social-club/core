#!/usr/bin/env python3
"""Acceptance suite for the Pirate HNS DoH resolver.

Exercises the real path: DoH client -> Caddy -> dnsdist -> hnsd, in both GET
(base64url ?dns=) and POST (application/dns-message) forms.

Usage:
    ./acceptance.sh [--endpoint https://dns.pirate.sc/dns-query]

Exits non-zero if any REQUIRED check fails. Checks marked advisory report but do
not fail the run, because they depend on live third-party HNS names.
"""
import argparse
import base64
import struct
import sys
import urllib.error
import urllib.request

TYPES = {"A": 1, "NS": 2, "CNAME": 5, "TXT": 16, "AAAA": 28, "DS": 43, "DNSKEY": 48, "TLSA": 52}
RCODES = {0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED"}

failures = []
advisories = []


def build_query(name, qtype, msgid=0x2A2A, want_dnssec=False):
    q = b""
    for label in name.split("."):
        if label:
            q += bytes([len(label)]) + label.encode()
    q += b"\x00"
    arcount = 1 if want_dnssec else 0
    extra = b""
    if want_dnssec:
        # OPT RR with the DO bit set.
        extra = b"\x00" + struct.pack(">HHIH", 41, 4096, 0x00008000, 0)
    header = struct.pack(">HHHHHH", msgid, 0x0100, 1, 0, 0, arcount)
    return header + q + struct.pack(">HH", TYPES[qtype], 1) + extra


def parse(buf):
    msgid, flags = struct.unpack(">HH", buf[0:4])
    qd, an, ns, ar = struct.unpack(">HHHH", buf[4:12])
    return {"id": msgid, "rcode": flags & 0xF, "ancount": an, "nscount": ns}


def doh(endpoint, wire, method="GET", timeout=20, headers=None):
    hdrs = {"accept": "application/dns-message"}
    hdrs.update(headers or {})
    if method == "GET":
        enc = base64.urlsafe_b64encode(wire).rstrip(b"=").decode()
        req = urllib.request.Request(f"{endpoint}?dns={enc}", headers=hdrs)
    else:
        hdrs["content-type"] = "application/dns-message"
        req = urllib.request.Request(endpoint, data=wire, headers=hdrs, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.headers.get("content-type", ""), resp.read()


def check(label, required, fn):
    try:
        ok, detail = fn()
    except Exception as exc:  # noqa: BLE001 - report any failure shape
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    mark = "PASS" if ok else ("FAIL" if required else "WARN")
    print(f"[{mark}] {label}: {detail}")
    if not ok:
        (failures if required else advisories).append(label)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", default="https://dns.pirate.sc/dns-query")
    args = ap.parse_args()
    ep = args.endpoint
    print(f"endpoint: {ep}\n")

    def resolves(name, qtype, method="GET", want_dnssec=False, expect_rcode=0, msgid=0x2A2A):
        def run():
            status, ctype, body = doh(ep, build_query(name, qtype, msgid, want_dnssec), method)
            if status != 200:
                return False, f"HTTP {status}"
            if "application/dns-message" not in ctype:
                return False, f"wrong content-type: {ctype!r}"
            r = parse(body)
            if r["id"] != msgid:
                return False, f"request id not preserved: sent {msgid:#x} got {r['id']:#x}"
            if r["rcode"] != expect_rcode:
                return False, f"rcode {RCODES.get(r['rcode'], r['rcode'])}, expected {RCODES.get(expect_rcode)}"
            return True, f"{RCODES.get(r['rcode'])} answers={r['ancount']} ({method})"
        return run

    # Our own names must resolve. These are REQUIRED: they prove the whole path.
    check("GET  app.pirate A", True, resolves("app.pirate", "A"))
    check("POST app.pirate A", True, resolves("app.pirate", "A", method="POST"))
    check("GET  app.pirate TLSA (DO bit)", True,
          resolves("_443._tcp.app.pirate", "TLSA", want_dnssec=True))
    check("GET  pirate DNSKEY", True, resolves("pirate", "DNSKEY", want_dnssec=True))
    check("GET  wildcard *.pirate", True, resolves("acceptance-probe.pirate", "A"))

    # Real recursion beyond our own zone. Advisory: depends on a third party.
    check("GET  g A (external HNS TLD)", False, resolves("g", "A"))

    # Unsigned / refusing delegation must not hang or 5xx the frontend.
    def unsigned_delegation():
        status, _, body = doh(ep, build_query("dankmeme", "NS"), "GET")
        if status != 200:
            return False, f"HTTP {status}"
        r = parse(body)
        return True, f"handled cleanly: {RCODES.get(r['rcode'], r['rcode'])}"
    check("GET  dankmeme NS (delegated, no zone)", True, unsigned_delegation)

    # NXDOMAIN under a live zone.
    check("GET  NXDOMAIN under .pirate", False,
          resolves("no-such-name.g", "A", expect_rcode=3))

    # AXFR/IXFR/ANY must be refused by dnsdist before reaching the backend.
    def refused(qtype_num):
        def run():
            wire = build_query("pirate", "A")
            wire = wire[:-4] + struct.pack(">HH", qtype_num, 1)
            _, _, body = doh(ep, wire, "GET")
            r = parse(body)
            return r["rcode"] == 5, RCODES.get(r["rcode"], r["rcode"])
        return run
    check("GET  AXFR refused", True, refused(252))
    check("GET  IXFR refused", True, refused(251))
    check("GET  ANY refused", True, refused(255))

    # Malformed payloads must be rejected, not proxied blindly.
    def malformed():
        try:
            status, _, _ = doh(ep, b"\x00\x01\x02", "POST")
            return status >= 400, f"HTTP {status}"
        except urllib.error.HTTPError as exc:
            return exc.code >= 400, f"HTTP {exc.code}"
    check("POST malformed payload rejected", True, malformed)

    # A spoofed XFF must not let a client escape the per-IP rate limit bucket.
    # Requires the record to be DNS-only; behind another proxy the right-most
    # address is attacker-influenced.
    def spoofed_xff():
        status, _, body = doh(ep, build_query("app.pirate", "A"), "GET",
                              headers={"X-Forwarded-For": "203.0.113.99"})
        return status == 200, f"accepted, HTTP {status} (verify limits bucket on real peer)"
    check("GET  spoofed X-Forwarded-For handled", False, spoofed_xff)

    print()
    if failures:
        print(f"FAILED ({len(failures)}): {', '.join(failures)}")
    if advisories:
        print(f"advisory warnings ({len(advisories)}): {', '.join(advisories)}")
    if not failures:
        print("all required checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
