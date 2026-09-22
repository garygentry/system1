# Pass 3 — honesty of the numbers

**The promise:** costs are labelled (projected is never presented as measured); every answer says whether it came from a `live` call or a `replay`; a replay miss is an error, never a synthesized answer; undecided answers are surfaced, never silently bucketed; and thresholds are the caller's decision, not the model's.

**Where to look:** `packages/core/src/run/{budget,spend}.ts`, `model/{profiles,answers}.ts`, `decide.ts`, `fixtures/store.ts`, `tools/{ask,many,usage,spec-check}.ts`, `project/project.ts`, `packages/cli/src/format.ts`, plus the claims in `README.md`, `plugins/system1/skills/**` (especially `references/thresholds.md` and `primitives.md`) and `plans/milestones/M5-skills-specs.md`.

**Judge:**
1. **Cost claims.** Is "about $0.00003 a call" defensible from the profile's prices and what the provider reports? Is a projection ever shown where a measurement is implied, or vice versa? Is the price staleness (`priceAsOf`) handled honestly?
2. **The spend guard and ledger.** Can a run exceed the guard? Is spend attributed to the right session? Does the ledger double-count retries, or miss failures? Is `decide usage` truthful about what it covers?
3. **Live versus replay.** Can a replayed answer be presented as live, or a fixture be recorded from something other than a real call? Is `source` always right, including in `spec check` and on partial failures?
4. **Undecided.** Is the floor (0.15) applied consistently for noul, choice and score? Can an undecided answer be swept into kept or dropped by `--keep`, `--sort`, `--limit` or `--fields`? Is the CLI's `brief` output honest about what was dropped, withheld or redacted?
5. **Calibration claims.** The README and skills call the answers "calibrated". Is that claim supported, and does anything in the repo actually check it? If not, say so plainly.
6. **The measured numbers in the docs** (`M5-skills-specs.md`, the README's example run): are they reproducible, and are they presented with the right caveats?
