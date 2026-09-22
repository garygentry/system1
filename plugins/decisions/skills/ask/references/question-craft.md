# Question craft

The decision model reads your words **literally**. It doesn't know your goal, your repo or the rest of the conversation: only the text you send and the question you wrote. Most bad answers come from a badly posed question, not from the model.

## Rules

1. **Put everything the judgement needs in the question.**
   - "Is this relevant?" means nothing on its own.
   - "The file contains code that reads or writes the `users` table" can be judged from the file alone.
2. **Ask about properties, not actions.**
   - Ask "the command deletes files outside the working tree", not "should I allow this command?".
   - What to do with the answer is your decision, made in code or in your reasoning.
3. **Always give a way out.**
   - A choice needs a `none` or `unclear` option.
   - A noul needs `false` criteria that cover the ordinary case.
   - Without one, the model forces a confident answer onto text that doesn't fit.
4. **Give nouls true/false criteria whenever a reasonable reader could disagree.**
   - Weak: "The test is flaky."
   - Better: "A re-run with the same code would likely pass." with `true: it depends on timing, ordering or the environment` and `false: the same inputs fail the same way every time`.
5. **Describe score levels as concrete situations, not adjectives.**
   - Weak: `[low, medium, high]`.
   - Better: `["affects one non-critical file", "affects one feature", "affects every request or shared data"]`.
6. **Give each failure mode its own question.** "Unclear goal" and "missing information" are different problems that call for different next steps. Two nouls let you act on each; one merged question hides which it was.
7. **Keep each question to one idea.** "Handles auth and logs secrets" should be two nouls. You can AND them afterwards with `--keep`.
8. **Don't ask for what the model can't do.** Counting ("more than 3 callers"), arithmetic, dates, exact matching and comparing two separate documents don't belong here. Use code or `grep` for those, then ask about what's left.
9. **Make sure the text actually contains the evidence.**
   - A per-file split can't answer "is this function called anywhere else".
   - A 20-line window can't answer anything about the whole file.
   - Choose the split to fit the question.

## Self-check before running

- [ ] Could a stranger answer this from the text alone, without your context?
- [ ] Is there a no-match option (choice), or clear false criteria (noul)?
- [ ] Are the score levels concrete situations, in increasing order?
- [ ] Does each question ask one thing?
- [ ] Is anything here counting, arithmetic, a date or an exact match? Do that part in code instead.
- [ ] Is the threshold chosen before looking at the results? (See `thresholds.md`.)

## Repairing a question

When an answer surprises you:

1. **Read the distribution, not just the winner.** A choice split 0.5/0.45 is telling you that two options overlap.
2. **Look for a literal reading of your words that explains the answer.** That's usually the cause.
3. **Rewrite:** sharpen the criteria, split the question, or add the missing way out.
4. **Ask again on the same text, and compare.**

If it still behaves oddly, the judgement may not be closed enough for this tool. Read the items yourself.
