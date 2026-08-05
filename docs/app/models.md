---
title: Models — connecting an AI provider
summary: Add a provider key to make the assistant work, what the three roles are for, and when you need a separate vision model.
---

# Models — connecting an AI provider

The app has no AI of its own. You bring a key from a provider, and requests go
from your browser straight to them. There is no middleman and nothing is billed
by localmd.

Set it up in **Settings → Models**.

## Adding a model

Click **Add model**, pick a provider, paste the API key, and type the model
name. Everything else is filled in for you.

Anthropic, OpenAI, Google, DeepSeek, Zhipu, Qwen, xAI and any
OpenAI-compatible endpoint all work. You can add several and switch between
them.

If a key or model name is wrong, the chat area will tell you when you first send
a message.

## The three roles

Below the list, each role points at one of your models:

- **Primary** — runs the conversation and does the work. This is the only one
  that must be set.
- **Vision** — used when an image needs to be looked at.
- **Image generation** — optional. Set it and the assistant can create pictures,
  saved into your folder.

## Do you need a vision model?

- Using **Claude**? No. It handles images itself.
- Using a model that already understands images (GPT-4o, qwen-vl, glm-4v)? Point
  the vision role at that same model.
- Using a text-only model (deepseek-v4-flash, for example)? Point the vision
  role at a separate model that does images. The assistant will call it when
  needed.

Without a vision role on a text-only model, it simply cannot see images — and it
will say so rather than guess from the filename.

## Which to choose

Any current model works. Stronger models follow multi-step instructions more
reliably and are better at the fiddlier jobs like building a new tool; cheaper
ones are perfectly good for search, summarizing and filing.

You can change the primary at any time, including mid-project.

## Cost

You are billed by your provider, at their rates. The app is built to keep the
repeated part of each request identical between messages, because every provider
charges much less for a repeated prefix than for fresh text — which is why a
long conversation costs far less than its length suggests.

Hovering the token counter under the message box shows what a session has used.

## Related

What the assistant can then do: `working-with-the-agent`. Where the key is
stored: `storage-and-privacy`.
