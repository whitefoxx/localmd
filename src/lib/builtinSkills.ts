/**
 * Skills the app ships, available in every KB without scaffolding anything into
 * the user's folder.
 *
 * Two kinds live here. Some are about the APP — connecting a service is the
 * first, and it is plumbing the agent reaches for rather than something a user
 * goes looking for. Others are the knowledge base's own core operations, and
 * `ingest` is one: compiling sources into pages is what this app is for, yet
 * until it shipped here it existed only as a file scaffolded into brand-new
 * folders — so the case that distinguishes us, an existing folder the user just
 * opened, was the one case that did not have it.
 *
 * Putting a playbook here rather than in the system prompt is the whole point:
 * it is long, and it is needed by a small share of turns. `use_skill` fetches it
 * when that turn arrives and only the one-line description is paid for on the
 * rest.
 *
 * A KB skill of the same name wins, so a user can always override ours.
 */

export interface BuiltinSkill {
  name: string
  description: string
  /** Who may invoke it, in the SKILL.md frontmatter's spelling. Omitted means
   *  both, the same default a hand-written skill file gets. */
  invocation?: string
  body: string
}

const CONNECT_A_SERVICE = `# Connecting a service

The user wants the agent to reach something it currently can't — "add WeRead",
"can you search my Notion", "get my Readwise highlights". Everything you need is
already available: tools in this app are DATA (a JSON spec), not code, so you
can research a service and build working tools for it inside one conversation.

Work in this order. Do not skip step 1, and do not leave step 2 until the end.

## 1. Find out how the service actually works

Search for its API or agent/skill documentation and READ it. You need four
things before writing anything:

- the endpoint(s), and whether one gateway serves many operations
- how it authenticates (bearer header? query key? cookies?)
- the request shape (which parameters, where they go)
- the response shape (what the JSON/XML actually looks like)

If the docs are vague about responses, that's fine — step 3 shows you the real
thing. If the service publishes a machine-readable API list (WeRead's gateway
answers \`{"api_name": "/_list"}\`), fetch it: it saves you guessing.

## 2. Collect the key first, if there is one

If the service authenticates, you cannot test anything without it — so ask now,
not at the end. Call \`request_setup\` with \`kind: "key"\`, an id you will use in
the specs (\`<service>_api_key\`), a \`help\` line saying exactly where to get it,
and a \`url\`. NEVER ask for it as chat text. A key the user hands over this way
can be used immediately, including in test.

If they skip it, keep going: build and save the tools anyway and tell them the
tools will start working once the key is filled in under Settings → Tools → Keys.

## 3. Check what the browser can reach

This app runs in a browser, so an endpoint that sends no CORS headers cannot be
called directly. Build one spec and \`manage_tools\` \`test\` it:

- it works → leave \`transport: "auto"\`
- it fails to connect → the endpoint refuses browsers. Set
  \`transport: "extension"\`, which routes through the localmd Connect
  extension's service-worker fetch (no CORS, carries the user's cookies).

If no extension is connected, don't just report that — call \`request_setup\` with
\`kind: "extension"\`, \`entry_id: "localmd-connect"\` and let the user connect it.
On localmd.app it connects as soon as it is installed; on a development address
the card also spells out the origin to add in its popup, and the page must be
reloaded afterwards (the extension starts listening on the next page load). So
expect a reload — after one, pick the work back up rather than asking again.

## 4. Design the output against a REAL response

This is where tools are won or lost. A raw JSON payload can cost thousands of
tokens per call; a shaped one costs a few hundred, and the shaped one is easier
to read. So:

1. \`manage_tools\` \`test\` with \`raw: true\` — you get the untouched response.
2. Find the list you care about and write \`pick\` + a per-item \`template\`.
3. \`test\` again (without raw) and LOOK at the output. An unfilled
   \`{{placeholder}}\` means a wrong field name. "No match for pick" prints the
   available keys — use them.

Keep only the fields a person would want: title, who, when, an id to follow up
with, a link. Drop covers, colour palettes, internal flags.

## 5. Build the whole set, not one tool

A service is worth one tool per useful operation — search, detail, list, stats.
Give them a shared \`bundle\` name so the user approves and manages them as one
integration, and save them together with \`manage_tools\` \`save_bundle\`.

Names should read as a group: \`weread_search\`, \`weread_shelf\`, \`weread_notes\`.

## 6. Ask, don't guess, when the choice is theirs

If a decision is genuinely the user's (which of two endpoints, which account),
ask with \`request_setup\` \`kind: "choice"\` rather than picking silently.

## 7. Write down what you learned

Save a skill into the KB at \`.agents/skills/<service>/SKILL.md\` describing the
tools you built and any field meanings, units or quirks that are not obvious
from the tool descriptions — response units, counting rules, id formats, deep
links. Future sessions read that instead of rediscovering it.

## Finally

Prove it works: call one of the new tools and show the user a real result. A
setup that was never run is not finished.
`

