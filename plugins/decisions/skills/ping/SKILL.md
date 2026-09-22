---
name: ping
description: Check that the decisions toolkit is installed and that the decision model endpoint is reachable from this shell. Use when the user asks to check, test or troubleshoot the decisions setup or connectivity, or before a first decision call in a new environment.
---

# Ping the decision model

Run this in the shell:

```sh
decide ping --format brief
```

It makes no decision and spends nothing: it reads the model's public endpoint listing, so it needs no API key.

Report the single line it prints **verbatim**, then interpret it:

- `decide ping: ok — …` means the CLI is installed and the endpoint is reachable. `key: absent` is fine for now; it only means live decisions are unavailable and replay is the only mode.
- `decide ping: FAILED — …` with a DNS or connection error usually means the shell sandbox blocks network access. Say so, and name the host (`openrouter.ai`) the user would need to allow.
- `decide: command not found` means the CLI is not on `PATH`. Say the decisions CLI is not installed; do not try to install it yourself.

Do not retry more than once, and do not run any other `decide` command.
