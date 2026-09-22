#!/usr/bin/env python3
"""Encrypt data/tracker.json into docs/data.enc and (optionally) push.

Usage:
  python3 sync/build.py            # encrypt only
  python3 sync/build.py --push     # encrypt, commit, push to GitHub Pages

The passphrase lives in sync/passphrase.txt (gitignored). The public repo
only ever contains ciphertext. Anyone with the passphrase can open the page.
"""
import base64, json, os, subprocess, sys, time, datetime
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "tracker.json")
OUT = os.path.join(ROOT, "docs", "data.enc")
PASS = os.path.join(ROOT, "sync", "passphrase.txt")
ITER = 600_000

def b64(b): return base64.b64encode(b).decode()

def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    data["generated_at"] = datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")
    with open(SRC, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    passphrase = open(PASS, encoding="utf-8").read().strip().encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(passphrase)
    ct = AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False).encode(), None)
    bundle = {"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct), "generated_at": data["generated_at"]}
    with open(OUT, "w") as f:
        json.dump(bundle, f)
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
