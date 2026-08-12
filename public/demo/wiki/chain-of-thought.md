# Chain-of-thought prompting

Notes on the paper that named the technique. The paper itself is in this
knowledge base — see [[prompting]] for where this sits among the rest.

Sources:
[[pdf1:raw/papers/chain-of-thought-prompting.pdf]]

> **Click any of the blue citation chips below.** The PDF opens at the exact
> paragraph the claim came from, highlighted. Nothing was uploaded to do that,
> and the chips are plain text in this file — open it in any other editor and
> they are still there, still readable, still pointing at a real page.

## What it is

Instead of asking a model for an answer, you show it a few worked examples that
spell out the intermediate steps, and it starts spelling out its own. The paper
motivates this from how a person actually solves a word problem — decompose it,
solve each step, then answer [[1:b2-5]].

That is the whole intervention. No finetuning, no extra training data, no
task-specific model — which is why it applies across a broad range of tasks
rather than one benchmark [[1:b25-1]].

## The finding that made it interesting

Chain-of-thought is **emergent**: it does not help small models, and below
roughly 10B parameters it actively *hurts* performance. Its benefit cannot be
predicted by extrapolating from smaller models — it appears only past a certain
scale [[1:b16-3]].

This is the part worth remembering. A technique that makes your small model
worse and your large model much better is a different kind of claim from "this
prompt works better".

## Where it came from

Wei et al., Google Research / Brain Team, 2022 [[1:b1-1]]. Published at NeurIPS
2022; the copy here is arXiv v6. Licence and provenance are recorded next to
the file, in `raw/papers/SOURCES.md` — worth doing for anything you did not
write yourself.

## Open questions

- The paper's own FAQ asks whether it will help *your* task, and does not
  promise that it will (appendix A.3).
- Error analysis in the appendix reads the model's wrong chains by hand and
  sorts them into categories. Nobody has automated that well.

---

*This note was written to be read, not to impress: short claims, each one
attached to the place it came from. That is the shape the agent aims for when
it writes notes here too.*
