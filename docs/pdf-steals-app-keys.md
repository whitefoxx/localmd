# A background PDF tab ate ⌘C for the whole app (fixed)

**Status: fixed** — `lib/pdfKeys.ts` takes EmbedPDF's shortcut table over on
viewer ready; `tests-e2e/pdf-keys.spec.ts` pins both scenarios with the real
key gesture and the real clipboard (2026-08-19). Kept because the symptom
pointed everywhere except the cause, and the diagnostic route is reusable.

## Symptom

With any PDF tab open — even hidden behind another tab — selecting text
anywhere in the app (a chat reply, the markdown preview) and pressing ⌘C
copied nothing. The right-click menu's Copy worked. Other websites worked.
Incognito worked. Closing the PDF tab fixed it. Every one of those pointed
at an extension or a stale service worker; all extensions disabled changed
nothing.

## Root cause

`@embedpdf/plugin-commands` mounts a keydown listener on **`document`** and,
for any combo in its shortcut table bound to an enabled command, calls
`preventDefault()` + `stopPropagation()` — regardless of whether the PDF pane
is visible or where the user's selection lives. The table is not small:
`Ctrl/Meta+C`, `+F`, `+P`, `+M`, `+O`, `+W`, `+Z`, zoom keys, bare `h`, `p`,
and `ArrowLeft` (which was also silently stealing the EPUB reader's page-turn
key whenever a PDF tab existed).

Two app facts turned a library quirk into an app-wide outage:

- PDF viewers stay **mounted per open tab** (`v-show`, deliberately — page
  position and annotations survive tab switches), so the listener outlives
  the PDF being on screen.
- `⌘C` with focus on BODY (exactly what clicking on transcript text leaves
  behind) passes the plugin's only guard, which exempts editable targets.

## Why it was so hard to see

- The keydown probe at document **capture** phase showed the key arriving with
  `defaultPrevented === false` — the prevent happens later in the dispatch, at
  document bubble.
- No `copy` event ever fired, which reads as "Chrome refused to copy this
  selection", not "someone cancelled the key".
- `document.execCommand('copy')` **worked** — so any probe that included it
  as a check appeared to *fix* the problem it was measuring.
- The decisive instrument was DevTools-only `getEventListeners(document)`,
  which listed a minified handler matching
  `@embedpdf/plugin-commands`' `keyboard-shortcuts` utility.

## Fix

The plugin cannot be scoped from outside, but its table can be taken over
(`takeoverPdfShortcuts`): on ready, every shortcut is stripped from the
commands registry — the commands stay, so toolbar buttons keep working — and
the combos are re-dispatched by `lib/pdfKeys.ts` under explicit ownership
rules: a hidden PDF hears nothing; a visible PDF yields to a selection living
outside it; otherwise the PDF handles the key exactly as the library would
have. The re-dispatch (rather than plain deletion) keeps EmbedPDF's
pdfium-quality copy for text selected *inside* the PDF — native copy of a
pdf.js-style text layer garbles line breaks.

## Lessons

- **A library that listens on `document` is a global actor**; auditing our own
  `stopPropagation`/`preventDefault` call sites can come up empty while a
  dependency holds the smoking gun. `getEventListeners` in DevTools is the
  fastest complete inventory, extensions included.
- **"Works in incognito" does not implicate extensions** — it implicates
  *state*: incognito also starts with no KB, no restored tabs, and therefore
  no mounted PDF.
- **A probe must not perform the action it is probing for** — the
  `execCommand('copy')` probe accidentally became a workaround and nearly
  buried the diagnosis.
- In e2e, EmbedPDF paints inside nested shadow/iframe structure that Playwright
  locators cannot reach; wait on a *semantic* signal instead (a cancelable
  synthetic ⌘C coming back `defaultPrevented` proves the shortcut listener is
  live on both sides of the fix).
