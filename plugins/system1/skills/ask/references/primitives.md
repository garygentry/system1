# Primitives: choosing the question type

Choose the type by what the answer **means**. Taste doesn't come into it.

| The answer is… | Type | You get back |
|---|---|---|
| Whether one statement is true | `noul` | `noul`: probability 0–1 that it holds |
| Exactly one of a fixed set of labels | `choice` | `choice` (the winner), `probabilities` over every option, `confidence` |
| A position on an ordered scale you define | `score` | `score` (probability-weighted mean level), `probabilities` per level, `confidence` |

## noul

- **Write it as a statement, not a question:** "The function makes a network request without a timeout." Its answer is the probability that the statement holds.
- **Reading it:**
  - 0.5 means the model can't tell. Values near 0.5 are reported as undecided.
  - The model is decisive: 1.0 and 0.0 are common, and they aren't a sign of error.
- **Criteria:** add `true` and `false` criteria whenever the statement could be read two ways (see question-craft).
- **Several things to check:** use several nouls, not one statement joined with "and". Each gets its own answer.

## choice

- **Options:** a map from option key to its description. The key is what you filter on (`kind=fix`, `kind in fix,feat`). The description is what the model reads.
- **Always include a no-match option** ("none", "unclear", "other"). Without one, the model has to choose the least wrong option, and it will do so with confidence.
- **Limit:** at most 255 options. `decide` refuses more before any call.
  - Measured: with 20, 60 and 150 file names as options, the right one won each time.
  - For more candidates than that, screen them with a noul first, then pick among the survivors.
- **Reading it:** `confidence` shows how concentrated the distribution is. A low-confidence winner is undecided. Read the runner-up in `probabilities` before acting on it.

## score

- **Levels:** give them as a list, lowest first. **Levels start at 0**: three levels are 0, 1 and 2.
- **Reading it:** `score` is a weighted mean, so it can land between levels (1.4 means "mostly 1, some 2").
  - Filter on it with `risk>=1.5`.
  - For the mode rather than the mean, read `probabilities`.
- **When to use it:** when the order matters and a distance between levels means something (risk, severity, effort). Unordered labels are a choice.

## One state, many questions

- **Every question in one call** is answered against the same text. A call costs little either way, so batch questions that share a state.
- **Different texts need separate calls:** a file and a separate log each get their own. Use `many` to fan out one question set over many items. Each item is its own call.
