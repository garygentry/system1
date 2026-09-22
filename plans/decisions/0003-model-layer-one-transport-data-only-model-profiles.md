# 0003. Model layer = one transport + data-only model profiles

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** planning interview (session 0); see `plans/ROADMAP.md`

## Decision

Model layer = **one transport + data-only model profiles**

## Notes

Replaces the charter's "provider per model". `openrouter-decisions` transport (endpoint overridable); profile = `{id, max_state_tokens, usd_per_input_token, undecided_floor, calibrated}`. A new model with the same shape is a profile entry. `emulated` becomes a second transport later (phase 3)

## Charter delta

Amends `plans/charter.md`; see notes.
