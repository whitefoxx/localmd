# PDF index — chain-of-thought-prompting

This folder is a **parsed, location-aware index** of the PDF `raw/papers/chain-of-thought-prompting.pdf`,
generated so an AI agent can read the document like source code.

## Files

- `toc.md` — table of contents. **Start here.**
- `sections/*.md` — the document text, in reading order, split into sections.
- `manifest.json` — metadata (page count, section list, content hash).
- `locations.json` — block id → PDF coordinates. The app uses this to
  draw highlights; you do not need to read it.

## How to navigate

Read `toc.md`, then open the section file(s) you need with your file tools.
To find a topic across the whole document, search within this directory. You
do **not** need to read every file — open only the sections relevant to the
question.

## How to cite (important)

Every paragraph and heading in the section files begins with a block id in
double square brackets:

    [[b14-3]] We trained the model on ImageNet for 90 epochs.

When you answer a question using this PDF, cite it in two parts so the app can
jump to the passage.

1. At the **very top of your answer**, declare this PDF on its own line, with
   a number (start at 1; number each additional PDF you cite):

       [[pdf1:raw/papers/chain-of-thought-prompting.pdf]]

2. After each claim, append `[[N:blockid]]` — the number from step 1 plus a
   block id copied **verbatim** from the section file:

       The model was trained for 90 epochs on ImageNet [[1:b14-3]].

Always include the number, even when this is the only PDF cited. The app turns
each `[[N:blockid]]` token into a clickable link that opens the PDF and
scrolls to that block. Never invent ids; prefer the most specific block, and
cite several if a claim spans multiple blocks.
