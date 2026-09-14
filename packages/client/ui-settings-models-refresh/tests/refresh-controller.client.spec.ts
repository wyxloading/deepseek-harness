/** The refresh card's derived state, its two Host calls, and the adoption merge. */

import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  MODELS_NS, ModelsRefreshController, catalogRows, mergeCatalog,
} from '../src/client/refresh-controller.ts'
import type { ModelsRefreshSection } from '../src/client/refresh-controller.ts'

/** The card plugin's context, scripted down to the namespaces it reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

/** A stand-in shared settings form: the snapshot the card projects and the
 * listener set the settings mirror would drive. */
function stubConfigForm<T>() {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const form: ConfigForm<T> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: () => Promise.resolve(false),
    set: () => Promise.resolve(false),
    unset: () => Promise.resolve(false),
  }
  return {
    form,
    publish(update: Partial<ConfigFormSnapshot<T>>) {
      snapshot = { ...snapshot, ...update }
      for (const listener of listeners) listener()
    },
  }
}

function harness(options: {
  discovery?: object
  write?: object
  section?: Partial<ConfigFormSnapshot<ModelsRefreshSection>>
} = {}) {
  const host = stubConfigForm<ModelsRefreshSection>()
  host.publish({
    status: 'ready',
    writable: true,
    revision: 7,
    value: { models: [] },
    ...options.section,
  })
  const answer = options.discovery ?? { ok: true as const, value: [] }
  const discoverModels = vi.fn(() => Promise.resolve(answer))
  const write = options.write ?? { ok: true as const, value: {} }
  const mutate = vi.fn(() => Promise.resolve(write))
  const controller = new ModelsRefreshController(
    host.form,
    ctxWith({ llm: { discoverModels }, settings: { mutate } }),
  )
  return { host, controller, discoverModels, mutate }
}

describe('catalog rows reading', () => {
  it('keeps object rows and drops everything the schema could not have admitted', () => {
    expect(catalogRows([{ id: 'kept' }, null, 'text', [], 4])).toEqual([{ id: 'kept' }, {}, {}, {}, {}])
    expect(catalogRows(undefined)).toEqual([])
    expect(catalogRows({ id: 'not an array' })).toEqual([])
  })
})

describe('adoption merge', () => {
  it('writes picked candidates in endpoint order, keeping a tuned row in front', () => {
    expect(mergeCatalog(
      [{ id: 'kept', name: 'Tuned Name', contextWindow: 42 }, { id: 'dropped', name: 'Gone' }],
      [
        { id: 'kept', name: 'Endpoint Name', contextWindow: 1000, maxTokens: 10 },
        { id: 'fresh', name: 'Fresh' },
        { id: 'dropped', name: 'Dropped' },
      ],
      new Set(['kept', 'fresh']),
    )).toEqual([
      { id: 'kept', name: 'Tuned Name', contextWindow: 42, maxTokens: 10 },
      { id: 'fresh', name: 'Fresh' },
    ])
  })

  it('adopts a candidate with no name or capacities as its bare id', () => {
    expect(mergeCatalog([], [{ id: 'bare' }], new Set(['bare']))).toEqual([{ id: 'bare' }])
  })

  it('keeps the first configured row per id and ignores rows without one', () => {
    expect(mergeCatalog(
      [{ id: 'twice', name: 'First' }, { id: 'twice', name: 'Second' }, { name: 'no id' }],
      [{ id: 'twice', name: 'Endpoint' }],
      new Set(['twice']),
    )).toEqual([{ id: 'twice', name: 'First' }])
  })

  it('writes nothing when the endpoint listed nothing picked', () => {
    expect(mergeCatalog([{ id: 'kept' }], [{ id: 'kept' }], new Set())).toEqual([])
  })
})

describe('refresh controller', () => {
  it('projects the scope section and republishes on every change', () => {
    const { host, controller } = harness({ section: { value: { models: [{ id: 'a' }] } } })
    const face = controller.inject()

    expect(face.hooks.modelsRefresh.getSnapshot()).toEqual({
      status: 'ready', writable: true, models: [{ id: 'a' }],
    })

    host.publish({ writable: false })
    expect(face.hooks.modelsRefresh.getSnapshot().writable).toBe(false)

    host.publish({ status: 'unavailable', value: undefined })
    expect(face.hooks.modelsRefresh.getSnapshot()).toMatchObject({ status: 'unavailable', models: [] })
  })

  it('answers refused interrogations with the Host diagnostic', async () => {
    const error = new RemoteError('llm/model-discovery-rejected', 'endpoint answered 401', { settingsNs: MODELS_NS })
    const { controller, discoverModels } = harness({ discovery: { ok: false, error } })

    await expect(controller.inject().fetchModels('deepseek-official'))
      .resolves.toEqual({ kind: 'refused', message: 'endpoint answered 401' })
    expect(discoverModels).toHaveBeenCalledWith(MODELS_NS, { provider: 'deepseek-official' })
  })

  it('answers found candidates in endpoint order', async () => {
    const { controller } = harness({ discovery: { ok: true, value: [{ id: 'a' }, { id: 'b' }] } })

    await expect(controller.inject().fetchModels('deepseek-official'))
      .resolves.toEqual({ kind: 'found', models: [{ id: 'a' }, { id: 'b' }] })
  })

  it('writes the adopted catalog under the revision the card read', async () => {
    const { controller, mutate } = harness()

    await expect(controller.inject().applyModels([{ id: 'a' }])).resolves.toEqual({ kind: 'written' })
    expect(mutate).toHaveBeenCalledWith(
      MODELS_NS,
      [{ op: 'set', path: ['models'], value: [{ id: 'a' }] }],
      7,
    )
  })

  it('reports a stale revision and any other refusal separately', async () => {
    const conflict = harness({
      write: {
        ok: false,
        error: new RemoteError('settings/conflict', 'stale', { ns: MODELS_NS, expected: 6, actual: 7 }),
      },
    })
    await expect(conflict.controller.inject().applyModels([]))
      .resolves.toEqual({ kind: 'conflict', message: 'stale' })

    const refused = harness({
      write: { ok: false, error: new RemoteError('gateway/internal', 'read-only deployment', {}) },
    })
    await expect(refused.controller.inject().applyModels([]))
      .resolves.toEqual({ kind: 'refused', message: 'read-only deployment' })
  })
})
