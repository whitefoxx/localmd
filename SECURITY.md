# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository —
**Security → Report a vulnerability**. It opens a private thread; please do not
open a public issue for something exploitable.

Include what an attacker gains and the steps to reproduce it. A solo maintainer
reads these, so expect a first reply in days rather than hours.

## The trust model, so reports can be about real gaps

localmd is a static page. There is no backend, no account and no server-side
state, which removes whole categories of vulnerability and creates a few of its
own. What holds:

- **Your files** are reached through the File System Access API, only for the
  folder you picked, only while the tab has the handle you granted.
- **Your API keys** live in this browser's `localStorage` and are sent to the
  provider you configured, directly from the page. Anything with script access
  to the origin can read them; that is the same trust boundary as any web app
  holding a token, and it is why the app is served from its own origin.
- **The agent** reads web pages, tool results and files, none of which can be
  told apart from a genuine instruction by their content. Anything with an
  outward effect goes through a card the user clicks, and a decision defaults to
  no. **A path where a document, page or tool result causes an outward action
  without a person approving it is a vulnerability** — that is the interesting
  class of report here.
- **What the agent may change in settings** is an allowlist
  (`src/lib/appSettings.ts`). It deliberately excludes every key, token and
  secret. A way to read or write one through the agent is a vulnerability.

## Not vulnerabilities

- **Patching the build to unlock something.** Nothing here is gated;
  the hosted one verifies a licence offline and deliberately does not try to be
  tamper-proof. Its own source says so. Time spent making a bundle
  untamperable is time taken from the people who paid.
- **Reading your own API key out of your own browser's storage.** That is where
  you put it, and there is nowhere else for a page with no backend to keep it.
- **Sending your text to a model provider.** That is the app working. What it
  must never do is send it anywhere you did not configure — that would be a
  report worth making.
