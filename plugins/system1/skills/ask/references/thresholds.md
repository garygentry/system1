# Thresholds

The model returns probabilities, and you decide what they mean. Keep that decision explicit.

The provider calls these probabilities calibrated, and this toolkit does not verify that. So treat a 0.9 as "the model is confident", not as "right nine times in ten", and pick thresholds from what a mistake costs.

## Choose the threshold before you look at the answers

If you set a cutoff after seeing the scores, you'll pick whatever keeps the items you already expected. Decide the cutoff from what a mistake costs, then run.

| A wrong **keep** costs… | A wrong **drop** costs… | Threshold for keeping |
|---|---|---|
| a little reading time | missing the item entirely (a bug, a relevant file) | **low**, e.g. `>=0.3`. Keep anything the model doesn't clearly reject |
| about the same | about the same | `>=0.5` to `>=0.7` |
| real harm (running something, telling the user "done") | little | **high**, e.g. `>=0.9`, and read what's near the line yourself |

Because the model is decisive, most answers sit near 0 or 1, and the exact cutoff moves few items. The ones it does move are the ones worth reading.

## Undecided is its own outcome

- **What it means:**
  - For a noul, an answer close to 0.5.
  - For a choice or score, a flat distribution: confidence at or below 0.15.
  - Such an answer is **not** a weak yes or a weak no.
- **What `decide` does:** it lists undecided items apart from the rest, and never applies a threshold to them.
- **What you do:**
  - read them yourself;
  - ask a sharper question about just those items;
  - or show them to the user.
- **Never** fold them silently into kept or dropped.

## Rules that only escalate

When the answer gates something risky, let the model **add** caution but never remove a check you would otherwise make.

- **Good:** "if `destructive >= 0.5`, ask the user first".
- **Bad:** "if `safe >= 0.9`, skip the review".

A model error should cost extra care, never skipped care.

## Several conditions

`--keep` flags are ANDed: `--keep 'touches_db>=0.7' --keep 'has_tests<0.5'`. For OR, or anything more involved, get the full answers with `--format json` and apply the logic yourself.

## Saved specs

A spec's thresholds live in its `policy.thresholds`, each with a `why`. That line records the reasoning above, so the next reader (or agent) can tell whether the threshold still fits. The `design` skill covers this.
