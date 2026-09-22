# 0014. No live `command` source; stdin covers it

- **Status:** accepted
- **Date:** 2026-09-22
- **Source:** M2 (answers ROADMAP open question 2)

## Decision

The engine has no source that runs an arbitrary command. To judge command output, the agent pipes it in: `cmd | decide many --stdin --split lines:40`, or it saves the output to a file and uses `--file`. The only process the engine ever spawns is `git`, for the `diff` source and for gitignore filtering. It runs through `execFile` with an argument array, never through a shell.

## Rationale

- The agent's shell already runs commands under that harness's own permissions, sandbox and approval rules. A command source inside `decide` would run the same commands outside them.
- Hooks and CI can pipe into `decide` too, so nothing is lost.
- This removes a whole class of injection risk from specs. A spec's `source` can name files, globs and diffs, but not commands.
