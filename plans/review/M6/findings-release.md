I would **hold publication briefly**. The built CLI works offline without runtime dependencies, and the three packages are sensibly separated. The biggest release risk is that packing is not tied to a verified build: a clean checkout successfully produces CLI and core tarballs containing no executable code. The current built candidate also omits bundled dependencies’ license notices. No repository files were changed.

## Findings

1. **High — Bundled dependency notices are missing.**  
   **File:** `packages/cli/bundle.mjs:21`.

   `legalComments: "none"` removes notices, and packaging supplies only System 1’s MIT license. The bundle contains YAML and other third-party implementations whose license files require retaining their notices.

   After packing and extracting the CLI under `/tmp/s1-review/unpacked/cli`, I ran:

   ```sh
   rtk proxy sh -c 'rg -l "node_modules/yaml/" /tmp/s1-review/unpacked/cli/package/dist/bundle/chunks/*; rg -n "Copyright|copyright|Permission is hereby|Eemeli|Jon Schlinkert|Haydn Paterson|Madeline" /tmp/s1-review/unpacked/cli/package'
   ```

   Observed:

   ```text
   /tmp/s1-review/unpacked/cli/package/dist/bundle/chunks/chunk-NC2C5BCS.mjs
   /tmp/s1-review/unpacked/cli/package/LICENSE:3:Copyright (c) 2026 Gary Gentry
   /tmp/s1-review/unpacked/cli/package/LICENSE:5:Permission is hereby granted, free of charge, to any person obtaining a copy
   /tmp/s1-review/unpacked/cli/package/LICENSE:12:The above copyright notice and this permission notice shall be included in all
   ```

   Reading `node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/LICENSE` confirmed its Eemeli Aro copyright and notice-retention condition.

   **Fix:** Generate and ship third-party notices for every bundled dependency. Verify their presence in the tarball; retaining source comments alone may be insufficient.

2. **Medium — The “pinned” shim silently accepts any other `decide`.**  
   **File:** `tools/generate.ts:225`, particularly line 234.

   The global lookup checks executability and excludes other shims, but checks neither identity nor version. Consequently, an older CLI can receive newer skill commands, or a newer incompatible CLI can service an older plugin. An unrelated executable also qualifies. `doctor` compares the running CLI against PATH, not against the plugin version, so it does not reliably detect this mismatch.

   Exact synthetic PATH reproduction:

   ```sh
   rtk proxy sh -c 'mkdir -p /tmp/s1-review/shim /tmp/s1-review/other; cp plugins/system1/bin/decide /tmp/s1-review/shim/decide; printf "#!/bin/sh\nprintf '\''0.0.9\\n'\''\n" > /tmp/s1-review/other/decide; chmod +x /tmp/s1-review/other/decide; env -u SYSTEM1_CLI PATH=/tmp/s1-review/other:/usr/bin:/bin SYSTEM1_NO_NPX=1 /tmp/s1-review/shim/decide version'
   ```

   Observed:

   ```text
   0.0.9
   ```

   This demonstrates bypass of the pin, not an actual historical-version incompatibility.

   **Fix:** Keep the pinned fallback. Require an identified, compatible CLI before accepting PATH, and make plugin/CLI compatibility explicit. Floating `npx` would compound the mismatch.

3. **Medium — Packing a clean checkout succeeds with broken packages.**  
   **Files:** `packages/cli/package.json:35`, `packages/core/package.json:47`.

   Both packages have `build`, but neither has a packing or publication guard. CI builds the workspace without testing the final tarballs. A forgotten build therefore produces apparently successful packages with dangling `bin` or `exports` targets.

   Exact reproduction, entirely in scratch:

   ```sh
   rtk proxy sh -c 'mkdir -p /tmp/s1-review/clean; git archive HEAD | tar -x -C /tmp/s1-review/clean; for p in cli core; do (cd /tmp/s1-review/clean/packages/$p && npm pack --cache /tmp/s1-review/npm-cache --pack-destination /tmp/s1-review/unbuilt/packs --json) > /tmp/s1-review/clean-$p.json; done; python3 -c '\''import json; [print(p, d["entryCount"], [f["path"] for f in d["files"]]) for p in ["cli", "core"] for d in json.load(open("/tmp/s1-review/clean-"+p+".json"))]'\'''
   ```

   Observed, exit 0:

   ```text
   cli 3 ['LICENSE', 'README.md', 'package.json']
   core 3 ['LICENSE', 'README.md', 'package.json']
   ```

   **Fix:** Add a release gate that builds, packs, installs and exercises the exact artifacts. Reject missing or stale output before publication.

4. **Low — The Pi tarball retains an unusable packing hook.**  
   **File:** `packages/pi/package.json:34`.

   The tarball includes `scripts.prepack`, but excludes `prepack.mjs`; that script also depends on the monorepo’s skills directory. Ordinary installation is unaffected, but unpacking and repacking fails, so this is not a self-contained source distribution.

   ```sh
   rtk proxy sh -c 'tar -xzf /tmp/s1-review/tarballs/garygentry-system1-pi-0.1.0.tgz -C /tmp/s1-review/unpacked; cd /tmp/s1-review/unpacked/package && npm pack --cache /tmp/s1-review/npm-cache --pack-destination /tmp/s1-review/tarballs'
   ```

   Observed, exit 1:

   ```text
   Error: Cannot find module '/tmp/s1-review/unpacked/package/prepack.mjs'
   ```

   **Fix:** Publish from a staging directory with build-only hooks removed, or make repacking use the already included skills.

## Checked and fine

- Built scratch copies packed successfully: CLI 13 files, core 151, Pi 13; Pi included all three skills, references and sidecars.
- Offline CLI installation reported `added 1 package`; its installed `decide version` printed `0.1.0`.
- Packed CLI `many --dry-run`, `ask` in replay mode and `spec list` returned valid envelopes; `ask` reported the expected `replay-miss`.
- All three packages declare public scoped-package access and Node ≥22; core’s declared export targets exist in the built tarball.
- Package/plugin versions agree at 0.1.0; both marketplace paths resolve within the checkout.
- Credential YAML and permission advice match the loader; doctor prints the pinned global install command and Codex rule with a `~/.codex` fallback.
- CI exists and runs `pnpm check`. Fresh remote marketplace installs, actual Codex rule effectiveness and published npm installation: **I could not verify this**; GitHub retrieval failed and nothing is published.

## If I were you

Keep the CLI-only architecture, but make artifact installation a release requirement. Publish the exact tested tarballs and tag their source commit. Add a short changelog, a security contact and an explicit `latest` policy; provenance is useful, while issue templates and per-file license headers can wait. Keep marketplace main compatible with published npm versions, so plugin updates cannot outrun the CLI.
hook: Stop
hook: Stop Completed
