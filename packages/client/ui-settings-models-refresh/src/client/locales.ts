/** Copy dictionaries for the Models page's endpoint refresh card. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** English strings (the key-set source of truth for this pair). */
export const en = {
  fetch: 'Fetch models',
  fetching: 'Fetching…',
  fetchHint: 'Ask this route\u2019s configured endpoint which models it serves',
  dialogTitle: 'Models at this endpoint',
  dialogDescription: 'Choose the models this route should configure. Rows you already tuned keep their names and capacities.',
  search: 'Search models',
  selectAll: 'Select all',
  deselectAll: 'Deselect all',
  noMatches: 'No models match this search.',
  cancel: 'Cancel',
  close: 'Close',
  update: 'Update config',
  updating: 'Updating…',
  updated: 'Model list updated.',
  emptyResult: 'The endpoint listed no models.',
  readOnly: 'This deployment does not accept configuration writes.',
}

/** Dictionary key set owned by this plugin. */
export type ModelsRefreshKey = keyof typeof en

/** Chinese strings, complete against the English key set. */
export const zh: { [Key in keyof typeof en]: string } = {
  fetch: '获取模型列表',
  fetching: '获取中…',
  fetchHint: '向该线路配置的端点询问它提供哪些模型',
  dialogTitle: '该端点提供的模型',
  dialogDescription: '选择该线路要配置的模型；已调整过的行保留原有名称与容量。',
  search: '搜索模型',
  selectAll: '全选',
  deselectAll: '取消全选',
  noMatches: '没有匹配的模型。',
  cancel: '取消',
  close: '关闭',
  update: '更新配置',
  updating: '更新中…',
  updated: '模型列表已更新。',
  emptyResult: '该端点没有返回任何模型。',
  readOnly: '当前部署不接受配置写入。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The endpoint refresh card's copy. */
    'settings.modelsRefresh': ModelsRefreshKey
  }
}
