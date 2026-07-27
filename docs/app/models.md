---
title: Models — profiles, roles, and why there are three slots
summary: How provider profiles work, what the primary/vision/image roles do, when a vision slot is needed, and the CORS requirement on any endpoint.
---

# Models — profiles, roles, and why there are three slots

## Profiles

A profile is one provider + key + model name. Once a provider is picked, only
the API key and the model name are needed — the base URL and the API adapter are
built in. Several profiles can exist at once.

Every endpoint must allow browser (CORS) access, because the browser makes the
call directly. The chat area warns when a connection fails.

Keys go to `localStorage` and straight to that provider — see
`storage-and-privacy`.

## Roles

Three slots, each pointing at a profile:

- **Primary** — runs the conversation and calls the tools.
- **Vision** — used when an image has to be looked at, through the `view_image`
  tool.
- **Image generation** — optional. Once set, the primary can create pictures
  with `generate_image`; they are saved into the KB and shown as a card.

## When the vision slot is needed

- A **Claude** primary is multimodal by nature — no vision slot needed.
- An OpenAI-compatible primary that is **itself multimodal** (qwen-vl, glm-4v,
  gpt-4o): point the vision slot at itself, and images go straight into context.
- A **text-only** primary (deepseek-chat, say): point the vision slot at a
  dedicated vision model. The primary then calls it through `view_image`.

Never guess an image's content from its filename — that is what the slot is for.

## Image generation support

OpenAI (DALL·E), Google (Imagen), xAI, and OpenAI-compatible
`/images/generations` endpoints (Zhipu CogView, Qwen, custom). The matching
image model name goes in the profile; the endpoint must allow browser CORS.

## Token economy

Requests are built so the prefix stays byte-identical across turns, because
every provider bills repeated prefix bytes at a fraction of fresh ones — but
only on an exact match. This is why the system prompt is split into a stable
block and a dynamic one, why the deferred-tools catalog is frozen rather than
reflecting what is currently activated, and why history is appended to rather
than rewritten.

The usage tooltip in the chat composer shows cache hits and writes. A near-zero
cache-hit share across a multi-turn session means something is invalidating the
prefix.

## Related

Which tools the agent can call: `tools`.
