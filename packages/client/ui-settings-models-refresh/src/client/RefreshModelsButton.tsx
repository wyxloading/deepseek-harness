/**
 * The Models page's endpoint refresh card: one button that asks the route's
 * configured endpoint which models it serves, then a picker whose confirmed
 * selection is the only thing written.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the keyed slot's declaration and its owner props.
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { mergeCatalog } from './refresh-controller.ts'
import type { ModelsRefreshFace } from './refresh-controller.ts'
// Type-only: the locale-namespace declaration this component's copy comes from.
import type {} from './locales.ts'
import styles from './RefreshModelsButton.module.css'

/** Props the renderer binds for the refresh card. */
export type RefreshModelsButtonProps =
  PropsRuntime<'settings.models.provider-card'>
  & PropsLocale<'settings.modelsRefresh'>
  & InjectFace<ModelsRefreshFace>

/**
 * Render the endpoint refresh card.
 * @param props - the route being refreshed, locale copy, and the card's operations.
 * @returns the button, its outcome messages, and the adoption picker.
 */
export function RefreshModelsButton(props: RefreshModelsButtonProps): ReactNode {
  const { t } = props
  const state = props.useModelsRefresh(snapshot => snapshot)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')

  const disabled = state.status !== 'ready' || !state.writable

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
    setQuery('')
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    setNotice(undefined)
    try {
      const answer = await props.fetchModels(props.provider.provider)
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      if (answer.models.length === 0) {
        setFailure(t('emptyResult'))
        return
      }
      setQuery('')
      setCandidates(answer.models)
      // Everything the endpoint listed starts chosen: the action exists to
      // make the configuration match the endpoint, and the user narrows it
      // from there.
      setPicked(new Set(answer.models.map(model => model.id)))
    } finally {
      setBusy(false)
    }
  }

  const update = async (): Promise<void> => {
    /* v8 ignore next -- the action only renders with candidates loaded */
    if (candidates === undefined) return
    setSaving(true)
    setFailure(undefined)
    try {
      const answer = await props.applyModels(mergeCatalog(state.models, candidates, picked))
      if (answer.kind !== 'written') {
        setFailure(answer.message)
        return
      }
      closePicker()
      setNotice(t('updated'))
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const listed = candidates ?? []
  const normalized = query.trim().toLowerCase()
  const visible = normalized.length === 0
    ? listed
    : listed.filter(model => model.id.toLowerCase().includes(normalized)
      || model.name?.toLowerCase().includes(normalized) === true)
  const allVisiblePicked = visible.length > 0 && visible.every(model => picked.has(model.id))

  const toggleVisible = (): void => {
    setPicked((current) => {
      if (visible.every(model => current.has(model.id))) return new Set()
      const next = new Set(current)
      for (const model of visible) next.add(model.id)
      return next
    })
  }

  return (
    <div className={styles['card']}>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        title={disabled ? t('readOnly') : t('fetchHint')}
        onClick={() => { void fetchModels() }}
      >
        {busy ? t('fetching') : t('fetch')}
      </Button>
      {notice === undefined ? null : <p className={styles['notice']} role="status">{notice}</p>}
      {failure === undefined ? null : <p className={styles['failure']} role="alert">{failure}</p>}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('dialogTitle')}
        closeLabel={t('close')}
        description={t('dialogDescription')}
        className={styles['dialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button
              variant="outline"
              disabled={picked.size === 0 || saving}
              onClick={() => { void update() }}
            >
              {saving ? t('updating') : t('update')}
            </Button>
          </>
        )}
      >
        <div className={styles['toolbar']}>
          <input
            className={styles['search']}
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          <Button variant="ghost" size="sm" disabled={visible.length === 0} onClick={toggleVisible}>
            {t(allVisiblePicked ? 'deselectAll' : 'selectAll')}
          </Button>
        </div>
        {visible.length === 0
          ? <p className={styles['noMatches']} role="status">{t('noMatches')}</p>
          : (
            <ul className={styles['list']}>
              {visible.map(model => (
                <li key={model.id} className={styles['item']}>
                  <label className={styles['label']}>
                    <input
                      type="checkbox"
                      checked={picked.has(model.id)}
                      onChange={() => { toggle(model.id) }}
                    />
                    <span className={styles['id']}>{model.id}</span>
                    {model.name === undefined ? null : <span className={styles['name']}>{model.name}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Modal>
    </div>
  )
}
