// @vitest-environment jsdom
/** The refresh card: the button, the picker, and what confirmation writes. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { RefreshModelsButton } from '../src/client/RefreshModelsButton.tsx'
import type { RefreshModelsButtonProps } from '../src/client/RefreshModelsButton.tsx'
import type { ModelsRefreshState } from '../src/client/refresh-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const route = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: [],
  active: true,
}

function bench(options: {
  state?: Partial<ModelsRefreshState>
  fetched?: object
  written?: object
} = {}) {
  const store = createSnapshotStore<ModelsRefreshState>({
    status: 'ready', writable: true, models: [], ...options.state,
  })
  const fetchModels = vi.fn(() => Promise.resolve(options.fetched ?? { kind: 'found', models: [] }))
  const applyModels = vi.fn(() => Promise.resolve(options.written ?? { kind: 'written' }))
  const props = {
    provider: route,
    configured: true,
    keyConfigured: true,
    t,
    useModelsRefresh: bindSnapshotSelector(store),
    fetchModels,
    applyModels,
  } as unknown as RefreshModelsButtonProps
  render(<RefreshModelsButton {...props} />)
  return { fetchModels, applyModels }
}

/** Open the picker on an endpoint that answered two models. */
async function openPicker() {
  const benchResult = bench({
    fetched: { kind: 'found', models: [{ id: 'acme-large', name: 'Acme Large' }, { id: 'acme-small' }] },
  })
  fireEvent.click(screen.getByRole('button', { name: en.fetch }))
  await screen.findByText('acme-large')
  return benchResult
}

describe('RefreshModelsButton', () => {
  it('asks the route its own endpoint when the button is pressed', async () => {
    const { fetchModels } = bench({ fetched: { kind: 'found', models: [{ id: 'only' }] } })

    fireEvent.click(screen.getByRole('button', { name: en.fetch }))

    await waitFor(() => { expect(fetchModels).toHaveBeenCalledWith('deepseek-official') })
  })

  it('offers every listed model already chosen, with its name beside it', async () => {
    await openPicker()

    expect(screen.getByText('Acme Large')).toBeDefined()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(box => box.checked)).toEqual([true, true])
  })

  it('narrows the list by id or name and reports an empty search', async () => {
    await openPicker()
    const search = screen.getByPlaceholderText(en.search)

    fireEvent.change(search, { target: { value: 'large' } })
    expect(screen.queryByText('acme-small')).toBeNull()

    fireEvent.change(search, { target: { value: 'nothing' } })
    expect(screen.getByText(en.noMatches)).toBeDefined()
  })

  it('selects and deselects every visible model from the toolbar', async () => {
    await openPicker()

    fireEvent.click(screen.getByRole('button', { name: en.deselectAll }))
    const cleared = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(cleared.map(box => box.checked)).toEqual([false, false])
    const update = screen.getByRole('button', { name: en.update }) as HTMLButtonElement
    expect(update.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: en.selectAll }))
    const restored = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(restored.map(box => box.checked)).toEqual([true, true])
  })

  it('writes the adopted catalog and closes the picker on success', async () => {
    const { applyModels } = await openPicker()

    fireEvent.click(screen.getByRole('button', { name: en.update }))

    await waitFor(() => {
      expect(applyModels).toHaveBeenCalledWith([
        { id: 'acme-large', name: 'Acme Large' },
        { id: 'acme-small' },
      ])
    })
    expect(screen.getByText(en.updated)).toBeDefined()
    expect(screen.queryByText('acme-large')).toBeNull()
  })

  it('drops a model the user unchecked from the write', async () => {
    const { applyModels } = await openPicker()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]

    fireEvent.click(boxes[0]!)
    // Re-checking is the same toggle the other way around.
    fireEvent.click(boxes[0]!)
    fireEvent.click(boxes[1]!)
    fireEvent.click(screen.getByRole('button', { name: en.update }))

    await waitFor(() => { expect(applyModels).toHaveBeenCalledWith([{ id: 'acme-large', name: 'Acme Large' }]) })
  })

  it('reports a refused interrogation and a listing with no models', async () => {
    bench({ fetched: { kind: 'refused', message: 'endpoint answered 401' } })
    fireEvent.click(screen.getByRole('button', { name: en.fetch }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'endpoint answered 401')

    cleanup()
    bench({ fetched: { kind: 'found', models: [] } })
    fireEvent.click(screen.getByRole('button', { name: en.fetch }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.emptyResult)
  })

  it('keeps the picker open and reports a write the Host refused', async () => {
    const { applyModels } = bench({
      fetched: { kind: 'found', models: [{ id: 'only' }] },
      written: { kind: 'conflict', message: 'someone else changed this' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.fetch }))
    await screen.findByText('only')

    fireEvent.click(screen.getByRole('button', { name: en.update }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'someone else changed this')
    expect(applyModels).toHaveBeenCalledOnce()
    expect(screen.getByText('only')).toBeDefined()
  })

  it('disables the action while the namespace is not writable', () => {
    bench({ state: { status: 'unavailable', writable: false } })

    const button = screen.getByRole('button', { name: en.fetch }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe(en.readOnly)
  })

  it('cancels the picker without writing', async () => {
    const { applyModels } = await openPicker()

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))

    expect(screen.queryByText('acme-large')).toBeNull()
    expect(applyModels).not.toHaveBeenCalled()
  })
})
