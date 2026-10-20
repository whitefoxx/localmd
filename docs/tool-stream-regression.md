# Offline tool-stream regression check

`src/agent/run.test.ts` checks the history contributed by a multi-step turn.
The adjacent `tool-stream-regression.test.ts` adds the real installed provider's
HTTP/SSE parser to that check. The pilot pins the published npm package
`psj-ai-sdk@0.3.2` as an exact development dependency. Use Node 22+ and install
the committed lockfile with peer checks enabled:

```sh
npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund --prefer-online
npx --no-install vitest run src/agent/run.test.ts src/agent/tool-stream-regression.test.ts src/agent/tool-stream-recording.test.ts
npm run typecheck
```

Expect three test files / nine passing tests and a successful project typecheck.
`--ignore-scripts` skips dependency lifecycle scripts and the optional local Git
hook setup. It does not disable peer checks. The original locked AI SDK
`7.0.29`, compatible provider `3.0.11` and core `0.6.1` remain unchanged.
Run the same focused command before and after a later SDK lockfile update.

On Windows, preserve committed LF Markdown in a fresh clone with
`git clone --config core.autocrlf=false --config core.eol=lf ...`. The existing
static-page tests expect LF frontmatter; a CRLF checkout fails that suite on
the old pilot too. This dependency update does not change the parser.

The complete native and guarded controls both return two full 12,000-character
tool results under their original IDs and retain them in step history. The
guarded duplicate-ID and malformed-sibling cases must release no callbacks and
make no continuation request. Every response is authored and every tool is an
in-memory fixture; this is not a recorded provider incident or a test of the
whole `runTurn` application path.

The recording tests also check text arriving before EOF while tool callbacks wait,
then verify the original result ID and the final answer. The other two cases
capture a token-limited response and a transport failure into temporary local
directories and replay their wire policy without a key or application tools.
Original bytes and completeness are checked; complete tool JSON followed by a
read error must remain ineligible. The healthy response creates no recording
with the default refused-only mode. All temporary files are removed afterward.

The optional `psj-ai-sdk` companion is a development dependency only. Production
providers, permission prompts, KB operations and the browser bundle are not
changed. It streams a conservative display-only prefix, with later errors still
possible; tools and later bytes wait for EOF and batch validation. Unknown
provider fields can cause buffering. Input hooks, approval continuation and
replacement models/tools remain outside this adapter. Limited `prepareStep`
and `activeTools` selection are supported by 0.3.2; this pilot does not migrate
the application's production loop. That is why
this patch proposes an offline regression check rather than replacing the
application's provider-neutral agent loop.

The companion is maintained by this patch's author. Running it in the project,
finding a useful invariant, or deciding that the native SDK already covers the
needed cases are all useful evaluation outcomes. An operator-run test is not
independent adoption or evidence of a recurring production incident.

To evaluate retaining the dependency, run the command above in your own
checkout and record: installed SDK/provider versions; pass/fail; whether these
checks would stay in your regular SDK-upgrade workflow and why; and the first blocker
if you would remove them. A later rerun after a real dependency change is
separate evidence of recurring use. No usage data or recordings are uploaded.
The Node file recorder is confined to these tests, not the browser bundle.
Wire-policy replay does not rerun application validators or the SDK loop.
