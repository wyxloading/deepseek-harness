---
description: "Endpoint model refresh card for the dsh web client Models settings page: fetch the configured DeepSeek-family endpoint's model list and adopt it."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-models-refresh

English | [中文](README.zh.md)

## Summary

This package adds a **Fetch models** action to the DeepSeek provider row on the Models settings page. It asks the endpoint that route already resolves which models it serves — the deployment's own proxy or gateway as often as the public API — and opens a picker of the candidates it disclosed. Nothing is written until the user confirms: the checked candidates become the route's model catalog, while a row the user already tuned keeps its name and capacities.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings, choose **Models**, and use the button under the DeepSeek row. Pressing it interrogates the endpoint the route currently resolves and, once the endpoint answers, opens a dialog listing every model it disclosed.

### Choosing what to configure

Every listed model starts checked, because the action exists to make the route's catalog match what its endpoint actually serves. Unchecking a model leaves the stored catalog, and a model the endpoint no longer lists disappears once the update is confirmed. **Select all** and **Deselect all** act on the models the search currently shows, and the update is refused while the selection is empty, so a filter cannot silently wipe the catalog.

**Update config** writes the checked models in endpoint order. A model the route already carried keeps its stored row — the display name and capacities the user edited survive the refresh — while a newly listed model adopts the name and capacities the endpoint disclosed for it. The catalog is then read back from the settings document, which is the page's own source of truth.

### Failures

An endpoint that cannot be reached, refuses the request, or answers something other than a model listing reports the Host's own diagnostic beside the button, and hand-editing the catalog on the Models page remains available. An endpoint that answers with no models says so rather than opening an empty picker. When the settings document changed since the card read it, the update is refused as stale instead of overwriting the newer values, and the picker stays open so the selection is not lost.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is one registration and one write. It contributes no settings namespace and no Host capability of its own.

### Where the card sits

The card registers into `settings.models.provider-card`, the keyed seat the Models section declares, under the DeepSeek settings namespace. The section dispatches that seat once per provider row and skips a key nothing claims, so this package renders inside the DeepSeek row without the Models page knowing it exists. The Host half of the package is inert: endpoint interrogation belongs to the adapter family that owns the connection facts, and `llm-deepseek` registers it.

### Interrogation and the write

Fetching calls the `llm/discoverModels` Remote, which answers candidate metadata and never writes; the adapter family resolves the endpoint and credential itself, so this card never sees a key. The confirmed adoption is the only mutation: one `settings.mutate` path operation replacing `models`, fenced by the namespace revision the card read. Both Remote namespaces this package needs are declared in its own `inject`, and the card receives callbacks rather than a context.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the page this card extends and the seams it uses.

- [ui-settings-models](../ui-settings-models/README.md) — the Models section declaring the provider-card seat and owning the catalog editors.
- [ui-settings](../ui-settings/README.md) — the settings scope service this card reads and fences its write through.
- [llm](../../llm/README.md) — the adapter registry whose per-namespace model discovery answers the interrogation.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers nothing model-facing. The catalog it writes is advisory metadata the Models page and model pickers display; it does not reach a provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define which route the card serves and what it can ask; they are current package constraints.

- **Only the DeepSeek namespace has a refresh card** — the card is keyed on `llm-deepseek`, the one adapter family that registers model discovery for a configured route. A pi-ai route already has this action inside its own editor, and an adapter family that registers no discovery renders no card here.
- **The card asks the route, not the form** — it interrogates the endpoint and credential the Host resolves for the route, so an endpoint typed into the editor but not saved is not the one this action probes.
- **Interrogation covers OpenAI-compatible listings** — the adapter reads a `data` array or the enriched `models` map compatible gateways serve; an endpoint speaking a different listing dialect reports that it answered something unreadable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a browser-side card that derives its state from the shared settings scope and whose only mutation is one revision-fenced settings write; it owns no durable or cross-plugin runtime relationship.