const INGEST = `# Ingest

Compile source material into this knowledge base: read what has arrived, write
what it means into pages, leave the sources untouched. The work is incremental
— each run picks up what earlier runs did not — so running it again is always
safe.

Sources are read-only. Never edit, move, rename or delete one to make an ingest
tidier; if a file is in the wrong place, say so and let the user move it.

## 1. Find what has not been compiled yet

Call \`kb_health\` and read \`unreferencedSources\`: files that no page in this KB
mentions at all. That is the compilation backlog, computed from the content
index without reading a single page — cheap and complete. Do NOT list
directories and diff them against the wiki by hand.

Two things it cannot tell you, so ask rather than guess:

- It reports "no page names this file", not "no page understood it". A source
  named once in passing counts as read and will not appear in the backlog.
- When the user pointed at something specific — an @-mention, "the three PDFs I
  just dropped" — that is the job, and the backlog is not.

The same call reports \`undistilledCaptures\`: days the user jotted things into
and nothing has been written out of yet. Those are material too, and they are
the user's own words rather than someone else's document — read them the same
way, and cite the day with a \`[[wikilink]]\` in whatever you write, which is
what marks it compiled. Two rules specific to them: a capture page is never
edited or deleted to tidy it up (writing a page from it does not consume it),
and some of what is there belongs nowhere — a line about dinner is not a
failure to compile, so leave it and say nothing.

An empty backlog with nothing named is a normal outcome: say so and stop.

## 2. Learn where things go — and what this KB is for

The KB's own structure decides where a page lands. If this KB has an AGENTS.md,
its content is already in your instructions — follow it. Otherwise call
\`list_files\` and read the layout off the tree: which folder holds authored
notes, how pages are named, whether there is an entry page.

Layout is not intent. If the KB states a PURPOSE — what it is for, what it is
reading towards, what it does not care about — let that decide which parts of a
source are worth writing down; a paper read for its method and the same paper
read for its results produce different pages. If it states none, do not invent
one and do not ask mid-run: summarise what the source actually says, and you
may offer once at the end to write down what this KB seems to be for.

Never impose the \`raw/\` + \`wiki/\` layout on a KB that does not use it. A KB
without that tree lands new files in \`inbox/\`; your job is to compile them into
the user's own structure and leave \`inbox/\` empty of the ones you handled, not
to build our layout around them.

## 3. Read each source properly

- PDF, EPUB and DOCX go through \`index_document\` first (skip it when \`.localmd/\`
  already has an index), then read the index's \`_README.md\`, \`toc.md\`, and the
  sections that matter. Never try to read the binary directly.
- Everything else: \`read_file\`.
- When a source would flood this conversation and \`run_subagent\` is available,
  delegate the reading and work from its answer.

## 4. Write the pages

- Prefer deepening an existing page over adding a new one. Three papers on one
  topic should leave that topic understood, not three summaries side by side.
- One topic per page; connect pages with \`[[wikilinks]]\`.
- Cite as you go: declare a document once as \`[[pdf1:path/to/file.pdf]]\`, then
  attach \`[[1:block-id]]\` to the claims that came from it. A reader who cannot
  jump back to the passage cannot check you.
- Name the source in the page that came out of it — that is also what makes the
  next run's backlog correct.
- Match the frontmatter the KB's other pages carry (\`type:\`, tags, dates)
  instead of inventing a convention for the pages you happen to write. When a
  KB carries none yet, a page about a single source is worth starting with
  \`type: source\` and a few tags: those two fields are what the app's own tools
  read — type chips in the file tree and the graph, \`type:\` and \`tag:\` filters
  in search, near-duplicate tag hygiene in \`kb_health\`. Reuse tags the KB
  already uses over minting new spellings of them.
- A source with no page about it is invisible to all of that, which is why a
  document nobody has cited offers a "Write a note" button in its viewer. What
  that produces is an ordinary page: the source declared with
  \`[[pdf1:path]]\`, the frontmatter above, and a link in from the index.

## 5. Say what did not fit

Some of what a source gives you is not a page: it contradicts something already
written, or it leaves a claim without a citation. Do not quietly pick a winner,
and do not leave it in this conversation where it dies with the tab. Offer to
add a dated entry to the KB's log page (\`log.md\`, or wherever this KB keeps
one — create one only if the user wants it), naming the pages involved with
\`[[wikilinks]]\` so it can be found again:

\`\`\`
## 2026-03-01 — [[chain-of-thought]] and [[prompting]] disagree on the threshold
One says 10B parameters, the other 100B. Unresolved; the newer paper is [[pdf2:…]].
\`\`\`

Which side is right is the user's call, not yours.

## 6. Link it in

A page nothing points at is an orphan the moment you write it. Link each new
page from the entry page — or from whatever index its neighbours are listed in
— in the same run that creates it.

## Finally

Report three things: what you compiled and where each page went, what you
skipped and why, and what is left in the backlog. If the backlog is long, do a
few, report, and ask before spending the rest — twenty sources is a token-heavy
run the user should get to agree to first.
`

