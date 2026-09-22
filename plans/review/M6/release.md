# Pass 5 — release mechanics and first install

**About to happen:** `@garygentry/system1` (the `decide` CLI), `@garygentry/system1-core` (the engine) and `@garygentry/system1-pi` (the skills for Pi) are published at 0.1.0, tagged, and installed by users from npm and from the GitHub marketplaces.

**Where to look:** `catalog.yaml`, `tools/generate.ts` and `tools/validate.ts`, the three `packages/*/package.json`, `packages/cli/bundle.mjs`, `packages/pi/prepack.mjs`, the generated `plugins/system1/{plugin.json,.claude-plugin,.codex-plugin,bin/decide}`, both marketplace manifests, `README.md`, and the `setup` skill plus `packages/core/src/tools/doctor.ts` (the install advice users will follow).

**Judge:**
1. **Package correctness.** Run `npm pack` for each and inspect the tarballs. Is anything missing that runtime needs, or included that shouldn't ship? Do `files`, `bin`, `exports`, `engines` and `publishConfig` hold up? Does the CLI genuinely work with no dependencies at runtime?
2. **The version story.** One version across three packages plus the plugin manifests and the shim's pinned `npx` fallback. What breaks when a user has a newer CLI than plugin, or the reverse? Is pinning right, or should the shim float?
3. **First install, as a stranger.** Follow the README's install matrix literally for each harness and find where it is wrong, incomplete or would leave someone stuck. Check the advice `doctor` and `setup` give (the credentials file format, the Codex rule, PATH).
4. **Publishing hazards:** the scoped-package access, the prepack copy in the Pi package, whether `npm publish` would include or omit anything surprising, and whether the repo would be reproducible from the tarballs.
5. **What is missing for a first release** that you would insist on: CI, a changelog, a license header, SECURITY.md, issue templates, provenance, a `latest` tag strategy. Say which of those actually matter at 0.1.0 and which are noise.
6. **The GitHub side:** both marketplace manifests point at this repo. Would they work for someone who has never seen it?
