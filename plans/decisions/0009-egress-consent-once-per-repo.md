# 0009. Egress consent once per repo

- **Status:** accepted, **amended by [0016](0016-name-system1.md)** (consent lives in `.system1/config.yaml`, not `.decisions/config.yaml`; the rule is unchanged)
- **Date:** 2026-09-22
- **Source:** planning interview (session 0); see `plans/ROADMAP.md`

## Decision

Egress consent **once per repo**

## Notes

A live call fails with instructions until `.decisions/config.yaml` records consent. Path excludes and secret scrubbing are always on. Hooks need a separate opt-in per pack

## Charter delta

Consistent with / refines `plans/archive/charter.md`.
