# cookies-and-cream

A small encrypted dashboard. Static page, client side decryption, no server and
no backend. The repository stores only ciphertext.

Open the Pages URL and enter the passphrase.

## Layout

    data/       local only, gitignored, never published
    docs/       the page and data.enc (ciphertext)
    sync/       build and patch scripts

## Crypto

AES-256-GCM. The key is derived in the browser with PBKDF2-SHA256 at 600,000
iterations, using a fresh 16 byte salt and 12 byte IV on every build. Without
the passphrase the payload is noise.

## Build

    python3 sync/build.py          # encrypt data/tracker.json to docs/data.enc
    python3 sync/build.py --push   # ... and commit and push

`sync/apply.py` applies a JSON patch to the local data and then calls the build.
