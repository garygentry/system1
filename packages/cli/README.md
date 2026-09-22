# @garygentry/system1

The `decide` CLI: typed, calibrated decisions for coding agents, hooks and CI.

```sh
npm i -g @garygentry/system1
decide doctor --format brief
```

`decide` sends a closed judgement (yes/no, pick one of N, rate on a scale) to a decision model and returns a typed, calibrated answer in about 300 ms for about $0.00003 an item. It reads and splits the content itself, excludes secret-shaped files, scrubs secrets from what it sends, and never sends anything until the repo has given consent with `decide config egress allow`.

Full documentation, the skills for Claude Code, Codex and Pi, and what gets sent: **https://github.com/garygentry/system1**

MIT
