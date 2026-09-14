# Agent Note: DeepSeek routes refresh their model catalog from the endpoint

Status: implemented

English | [中文](2026-09-14-deepseek-endpoint-model-refresh.zh.md)

## Problem

A deployment that points the DeepSeek route at its own proxy or gateway maintains the route's advisory model catalog by hand. That catalog is what the Models page and the model pickers show, so it drifts as the gateway adds, renames, or retires models, and nothing on the settings surface can ask the endpoint what it actually serves. The pi-ai adapter family already answers that question through `llm/discoverModels`; the direct DeepSeek adapter never registered discovery, so its rows had no fetch action.

The same missing capability is what kept a plugin from offering one: the Models section's `settings.models.provider-card` seat exists for out-of-tree UI, but a card can only offer a fetch when the owning adapter family answers the interrogation.

## Decision

The DeepSeek plugin registers model discovery for its own settings namespace, and a new client package contributes the card that uses it.

`llm-deepseek` registers `ctx.llm.registerModelDiscovery('llm-deepseek', ...)` during apply — the seam [the draft-endpoint note](../architecture/2026-08-04-draft-provider-endpoint-interrogation.md) defines, applied to a second adapter family. The registration resolves the endpoint and credential from the same per-request facts the adapter uses, so the interrogation asks the route's current endpoint rather than a stored copy, and a request-supplied `baseURL` or one-shot `apiKey` overrides it for a draft. The credential is resolved optionally: a reference the deployment does not supply probes unauthenticated, because a gateway on a private network may answer an open listing, and refusing before asking would hide that.

Interrogation issues `GET {baseURL}/models` and reads the OpenAI-compatible listing the DeepSeek wire dialect uses — a `data` array, or the enriched `models` map some gateways serve in its place. Plain `display_name`/`max_input_tokens`/`max_tokens` spellings and the camelCase and `limit` spellings gateways use are all read; entries without a usable id are skipped rather than failing the whole reply. The reply is candidate metadata: the module reads no settings and writes none.

`@deepseek-ai/dsh-client-ui-settings-models-refresh` registers one card into the Models section's keyed `settings.models.provider-card` seat under the `llm-deepseek` key. The card reads the route's current catalog through the client settings scope, asks `llm/discoverModels` for candidates, and opens a picker in which every listed model starts checked. Confirming writes one `settings.mutate` path operation replacing `models`, fenced by the namespace revision the card read; that is the only write in the package. A model the route already carried keeps its stored row, so a display name or capacity the user tuned survives the refresh, and a model left unchecked leaves the catalog.

## Alternatives considered

**Put the card inside `ui-settings-models`.** The Models page already owns a model-list editor with a fetch action, and adding one button there is less code than a package. It lost because the extension seat and the discovery registry both exist precisely so a configuration surface outside the page can do this: the page would have had to learn the DeepSeek namespace, and the package that ships the card would stop being an independent unit.

**Register discovery from the new plugin's Host half.** A plugin can register discovery for any settings namespace, so the adapter package need not change. It lost because endpoint and credential resolution would have to be reimplemented: `llm-deepseek` resolves `baseURL` through its own settings section and the launch environment, and resolves the credential through the credentials seam with an environment fallback. A second implementation of those rules is a second answer to "which endpoint is configured", and the two would drift.

**Fetch from the browser instead of the Host.** The page and a local gateway can be same-host, so a direct `fetch` looks equivalent. It lost because the browser cannot read a secret-role credential at all and the endpoint is cross-origin to the GUI; the Host already owns both facts.

**Apply the fetched list automatically.** One press could write the catalog without a picker. It lost because the settings document is the only thing that decides what a route serves, and a silent rewrite would drop a model the user deliberately kept or overwrite a capacity they corrected. The picker keeps the adoption an explicit choice, matching the pi-ai editor's rule that a discovery reply is candidates, never configuration.

## Consequences

The Models page gains a button under the DeepSeek row that keeps its catalog aligned with whatever endpoint the route resolves, including a deployment's own gateway. The catalog it writes is advisory metadata: no request is validated against it, and the discovery path never reaches a provider inference request.

The package is inert on the Host side, so it carries no Host dependency beyond its build; the interrogation contract lives with the adapter family, which is also where a future family would add its own. Two answers now exist to "what models does this endpoint serve" — the adapter's own listing reader and pi-ai's — and they stay separate because the two packages answer for different wire dialects and neither exports a reusable reader. A deployment composing no settings provider, or no `llm` service, renders no card, and a route whose adapter registers no discovery is skipped by the seat's key without an error.

## Testing

The adapter's discovery is pinned by unit tests over the listing reader's tolerated dialects and edge cases, and over real HTTP servers for credential selection, refusals, oversized and streamed responses, non-JSON replies, and cancellation. The client package is pinned by controller tests over the projection, the adoption merge, and both Remote outcomes; card tests over the button, the picker's filtering, select-all, adoption, refusal reporting, and the read-only disabled state; and an apply test over the registration, its locale dictionary, the inject face reaching both Remotes, and the contribution leaving with its fiber.
