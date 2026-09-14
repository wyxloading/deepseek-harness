/**
 * Models page endpoint refresh plugin, browser half.
 *
 * It registers one card into the Models section's provider-card seat, keyed by
 * the DeepSeek settings namespace, so the Models page never learns that this
 * plugin exists and this plugin never reaches into the page. The card asks the
 * namespace's configured endpoint what it serves and offers the reply for
 * adoption; the settings document remains the only thing that decides what the
 * route serves.
 *
 * Export discipline: packages/client/AGENTS.md. Only cordis loading needs
 * the two named exports; the face types describe what the registration
 * injects.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service; a value import fails the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote merge and the keyed slot's declaration.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { MODELS_NS, ModelsRefreshController } from './refresh-controller.ts'
import type { ModelsRefreshSection } from './refresh-controller.ts'
import { RefreshModelsButton } from './RefreshModelsButton.tsx'
import { en, zh } from './locales.ts'

export type { ModelsRefreshFace, ModelsRefreshState } from './refresh-controller.ts'
export type { RefreshModelsButtonProps } from './RefreshModelsButton.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.modelsRefresh'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-models' apply, whose activation order relative to this one is
 * not constrained; registration depends on the slot through slots.inject().
 */
export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings', 'configForms']

/**
 * Register the refresh card once the Models section has declared the seat it
 * registers into, and keep it working for the life of this plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-models-refresh: card dictionary')
  // Bound once here, where configForms is declared in this plugin's own
  // inject; the card receives the controller's callbacks, never a context.
  const controller = new ModelsRefreshController(ctx.configForms.get<ModelsRefreshSection>(MODELS_NS), ctx)
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: MODELS_NS,
    locale: NS,
    inject: () => controller.inject(),
  }, RefreshModelsButton))
}
