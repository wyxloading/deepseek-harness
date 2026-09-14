/**
 * Model-catalog refresh plugin, node half.
 *
 * Interrogating an endpoint is the adapter family's own capability: the
 * DeepSeek plugin registers model discovery for its settings namespace, and
 * the browser half reaches it through the existing llm/discoverModels Remote.
 * Nothing model-facing or durable is composed here, so this half stays inert
 * and the package needs no Host dependency beyond its own build.
 */

/** Host plugin body — the browser half owns every contribution. */
export function apply(): void {}
