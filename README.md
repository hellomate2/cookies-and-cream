# Cookies and Cream

One page that holds everything Alpha Theta needs to survive pledging: who owes
what, when it is due, who is banned from the listserv, every rule an active has
handed down, how to address each of them, and when your pledge brothers are
actually free.

The live page reads the listserv every 5 minutes and updates itself.

## Opening it

Go to the Pages URL and enter the passphrase. It is remembered on that device
afterwards, so you type it once.

## What is on it

**Now** is the default. Pick your name in the top right and it shows only what
you owe, split into Late, Next 24 hours, Later, and No deadline given. Switch to
Everyone to see the whole class. Tap any task for the proof required, the exact
words the active used for the deadline, what happens if it is late, and which
thread it came from.

**Board** is all 13 pledges side by side: open counts, active bans, running
punishments that grow over time, who is catching heat and who got praised.

**Rules** is every rule pulled out of the threads, grouped by kind, each with the
verbatim quote and who said it. Search it before you send anything.

**Actives** lists all 48 by pledge class with the exact form of address for each
one, plus what each of them reacts to. Getting a name wrong is a punishment, so
check here first.

**Calendar** is the shared Google Calendar, showing who is in class right now,
who is free, and whose midterm is coming up. Check it before volunteering
somebody for a 3 PM task.

**Threads** is a running summary of all 33 listserv threads.

## Security

The repo holds only `docs/data.enc`, which is AES-256-GCM ciphertext. The key is
derived from the passphrase with PBKDF2-SHA256 at 600,000 iterations, in your
browser. The plaintext (`data/tracker.json`) is gitignored and never leaves the
machine that runs the sync. Nobody without the passphrase can read anything, and
the page is marked noindex so it will not show up in search.

To change the passphrase, edit `sync/passphrase.txt` and rebuild with the push
flag. Everyone then re-enters the new one.

## How the sync works

    data/tracker.json   plaintext, local only, the source of truth
    sync/build.py       encrypts it to docs/data.enc, optionally commits and pushes
    sync/apply.py       applies a JSON patch to tracker.json, then calls build.py
    sync/state.json     the last listserv message already processed

A scheduled task runs every 5 minutes, reads any new mail on the pledge listserv,
writes a patch, and runs `apply.py` with the push flag. The page refetches
`data.enc` on its own timer, so open tabs pick up changes without a reload.

To update by hand, run `sync/build.py` with the push flag:

    python3 sync/build.py --push

## Rebuilding from scratch

`merge.py` rebuilds `tracker.json` from the per-thread extractions. You only need
it if the data gets mangled; day to day, `apply.py` does the work.
