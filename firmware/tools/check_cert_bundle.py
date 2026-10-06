"""
Checks src/cert_bundle.cpp the way the device uses it (esp_crt_bundle.c in the Arduino
core): reads the bundle bytes, binary-searches an intermediate certificate's issuer with
the same memcmp rule, and verifies the intermediate's signature with the found public key.

    python tools/check_cert_bundle.py <dir with intermediate certificates (*.cer, DER)>

Intermediates whose issuer is not in the bundle are listed as such (expected for CAs we
do not include).
"""
import glob, os, re, sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "..", "src", "cert_bundle.cpp"), encoding="utf-8").read()
blob = bytes(int(x, 16) for x in re.findall(r"0x([0-9a-f]{2})", src[src.index("CERT_BUNDLE[] = {"):]))

# esp_crt_bundle_init: count, then (name_len, key_len, name, key) records
count = blob[0] << 8 | blob[1]
recs, at = [], 2
for _ in range(count):
    nl, kl = blob[at] << 8 | blob[at + 1], blob[at + 2] << 8 | blob[at + 3]
    recs.append((blob[at + 4:at + 4 + nl], blob[at + 4 + nl:at + 4 + nl + kl]))
    at += 4 + nl + kl
assert at == len(blob), "trailing bytes"


def memcmp(a, b, n):
    a, b = a[:n].ljust(n, b"\0"), b[:n]
    return (a > b) - (a < b)


def lookup(issuer_raw):
    # the device's binary search (esp_crt_verify_callback)
    start, end = 0, count - 1
    middle = (end - start) // 2
    while start <= end:
        name = recs[middle][0]
        r = memcmp(issuer_raw, name, len(name))
        if r == 0:
            return recs[middle]
        if r < 0:
            end = middle - 1
        else:
            start = middle + 1
        middle = (start + end) // 2
    return None


ok = missing = bad = 0
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.cer"))):
    c = x509.load_der_x509_certificate(open(path, "rb").read())
    found = lookup(c.issuer.public_bytes())
    label = c.subject.rfc4514_string()[:60]
    if not found:
        missing += 1
        print(f"  not in bundle: {label}  (issuer {c.issuer.rfc4514_string()[:50]})")
        continue
    key = serialization.load_der_public_key(found[1])
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(c.signature, c.tbs_certificate_bytes, ec.ECDSA(c.signature_hash_algorithm))
        else:
            key.verify(c.signature, c.tbs_certificate_bytes, padding.PKCS1v15(), c.signature_hash_algorithm)
        ok += 1
        print(f"  OK   {label}")
    except Exception as e:
        bad += 1
        print(f"  BAD  {label}: {e}")
print(f"{count} roots in the bundle; intermediates verified {ok}, issuer not in bundle {missing}, failed {bad}")
sys.exit(1 if bad else 0)
