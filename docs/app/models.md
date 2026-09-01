---
title: Models — connecting an AI provider
summary: Add a provider key to make the assistant work, what the three roles are for, and how to tell the app what your model can do.
---

# Models — connecting an AI provider

The app has no AI of its own. You bring a key from a provider, and requests go
from your browser straight to them. There is no middleman and nothing is billed
by localmd.

Set it up in **Settings → Models**.

## Adding a model

Click **Add model**, pick a provider, paste the API key, and type the model
name. Everything else is filled in for you.

**What it can do** is a row of tick boxes under the model name: chat, reads
pictures, makes pictures. They are ticked to match the provider you picked,
which is a starting guess and nothing more — a provider tells you very little
about one of its models, and nothing at all about a custom endpoint. Correct
them and the roles below follow.

Anthropic, OpenAI, Google, DeepSeek, Zhipu, Qwen, xAI and any
OpenAI-compatible endpoint all work — including a model running on your own
machine, through Ollama or anything like it. You can add several and switch
between them.

If a key or model name is wrong, the chat area will tell you when you first send
a message.

## Thinking effort

Some models pause to reason before they answer. That reasoning is often the
best part of the result — and often far longer than the question deserved.

Each model has a **Thinking effort** setting, from Off up to Very high, next to
its API key. Turn it down when replies feel padded with deliberation you did not
need; turn it up for jobs that take several steps, like reworking a folder or
building a tool. Left on **Default**, the provider picks for you — and some
providers pick their heaviest gear: the GLM-5.3 family, for one, always thinks
and defaults to its deepest effort. If a model deliberates far longer than the
question deserved, don't leave Default — set the effort explicitly, and start
from Low.

It is one setting, not one per provider: the app translates it into whatever
each provider calls the same idea — best-effort, because the ladders don't
align. A model with no reasoning to speak of simply ignores it; a step a
provider doesn't offer falls back to that provider's own default, and Off is
such a step more often than you'd think — not every model can be told not to
think. A few endpoints refuse the request outright — the chat area tells you
if that happens.

Effort is not free in either direction. More thinking means slower answers and a
larger bill; none at all can mean a worse one.

## The three roles

Below the list, each role points at one of your models:

- **Primary** — runs the chat and does the work. This is the only one
  that must be set.
- **Vision** — used when an image needs to be looked at.
- **Image generation** — optional. Set it and the assistant can create pictures,
  saved into your folder.

Each list puts the models you ticked for that job first. The rest are still
there, under **Not marked for this** — pick one and you are asked whether to
tick it, because the ticks are your guess too, and a list that hid the model you
wanted would be worse than one that asks.

A picture-making model is not a chat model. Setting one as your primary is the
usual way this goes wrong: every message then goes to an address that only draws,
and comes back as an error about the address. Give the primary a chat model and
point the **Image generation** role at the one that draws.

## Do you need a vision model?

- Is your model already ticked for **reads pictures**? Then no — point the
  vision role at that same model, or leave it empty if it is your primary.
- Using a text-only model (deepseek-v4-flash, for example)? Point the vision
  role at a separate model that does read pictures. The assistant will call it
  when needed.

Without a vision role on a text-only model, it simply cannot see images — and it
will say so rather than guess from the filename.

## Which to choose

Any current model works. Stronger models follow multi-step instructions more
reliably and are better at the fiddlier jobs like building a new tool; cheaper
ones are perfectly good for search, summarizing and filing.

You can change the primary at any time, including mid-project. The quickest
way is the model name under the message box: click it, and your models drop up
in a list to pick from. It sorts them exactly as the role lists above do —
models ticked for chatting first, the rest under **Not marked for this**, and a
question before an unmarked one is used — so a picture-making model cannot
become your primary by a single stray click. Settings is the last row of that
same menu.

The eye beside the name is the same control for the vision role: it shows
whether anything can read a picture right now, and clicking it is where you
choose which model does. **Not set** is the first option, for when your primary
reads pictures by itself.

## Cost

You are billed by your provider, at their rates. The app is built to keep the
repeated part of each request identical between messages, because every provider
charges much less for a repeated prefix than for fresh text — which is why a
long chat costs far less than its length suggests.

Hovering the token counter under the message box shows what a chat has used.

## Related

What the assistant can then do: `working-with-the-agent`. Where the key is
stored: `storage-and-privacy`.
