# Free launch platforms — verified facts

Fact sheet for the localmd cold start (strategy lives in `launch-plan.md`).
Every claim below was checked against the platform's own pages on 2026-07-28;
"unverified" means the platform blocked automated access — check manually
before relying on it. Reach numbers are the platforms' own claims.

## Summary

| Platform | Free path | Wait/queue | Requirements | Reach claim | Fit |
|---|---|---|---|---|---|
| Hacker News Show HN | yes | none | something people can try; no landing pages | — | **strong** |
| Product Hunt | yes ("100% free") | schedule yourself | account; 00:01 PT recommended | — | **strong** |
| Uneed | yes (join the line) | next free slot | account | 90K visits/mo, DR75 dofollow | **strong** |
| AlternativeTo | yes | days–1 week review | account ≥1 week old; English UI | — | **strong** |
| V2EX 分享创造 | yes | none | 注册账号 | — | **strong** (中文首发) |
| 少数派 | yes (自由写作) | none | 3 篇过审成正式作者 | — | **strong** (中文长文) |
| Peerlist Launchpad | yes (per platform marketing) | weekly window, opens Monday | account | winners: newsletter + badge | medium-strong |
| awesome-local-first | yes (PR) | maintainer merge | no explicit OSS requirement seen | — | strong (credibility + backlink) |
| Microlaunch | yes (limits unclear) | queue; Pro $39/mo skips | account | 320K+ visitors (platform claim) | medium |
| Fazier | yes (/submit) | unclear | account | — | medium |
| There's An AI For That | maybe — free listing for fully-free tools | editorial review | $347 primary path; free-tool nuance below | 1.2M newsletter (platform claim) | medium |
| Indie Hackers | unverified (JS-only site) | — | account | — | medium |
| SideProjectors | yes (basic) | review | it's mainly a sell-your-project marketplace | — | weak |
| SaaSHub | unverified (403 to bots) | — | — | — | check manually |
| LaunchingNext | unverified (403 to bots) | — | — | — | check manually |
| StartupBase | unverified (fetch blocked) | — | — | — | check manually |
| TinyLaunch | unreachable (3 attempts) | — | — | — | check manually |
| DevHunt | unverified (JS-only pages) | weekly | — | — | better fit for Wave-3 SDK |

## Platform details

### Hacker News — Show HN
- Rules: "Show HN is for something you've made that other people can play
  with." Explicitly excludes "blog posts, sign-up pages, newsletters, lists,
  and other reading material" and landing pages/fundraisers. Title must begin
  with "Show HN". Posts start on the `shownew` page and graduate to `show`
  with engagement. "Don't ask friends to upvote."
- localmd qualifies: it is directly playable in the browser with no sign-up.
- Source: https://news.ycombinator.com/showhn.html

### Product Hunt
- "Yes. It's 100% free to use." Submit via account → New Product → URL flow.
  Official guidance: "12:01 am Pacific Time is the best time to launch";
  "The best day to launch is the day on which you're most prepared."
- Source: https://www.producthunt.com/launch

### Uneed
- Free tier: "Join the line" → "Get an automatic launch date at the next
  available slot". Paid: $29.99 to pick the date, $15 relaunch. All launches
  get a "do-follow backlink from a 75DR website"; platform claims "90K monthly
  visitors". Pro sub ($99/yr) is community features, not required to launch.
- Source: https://www.uneed.best/pricing

### AlternativeTo
- Developers may add their own app free: "You can add it yourself :) Just sign
  up for an account." Constraints: "New users must wait a week after the
  creation of their account", app must "support the English language", review
  takes "between a couple of days and up to a week", approval "at admins'
  discretion" (they reject thin AI wrappers — localmd is a real app).
