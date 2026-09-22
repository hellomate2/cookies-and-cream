#!/usr/bin/env python3
"""Encrypt data/tracker.json into docs/data.enc and (optionally) push.

Usage:
  python3 sync/build.py            # encrypt only
  python3 sync/build.py --push     # encrypt, commit, push to GitHub Pages

The passphrase lives in sync/passphrase.txt (gitignored). The public repo
only ever contains ciphertext. Anyone with the passphrase can open the page.
"""
import base64, fcntl, hashlib, json, os, subprocess, sys, tempfile, datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "tracker.json")
OUT = os.path.join(ROOT, "docs", "data.enc")
PASS = os.path.join(ROOT, "sync", "passphrase.txt")
ITER = 600_000

LOCK = os.path.join(ROOT, "sync", ".lock")

def b64(b): return base64.b64encode(b).decode()

def write_atomic(path, text):
    """Write via temp file + rename so a crash or an overlapping run cannot
    leave a half-written file behind."""
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise

def payload_digest(data):
    """Fingerprint of the real content, ignoring the generated_at stamp.
    Lets us skip a rebuild when nothing actually changed, so the repo does not
    collect an empty commit every 5 minutes forever."""
    d = {k: v for k, v in data.items() if k != "generated_at"}
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def main():
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("another build is already running; skipping")
        return

    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    digest = payload_digest(data)
    prev = None
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT)).get("digest")
        except (ValueError, OSError):
            prev = None
    if prev == digest and "--force" not in sys.argv:
        print("content unchanged; nothing to rebuild")
        return

    data["generated_at"] = datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")
    write_atomic(SRC, json.dumps(data, indent=1, ensure_ascii=False))

    passphrase = open(PASS, encoding="utf-8").read().strip().encode()
    if len(passphrase) < 12:
        sys.exit("refusing to build: passphrase is under 12 characters")
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(passphrase)
    ct = AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False).encode(), None)
    bundle = {"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct),
              "generated_at": data["generated_at"], "digest": digest}
    write_atomic(OUT, json.dumps(bundle))
    print(f"wrote {OUT} ({len(ct)} bytes ciphertext, {len(data.get('tasks', []))} tasks)")
    if "--push" in sys.argv:
        subprocess.run(["git", "-C", ROOT, "add", "docs/data.enc"], check=True)
        r = subprocess.run(["git", "-C", ROOT, "diff", "--cached", "--quiet"])
        if r.returncode == 0:
            print("nothing changed"); return
        subprocess.run(["git", "-C", ROOT, "commit", "-q", "-m", f"sync {data['generated_at']}"], check=True)
        subprocess.run(["git", "-C", ROOT, "push", "-q"], check=True)
        print("pushed")

if __name__ == "__main__":
    main()
