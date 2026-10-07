# M11 dogfood, Python: `spamfilter` through adopt → capture → compare

PR 10 of `plans/m11-adopt.md` (D8). [`mags0ft/spamfilter`](https://github.com/mags0ft/spamfilter)
(MIT) at commit `03341e0056c85dce35a009ec090ec25674207eb6`. Its closed judgement is
`src/spamfilter/filters/openai.py`, `OpenAI.check`: one OpenAI-compatible chat call, with a strict
JSON schema `{is_spam: bool}`. The results are in `plans/milestones/M9-M11-scout-guard-adopt.md`,
under Results ("M11 PR 10").

| File | What it is |
|---|---|
| `adopt.patch` | Everything adopt added to the clone: `.system1/specs/spam.yaml` with its recorded fixtures, the labels, and `system1/`. That folder holds the policy module, the mapping, the shadow harness, the grant scan, the filter that wires the policy in (it wraps only a pass-or-fail filter), `capture.py`, `evaluate.py` and the offline tests |

## Reproduce

```sh
git clone https://github.com/mags0ft/spamfilter ~/.cache/system1-dogfood/spamfilter
cd ~/.cache/system1-dogfood/spamfilter && git checkout -b system1-adopt 03341e0
git apply ~/workspace/system1/evidence/dogfood-spamfilter/adopt.patch
python3 -m venv ../venv && ../venv/bin/pip install openai pytest pyyaml python-dotenv requests
DECIDE_CMD="node $HOME/workspace/system1/packages/cli/dist/bundle/decide.mjs" ../venv/bin/python -m pytest system1 tests
```

The tests replay the recorded answers and send nothing. `DECIDE_CMD` is needed only while the
published `decide` (0.5.1) predates `decide runtime`.

That shows the module works. The numbers in Results come from a capture and compare's recorded
answers, which hold raw comments and are not in the patch. To re-derive them you have to pay again:

```sh
# The existing filter over the sample: about $0.004, sent to OpenRouter outside system1's checks.
OPENROUTER_API_KEY=… PYTHONPATH=src:system1 ../venv/bin/python system1/capture.py <dir with Youtube0*.csv> 200
# Jev over the same states: about $0.004. It needs this clone's own egress consent, which you grant.
node --env-file=<a .env with the key> $HOME/workspace/system1/packages/cli/dist/bundle/decide.mjs compare spam --record
# The policy as it would run, replaying both: free.
DECIDE_CMD="node $HOME/workspace/system1/packages/cli/dist/bundle/decide.mjs" PYTHONPATH=src:system1 ../venv/bin/python system1/evaluate.py
```

Both paid steps write raw comments under `.system1/compare/`, which stays out of git. A fresh
capture is the same 200 comments, but the filter's answers, and so the figures, can differ from
run to run.

## Data

The labels are the `CLASS` column of the [UCI YouTube Spam Collection](https://archive.ics.uci.edu/dataset/380/youtube+spam+collection)
(Alberto, Lochter and Almeida, 2017; CC BY 4.0). It has five CSVs and 1,956 comments. `capture.py`
draws 200 with seed `20261006`, 100 from each class. The labels file in the patch holds only the
ids (`<file>:<COMMENT_ID>`) and the class, not the comments.
