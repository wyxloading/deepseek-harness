/**
 * The Models page's endpoint refresh card: the Host operations it calls and
 * the state it derives from the DeepSeek settings namespace.
 *
 * Interrogation goes through the llm discovery Remote, which answers candidate
 * metadata and never writes; the adoption the user confirms is the only write
 * this module performs, fenced by the namespace revision the card read. The
 * reply is never applied behind the user's back.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge (the llm discovery and settings
// mutates this module calls) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { LlmDiscoveredModel, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Settings namespace of the DeepSeek adapter family this card serves. Spelled
 * here rather than imported: a browser package must not depend on a Host
 * package, and the key a card is dispatched under is this same namespace.
 */
export const MODELS_NS = 'llm-deepseek'

/** One catalog row as the namespace stores it; fields this card does not edit survive. */
export type CatalogRow = Record<string, unknown>

/** The section fields this card reads. */
export interface ModelsRefreshSection {
  /** The route's advisory model catalog, as the settings layers resolve it. */
  models?: unknown
}

/** What the refresh card renders from the settings document. */
export interface ModelsRefreshState {
  /** Whether the namespace is loaded and readable. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** The catalog rows the namespace currently resolves. */
  models: readonly CatalogRow[]
}

/** What one endpoint interrogation answered. */
export type DiscoveryOutcome =
  /** Candidates the endpoint disclosed, in its own order. */
  | { readonly kind: 'found'; readonly models: readonly LlmDiscoveredModel[] }
  /** The interrogation was refused, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** What one catalog write answered. */
export type ApplyOutcome =
  | { readonly kind: 'written' }
  /** The stored revision moved after the card read it, so the adoption is stale. */
  | { readonly kind: 'conflict'; readonly message: string }
  /** Any other refusal, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** The registration-side face the refresh card's slot entry injects. */
export interface ModelsRefreshFace {
  hooks: {
    /** Card snapshot bound by the renderer as useModelsRefresh. */
    modelsRefresh: SnapshotStore<ModelsRefreshState>
  }
  /**
   * Ask the route's configured endpoint which models it serves.
   * @param provider - the route whose adapter family answers.
   * @returns the candidates, or the refusal.
   */
  fetchModels(provider: string): Promise<DiscoveryOutcome>
  /**
   * Replace the namespace's catalog with the rows the user adopted.
   * @param models - the complete catalog to store, in the order to store it.
   * @returns the write outcome the card renders from.
   */
  applyModels(models: readonly CatalogRow[]): Promise<ApplyOutcome>
}

/** One catalog entry as the probe writes it, keeping only what the endpoint disclosed. */
function adopt(model: LlmDiscoveredModel): CatalogRow {
  return {
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
  }
}

/**
 * Read the stored catalog as records. Anything that is not an object row is
 * dropped rather than repaired: the section's own schema is what admits a row,
 * and a value it never admitted is not a model this card may rewrite.
 * @param value - the resolved models field, of unknown shape.
 * @returns the row records, empty when the field carries none.
 */
export function catalogRows(value: unknown): CatalogRow[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry as CatalogRow : {})
}

/**
 * The catalog one confirmed adoption writes: every picked endpoint model in
 * endpoint order, with a row the namespace already carries taking precedence so
 * a name or capacity the user tuned survives the refresh. A row left unpicked
 * leaves the catalog, which is what makes deselecting a removal.
 * @param configured - the rows the namespace resolves now.
 * @param discovered - the candidates the endpoint disclosed.
 * @param picked - ids the user kept.
 * @returns the rows to store.
 */
export function mergeCatalog(
  configured: readonly CatalogRow[],
  discovered: readonly LlmDiscoveredModel[],
  picked: ReadonlySet<string>,
): CatalogRow[] {
  const known = new Map<string, CatalogRow>()
  for (const row of configured) {
    const id = row['id']
    if (typeof id === 'string' && !known.has(id)) known.set(id, row)
  }
  const next: CatalogRow[] = []
  for (const model of discovered) {
    if (!picked.has(model.id)) continue
    const existing = known.get(model.id)
    next.push(existing === undefined ? adopt(model) : { ...adopt(model), ...existing })
  }
  return next
}

/** Bridges the DeepSeek settings scope and the llm discovery Remote onto the card. */
export class ModelsRefreshController {
  private readonly store: SnapshotStore<ModelsRefreshState>

  /**
   * @param form - the shared settings form for the DeepSeek namespace.
   * @param ctx - the card plugin's context, whose remote.llm and remote.settings
   * namespaces answer the interrogation and the write.
   */
  constructor(
    private readonly form: ConfigForm<ModelsRefreshSection>,
    private readonly ctx: ClientContext,
  ) {
    this.store = createSnapshotStore(this.projection())
    form.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): ModelsRefreshState {
    const snapshot = this.form.getSnapshot()
    return {
      status: snapshot.status,
      writable: snapshot.writable,
      models: catalogRows(snapshot.value?.models),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its two Host operations.
   */
  inject(): ModelsRefreshFace {
    return {
      hooks: { modelsRefresh: this.store },
      fetchModels: provider => this.fetchModels(provider),
      applyModels: models => this.applyModels(models),
    }
  }

  private async fetchModels(provider: string): Promise<DiscoveryOutcome> {
    const response = await this.ctx.remote.llm.discoverModels(MODELS_NS, { provider })
    return response.ok
      ? { kind: 'found', models: response.value }
      : { kind: 'refused', message: response.error.message }
  }

  private async applyModels(models: readonly CatalogRow[]): Promise<ApplyOutcome> {
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: ['models'], value: models as unknown as JsonValue },
    ]
    const response = await this.ctx.remote.settings.mutate(
      MODELS_NS, ops, this.form.getSnapshot().revision,
    )
    if (response.ok) return { kind: 'written' }
    const { code, message } = response.error
    return code === 'settings/conflict' ? { kind: 'conflict', message } : { kind: 'refused', message }
  }
}
