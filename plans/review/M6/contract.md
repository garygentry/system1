# Pass 4 — the contract, before publishing freezes it

**The contract:** `plans/decisions/0015-cli-contract-v1.md`. One JSON envelope `{v, ok, command, result|error}` per command, exit codes 0 ok, 1 bug, 2 usage, 3 egress refused, 4 budget guard, 5 provider, 6 replay miss, plus the projection syntax, inline questions, `--questions`, `spec check` with its `expect` format, `--split join`, excerpts, and `doctor`'s report semantics.

**Where to look:** `packages/core/src/tools/schemas.ts` and the tool handlers, `packages/cli/src/{main,args,envelope,exit-codes,format,run}.ts` and `commands/*`, `packages/core/src/spec/{spec,expect}.ts`, and the contract record itself.

**Judge:**
1. **Is the contract complete and true?** Find anything the CLI does that the record doesn't describe, or describes wrongly. Check every exit code against real behaviour.
2. **Is it a good contract to freeze?** Where will it hurt in six months: the envelope shape, the `keep`/`sort` shorthand, the `expect` format, `--split` names, the spec file format, the fixture key, `ENVELOPE_VERSION` and how a breaking change would be handled.
3. **Error surface.** Are errors typed, actionable and free of internals? Is the same failure always the same code? Is exit 1 really reserved for bugs?
4. **Schema quality.** `decide schema <tool>` is the machine-readable contract: are the TypeBox inputs accurate, with additional properties handled deliberately rather than by accident?
5. **Spec file format**, the durable artifact users will commit: is it forwards-compatible (unknown keys, versioning), and would you be comfortable supporting it unchanged for a year?
6. **Naming**, now that the project is System 1 but the command is `decide` (`plans/decisions/0016-name-system1.md`): does anything read wrong, and are there leftovers?

Exercise the real CLI in replay for each claim you make.
