/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-models-refresh/client'
import type { ModelsRefreshFace } from '@deepseek-ai/dsh-client-ui-settings-models-refresh/client'
import { apply as hostApply } from '../src/index.ts'

// These specs assert the shipped Chinese copy: the lane has no browser
// language detection, so the bench stages zh explicitly.

const NS = 'settings.modelsRefresh'

/** The seat ui-settings-models declares for this card; declared here so the
 * registration has somewhere to land without composing the whole Models page. */
function declareSeat(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const discoverModels = vi.fn(() => Promise.resolve({ ok: true as const, value: [{ id: 'listed' }] }))
  const mutate = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { ns: 'llm-deepseek', value: {}, base: undefined, user: undefined, schema: {}, applies: 'live', secrets: [], revision: 2 },
  }))
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'llm-deepseek',
        // The wire carries the namespace's own serialized schema; the scope
        // decodes the section through it unless a spec supplies its own.
        schema: Schema.object({ models: Schema.array(Schema.object({ id: Schema.string().required() })) }).toJSON(),
        value: { models: [{ id: 'configured' }] },
        applies: 'live', secrets: [], revision: 1,
      }],
    },
  }))
  const remote = new TestRemote(ctx, { llm: { discoverModels }, settings: { describe, mutate } })
  // The settings provider resolves its persistence from these fixed Host facts.
  remote.$host = { home: undefined, isLoopback: true }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, discoverModels, mutate }
}

describe('ui-settings-models-refresh apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.llm', 'remote.settings', 'configForms'])
  })

  it('registers one card keyed on the DeepSeek namespace', async () => {
    const { ctx, slots } = await bench()
    declareSeat(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const cards = slots.entries('settings.models.provider-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.options.key).toBe('llm-deepseek')
    expect(cards[0]!.locale).toBe(NS)
    expect(slots.spec('settings.models.provider-card')).toMatchObject({ kind: 'keyed', scope: 'root' })
  })

  it('registers its own copy dictionary', async () => {
    const { ctx, slots, locale } = await bench()
    declareSeat(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(locale.bind(NS)('fetch')).toBe('获取模型列表')
  })

  it('injects the settings-derived snapshot and the two Remote operations', async () => {
    const { ctx, slots, discoverModels, mutate } = await bench()
    declareSeat(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const card = slots.entries('settings.models.provider-card')[0]!
    const face = (card.inject as unknown as () => ModelsRefreshFace)()
    expect(Object.keys(face.hooks)).toEqual(['modelsRefresh'])
    await vi.waitFor(() => {
      expect(face.hooks.modelsRefresh.getSnapshot().models).toEqual([{ id: 'configured' }])
    })

    await expect(face.fetchModels('deepseek-official'))
      .resolves.toEqual({ kind: 'found', models: [{ id: 'listed' }] })
    expect(discoverModels).toHaveBeenCalledWith('llm-deepseek', { provider: 'deepseek-official' })

    await expect(face.applyModels([{ id: 'adopted' }])).resolves.toEqual({ kind: 'written' })
    expect(mutate).toHaveBeenCalledWith(
      'llm-deepseek',
      [{ op: 'set', path: ['models'], value: [{ id: 'adopted' }] }],
      1,
    )
  })

  it('takes the card down with its fiber', async () => {
    const { ctx, slots } = await bench()
    declareSeat(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.models.provider-card')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.models.provider-card')).toEqual([])
  })
})
