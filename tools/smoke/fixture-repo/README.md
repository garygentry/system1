# Smoke fixture repo

Copied into a scratch directory outside the repo (`~/.cache/decisions-smoke/` by default) by `tools/smoke/*.sh`. The `smoke` spec's answers are committed under `.decisions/fixtures/smoke/`, so `decide many --spec smoke` runs in replay with no key and no network.

To re-record (about $0.0002, needs a key and consent in the repo root), run `sh tools/smoke/record.sh`.
