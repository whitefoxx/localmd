---
title: Writing and formatting notes
summary: The editor shows your writing the way it will look while still being the plain markdown file underneath, with shortcuts for the fiddly parts — tables, links, pictures.
---

# Writing and formatting notes

Open any note and press **Edit**. What you get is a markdown editor that tries
to stay out of the way: headings look like headings, bold text looks bold, and
the symbols that make them so are hidden until you need them.

## The line you are on is always the truth

Move the cursor onto a line and that line snaps back to its plain text — every
`**`, every `#`, exactly as it sits in the file. Move away and it renders
again.

This matters more than it sounds. Nothing is ever hidden from the place you are
editing, so you never fight the display to fix a character. You are always
editing the real file, never a representation of it.

If you would rather see the raw markdown everywhere, turn off **Live rendering
while editing** in Settings → General.

## Formatting without remembering the symbols

| | |
| --- | --- |
| **Bold** | ⌘B |
| *Italic* | ⌘I |
| `Code` | ⌘E |
| ~~Strikethrough~~ | ⌘⌥X |
| Link | ⌘⌥K |
| Heading levels 1–6 | ⌘⌥1 … ⌘⌥6 |
| Plain paragraph again | ⌘⌥0 |
| Tick / untick a task | ⌘↵ |
| Make a line a task | ⌘⌥↵ |

(On Windows and Linux, Ctrl and Alt.)

Each one is a toggle: ⌘B on bold text unbolds it. With nothing selected they
apply to the word under the cursor, so you do not have to select anything
first.

Pressing Enter in a list continues the list, and typing the third backtick of a
code fence writes the closing one for you and puts the cursor between them.

## Tables

**⌘⌥T** drops in an empty table. From there:

- **Tab** and **Shift-Tab** move between cells, and Tab past the last cell adds
  a row
- **Enter** moves down a column; on the last row it just makes a new line, so
  you can leave
- **⌘⌥→** and **⌘⌥↓** grow the table by a column or a row; **⌘⌥←** and **⌘⌥↑**
  remove one
- **⌘⌥F** lines the columns up

Alignment counts Chinese, Japanese and Korean characters as the two columns
wide they actually are, so a table with CJK in it comes out straight rather
than ragged.

## Pictures

Paste an image straight into a note. The file is saved into the same folder as
the note and linked from where your cursor was — so if you later move the note
somewhere else, take the picture with it and the link still works.

Pictures stored in your folder show up both in the editor and in the reading
view. Pictures from the web work too, as ordinary links.

## Links

`[[Double brackets]]` link to another page in your knowledge base, and offer
completions as you type. Ordinary markdown links work as well.

**⌘-click** a link to follow it — pages open in the app, web addresses in a new
tab. A plain click just puts your cursor there, because in an editor that is
what a click has to mean.

## Formulas

Maths written between dollar signs renders where it sits: `$E = mc^2$` inline,
or a `$$` block on its own lines for something bigger. Prices are safe — `$5`
and `$10` in a sentence stay a price.

## A question that answers itself

A code block marked `localmd-query` is not code. It is a question, and it is
answered against your folder every time you look at the note.

```localmd-query
type:paper tag:llm age:>6m sort:-modified
```

That one asks for papers tagged llm that nothing has touched in six months,
newest first. What you see is a table of the pages that match; click one to
open it.

The filters are the ones the search box takes — the same grammar in both places — `type:` and
`tag:`, `path:wiki/` for a folder, `fm:status=draft` for any other field you
keep at the top of a page, `age:<30d` or `modified:<2026-01-01` for time,
`orphan:true` for pages nothing links to, `broken:true` for pages with a dead
link, and `sort:`, `limit:` and `columns:` to shape the answer. Anything that
is not a filter searches the words. If you would rather describe what you want
than write it, ask the assistant — it uses the same filters.

**Only the question is saved.** Your file holds those few words and nothing
else; the table is built fresh each time and never written back into the note.
That is deliberate. A list pasted into a page is correct the day you paste it
and wrong the first time you rename something, and nobody ever notices. A
question stays true. Open the same note in any other markdown app and you will
find the question sitting there as an ordinary code block — which is all it
ever was.

## Related

Where notes live: `knowledge-base`. Asking the assistant to write for you:
`working-with-the-agent`.
