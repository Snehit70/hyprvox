# Setup verification makes a live network call by default

Setup previously only proved **Readiness** — that binaries exist and config parses —
which let a format-valid-but-wrong API key, a muted mic, or a denied permission pass
setup and only fail on first real use.

We added **Verification**: by default, setup makes a live auth ping to Groq and
Deepgram to confirm the keys actually work, with a full record-to-transcript run
available behind `hyprvox setup --verify`.

This is a deliberate trade-off. The upside is catching the most common real failure
(a bad key) at setup time instead of first use. The costs: setup now performs a
network call, an offline setup will fail the ping, and the key is sent to the
provider during setup rather than only at runtime. We judged early, honest failure
worth those costs; the ping is skippable, so the decision is cheap to revisit.
