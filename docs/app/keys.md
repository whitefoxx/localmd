---
title: API keys and what the model can see
summary: How secrets are referenced by name rather than value, why the agent never sees one, the one flat namespace caveat, and what to do when a key is missing.
---

# API keys and what the model can see

## The rule

Keys are stored in this browser and are never sent to the model.

A tool does not contain its key. It contains a reference — `{{secret:some_id}}`
— in a header, a URL or a body. The value is substituted at the moment the
request is actually built and sent. The agent reads and writes the reference; it
never reads the value.

This is why the agent can be genuinely useful about keys without being trusted
with them: it can say which key a tool needs, what the id is, where to obtain
one, and that the field is currently empty — all without the value ever entering
a conversation.

## Never ask for a key as chat text

If a key is needed, call `request_setup` with `kind: "key"`, the `secret_id` the
tools reference, a `help` line saying exactly where to get it, and a `url`. The
app renders a field; the user types into it directly; the value goes to
`localStorage` and the tool result says only that a value was saved.

A key collected this way is usable immediately, including in a `manage_tools`
`test` call in the same turn.

If the user skips it, do not loop. Build and save the tools anyway, and say they
will start working once the key is filled in under Settings → Tools → Keys.

## The one flat namespace

Key ids are a single flat list shared by every installed tool. A tool that names
an existing id receives that value, whatever host the tool points at.

This is worth understanding because tools can arrive from outside: a cloned
knowledge base carries `.agents/tools.json`, and a tool in it can name a key the
user already holds. Two things exist because of this:

- Settings lists, under each key, which tools read it.
- Approving a folder's tools warns when they name keys the user already has, and
  shows the hosts the tools send to.

## Where they live

`localStorage`, under `browser-md:settings`, alongside the LLM provider API keys
and the GitHub token. Same trust model throughout: this browser only, sent
straight to the provider or the API in question, never through any server of
ours — there isn't one.

They are not in the KB folder, so they are never committed and never travel with
a shared repository. Clearing site data loses them.

## When something is not working

A tool that returns 401/403 usually means the key is empty or wrong, not that
the spec is broken. Check that the id the tool references and the id in
Settings → Tools → Keys are the same string — a tool referencing
`{{secret:weread_key}}` gets nothing from a key saved as `weread_api_key`.

## Related

How tools reference and store things generally: `tools`.