const REACH_A_SITE = `# Reaching a site

The user wants something read off a mainstream site — an X thread, a Reddit
discussion, a YouTube transcript, their own Gemini chats. Reaching a site is a
capability you COMPOSE from the browser primitives, not a per-site tool you look
up: there is no adapter catalog. You pick the cheapest route that works; for a
couple of sites where the obvious route fails there is a hint below, and for
everything else you work it out live.

The signed-in state is the user's own — every route here rides their real
session and cookies. The generic tools are for READING and navigating. A WRITE —
post, send, follow, delete — always pauses on a confirmation card the user must
approve; it happens ONLY after they approve. Two paths reach a write, both gated:
PREFER calling the site's own action or API from an \`eval_js\` snippet with
\`allow_write: true\` (steadier than fighting a live composer, e.g. X's CreateTweet
over the same GraphQL the read recipe uses); or, when only the page's own control
will do, just \`click\` that Post/Send/Submit button as usual — the extension
recognises a write control and pauses it on the confirmation card for you (you do
not pass a flag for a click). Never claim a write happened unless the call
returned without a decline.

## The ladder — try these in order, cheapest first

**1. Hidden JSON / open API (no tab).** Most sites answer JSON somewhere. Try
\`fetch_url {format:"json"}\` first — it carries the user's cookies, needs no tab,
costs the least:
- append \`.json\` to the URL (Reddit: any thread or listing, plus \`?raw_json=1\`);
- a public data endpoint (\`/api/v4/…\`, oEmbed, a \`?format=json\`).
If it comes back as the data you want, you are done — shape it into rows.

**2. Same-origin request from a tab (\`eval_js\`).** When the endpoint needs a
header the page holds (a CSRF cookie, a bearer the SPA carries) or refuses
cross-origin calls, open a tab on the site and make the request from inside it
with \`eval_js\`: read the cookie, set the headers, \`XMLHttpRequest\` (sync is
fine), then REDUCE the payload to rows in the page — never return the raw 150 KB.

Don't know the endpoint, or which headers it wants? Let the page make the call
once and watch it with \`capture_network\` — that captured request IS your URL
template and header list — then REPLAY it with \`eval_js\`. Three traps that cost
whole sessions: an entry's \`body\` is a raw STRING (\`JSON.parse\` it yourself);
**never reload a tab while a capture is attached** — it can leave an SPA blank,
losing the very load you meant to observe (arm the capture on a fresh tab BEFORE
navigating, or re-trigger by in-app navigation); and once you HAVE the template,
stop the capture and work from replay. Re-arming a capture over and over is a
loop, not progress — if you already captured the payload, the answer is in your
hand, so reduce it rather than going back for another.

**3. Drive the rendered DOM (\`eval_js\` + recon).** When there is no reachable API
(the data is server-rendered, or gated like YouTube captions), open the app in
an ACTIVE tab (lazy apps do not render in the background), let it settle, and
read the DOM. Find selectors with \`get_a11y_tree\` / \`find_structured_data\` /
\`find_in_dom\` rather than guessing. Long lists VIRTUALIZE, and the trap is the
opposite of what it looks like: what you scroll PAST is UNMOUNTED, so scrolling to
the bottom and then reading gives you the tail and silently drops everything
above it. Harvest as you go — small scroll steps, read after each, accumulate into
a map keyed by a STABLE id (the item's permalink or data id) so re-renders dedup
instead of duplicating. You are done when the count stops growing, not when you
reach the bottom.

Always: return the ROWS you need (id, text, author, url), not the whole payload;
\`max_chars\` truncates the rest. Read markdown, not plain text, when links matter.

## A couple of hints where the obvious route fails

Most sites fall straight out of the ladder — a hidden \`.json\`/API (Reddit's
\`.json\`, Zhihu's \`api/v4\`, Bilibili's player API, the AI chats' own conversation
APIs), or a DOM you read with \`eval_js\`. Two are worth a heads-up, because the
naive route actively fails:

- **YouTube transcript** — the caption API is behind a proof-of-origin (\`pot\`)
  wall and captions are service-worker-fetched, so \`fetch_url\` and network
  capture do not see them. Drive the UI instead: open the watch page active,
  click "Show transcript", read the transcript panel's rows.
- **X / Twitter** — no open API, and the conversation view virtualizes, so DOM
  scraping fights you on two fronts at once. Let the page issue its own
  conversation GraphQL call, capture that ONE request for its URL template and
  headers, then replay it same-origin from an x.com tab (the \`ct0\` cookie is the
  CSRF header) and follow the cursor for the rest. Decide what belongs to a
  thread from the RESPONSE's own fields — the display type marking an author's
  self-thread, and the conversation id — never from rendered order, and never
  from a number the author typed into the text.

That is the extent of the site-specific knowledge shipped here. For anything
else, WORK IT OUT LIVE with the ladder + recon. This project maintains the base
capabilities, not per-site extractors — so when you find a route that works, tell
the user they can save it as a skill in their own skills directory to reuse, and
have you re-derive it if the site later changes.

## Finally

Prove it: show the user a real row you pulled, and say which route worked. Save a
page into the KB as a \`source\` note with the title, author, url and content —
the same as any other clip.
`

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'ingest',
    description:
      "Compile source material this KB has not covered yet into pages, following the KB's own structure — use when the user asks to ingest, process, file, or write up sources they have added.",
    body: INGEST,
  },
  {
    name: 'connect-a-service',
    description:
      'Connect an external service (an API, a reading app, a note tool) by researching how it works and building real tools for it — use whenever the user asks to add, connect or integrate something, including "add the <name> skill".',
    body: CONNECT_A_SERVICE,
  },
  {
    name: 'reach-a-site',
    description:
      'Reach a mainstream site — read an X thread, a Reddit discussion, a YouTube transcript, your own AI chats — by composing the browser primitives (fetch_url / eval_js / recon). Use before scraping or hand-driving a well-known site.',
    body: REACH_A_SITE,
  },
]

export function builtinSkill(name: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.name === name)
}
