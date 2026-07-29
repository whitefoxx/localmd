# docs/marketing — build in public, operationalized

Everything about telling the localmd story lives here (see CLAUDE.md
"Build in public" for the working agreement). Dev-side facts stay in git
history; files here reference commits instead of restating them.

## Files

| File | Role |
|---|---|
| `launch-plan.md` | Strategy: positioning, anti-claims, launch waves, channel matrix |
| `launch-platforms.md` | Verified platform facts (free paths, rules, sources) |
| `calendar.md` | Planned queue: when, where, what — the schedule we execute |
| `posted.md` | Append-only public trail: date, channel, content, link |
| `backlog.md` | Story material not yet drafted: hook, substance, media, channel |
| `drafts/` | One file per post, full text: `YYYY-MM-DD-<channel>-<slug>.md` |
| `playbook.md` | The transferable methodology — patterns + experiment log; seed of a future shareable skill |

## Flow

```
tellable work lands          schedule it            write it           publish it
(commit prompt offers) ──▶  backlog.md ──▶ calendar.md ──▶ drafts/… ──▶ posted.md
                                                                        (+ link)
```

- A **backlog** entry is born when work produces something tellable — the
  agent offers it alongside the commit prompt, with a drafted hook.
- Scheduling gives it a **calendar** row (date, channel, draft link, status).
- Writing the post creates a **drafts/** file; the backlog entry's content
  moves into it and the backlog entry is deleted (no double bookkeeping).
- Publishing moves the calendar row into **posted.md** with the public link.
  Draft files stay — they're the archive of what was actually said.
- Drafts aimed at a Chinese channel are written in Chinese; everything else
  follows the repo's English default.

## Rules that keep this honest

- The one-liner is byte-identical everywhere (see launch-plan.md).
- Anti-claims (launch-plan.md) bind every draft: no unverified Ollama claims,
  no "open source" in the present tense, no unqualified "data never leaves".
- Reserved ammunition is marked in backlog.md (e.g. the 18-day meta thread
  holds for Wave 2) — don't spend it early.