- Value is durable category discovery ("Obsidian alternatives", "Notion
  alternatives") rather than a launch spike.
- Source: https://alternativeto.net/faq/

### V2EX 分享创造
- Node description: "欢迎你在这里发布自己的最新作品！" Registered users post
  free; 35K+ topics in the node. No explicit extra rules on the node page.
- Source: https://www.v2ex.com/go/create

### 少数派 (sspai)
- "无需申请，自由写作" — any user can write; publishing 3 rule-compliant
  pieces grants official author status. Long-form product stories are native
  content here.
- Source: https://sspai.com/matrix

### Peerlist Launchpad
- Help center: "Launch window opens on Monday every week!"; winners are
  "featured in Peerlist's monthly newsletter and social media channels" plus a
  product badge. Free per the platform's public marketing; the site 403s
  automated fetches, so the pricing detail is from secondary confirmation —
  glance at it when creating the account.
- Sources: https://help.peerlist.io/individual/launchpad/introduction ,
  https://peerlist.io/launchpad (403 to bots)

### Microlaunch
- Free launch path exists (Launch Now flow) but the free tier's limits aren't
  spelled out on the pages fetched. Pro Launch $39/mo: "Skip the Queue -
  Launch Anytime", featured spots, "lifetime DR60+ backlinks". Platform
  claims 320K+ unique visitors / 5.5M impressions historically.
- Source: https://microlaunch.net/premium

### Fazier
- Free "[Submit Product](/submit)" link in footer; paid advertising exists;
  queue/backlink details live in their Notion help center (not fetched).
- Source: https://fazier.com

### There's An AI For That (TAAFT)
- Primary submission is **$347** one-time (refund if rejected), newsletter
  claim 1.2M+ subscribers. BUT the page also distinguishes listing types:
  free/open-source tools list at no charge, paid/freemium tools at $20.
  localmd is currently 100% free → the no-charge path should apply. The page
  wording is confusing; confirm at submission time before paying anything.
- Source: https://theresanaiforthat.com/get-featured/

### awesome-local-first (github.com/schickling/awesome-local-first)
- Standard awesome-list PR flow. No explicit open-source requirement in the
  README; the Applications section already includes closed-source-friendly
  entries and notably **Bangle-io** ("web only WYSIWYG note taking app that
  saves notes locally in markdown format") — near-identical form factor to
  localmd, so eligibility looks clear even while the repo is private.
- Related lists to consider with the same PR: zhongkechen/awesome-local-first,
  radical-data/awesome-local-first, janhq/awesome-local-ai (criteria unchecked).
- Source: https://github.com/schickling/awesome-local-first

### Indie Hackers
- Site is a JS app; product-add flow couldn't be verified by fetch.
  Historically free with an account. Treat as unverified.
- Source attempted: https://www.indiehackers.com/products

### SideProjectors
- Primarily a marketplace for selling side projects, with a showcase angle;
  "Basic project submissions and browsing are free", listings go through
  review. Weak fit — localmd isn't for sale.
- Source: https://www.sideprojectors.com

## Community channels

Fetched via the maker's browser on 2026-07-28 (old.reddit rules pages).

> **Blocker discovered during verification:** the maker's Reddit account shows
> "Your account has been permanently suspended from Reddit." Every Reddit
> plan below is gated on resolving this (appeal, or a new account — noting
> that brand-new accounts doing self-promo are typically auto-filtered).

- **r/SideProject** — rules page lists no formal rules; the sub exists to show
  projects. Lowest-risk Reddit venue.
- **r/PKMS** — rule 3: "You may post about systems/programs you have created,
  but not if it reads like an ad." A genuine walkthrough post is fine.
- **r/LocalLLaMA** — "Limit Self-Promotion": 1/10th-rule guideline,
  "Affiliation must be disclosed", no LLM-generated copy, content must be
  LLM-related. Only post once the local-model (Ollama) story is verified.
- **r/ObsidianMD** — rule 3 "Don't shill": "If you are just here to advertise
  your product, don't." Rule 4: "If your first and only post is to promote
  your project (vibe-coded or otherwise), you will be immediately banned."
  **Do not launch-post here.** Participation must be organic or not at all.
- **lobste.rs** — invite-only; no invite in hand, unverified.
- **X #buildinpublic / Bluesky** — no verifiable reach claims; use as ongoing
  presence, not launch events.

## Excluded (pay-only or already used)

- **Futurepedia** — no free path: Basic $247 (sold out at check), Verified
  $497. https://www.futurepedia.io/submit-tool
- **BetaList** — already submitted (paid tier decision pending); no free path
  observed at submission time.
- **TAAFT $347 primary path** — see nuance above; only the free-tool listing
  type is worth using.
