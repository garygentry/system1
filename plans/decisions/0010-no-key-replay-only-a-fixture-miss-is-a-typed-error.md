# 0010. No key → replay only; a fixture miss is a typed error

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** planning interview (session 0); see `plans/ROADMAP.md`

## Decision

No key → **replay only; a fixture miss is a typed error**

## Notes

jev-poc's synthetic fallback is dropped. Every result carries `source: live \| replay`

## Charter delta

Amends `plans/charter.md`; see notes.
