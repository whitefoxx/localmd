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

An empty backlog with nothing named is a normal outcome: say so and stop.

## 2. Learn where things go before writing anything

The KB's own structure decides where a page lands. If this KB has an AGENTS.md,
its content is already in your instructions — follow it. Otherwise call
\`list_files\` and read the layout off the tree: which folder holds authored
notes, how pages are named, whether there is an entry page.

Never impose the \`raw/\` + \`wiki/\` layout on a KB that does not use it. A KB
without that tree lands new files in \`inbox/\`; your job is to compile them into
the user's own structure and leave \`inbox/\` empty of the ones you handled, not
to build our layout around them.

## 3. Read each source properly

- PDF, EPUB and DOCX go through \`index_document\` first (skip it when \`.trace/\`
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
  instead of inventing a convention for the pages you happen to write.

## 5. Link it in

A page nothing points at is an orphan the moment you write it. Link each new
page from the entry page — or from whatever index its neighbours are listed in
— in the same run that creates it.

## Finally

Report three things: what you compiled and where each page went, what you
skipped and why, and what is left in the backlog. If the backlog is long, do a
few, report, and ask before spending the rest — twenty sources is a token-heavy
run the user should get to agree to first.
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
]

export function builtinSkill(name: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.name === name)
}
