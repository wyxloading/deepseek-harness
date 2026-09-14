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
export const zh = {
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
} satisfies Record<keyof typeof en, string>

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  fetch: 'モデルを取得',
  fetching: '取得中…',
  fetchHint: 'このルートに設定されたエンドポイントが提供するモデルを問い合わせます',
  dialogTitle: 'このエンドポイントのモデル',
  dialogDescription: 'このルートで設定するモデルを選択します。調整済みの行は名前と容量を保持します。',
  search: 'モデルを検索',
  selectAll: 'すべて選択',
  deselectAll: 'すべて解除',
  noMatches: '検索に一致するモデルはありません。',
  cancel: 'キャンセル',
  close: '閉じる',
  update: '設定を更新',
  updating: '更新中…',
  updated: 'モデル一覧を更新しました。',
  emptyResult: 'エンドポイントはモデルを返しませんでした。',
  readOnly: 'このデプロイは設定の書き込みを受け付けません。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  fetch: 'Obtener modelos',
  fetching: 'Obteniendo…',
  fetchHint: 'Pregunta al endpoint configurado de esta ruta qué modelos sirve',
  dialogTitle: 'Modelos de este endpoint',
  dialogDescription: 'Elige los modelos que debe configurar esta ruta. Las filas ya ajustadas conservan sus nombres y capacidades.',
  search: 'Buscar modelos',
  selectAll: 'Seleccionar todo',
  deselectAll: 'Deseleccionar todo',
  noMatches: 'Ningún modelo coincide con esta búsqueda.',
  cancel: 'Cancelar',
  close: 'Cerrar',
  update: 'Actualizar configuración',
  updating: 'Actualizando…',
  updated: 'Lista de modelos actualizada.',
  emptyResult: 'El endpoint no enumeró ningún modelo.',
  readOnly: 'Este despliegue no acepta escrituras de configuración.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  fetch: 'Récupérer les modèles',
  fetching: 'Récupération…',
  fetchHint: 'Demande à l’endpoint configuré de cette route quels modèles il sert',
  dialogTitle: 'Modèles de cet endpoint',
  dialogDescription: 'Choisissez les modèles que cette route doit configurer. Les lignes déjà ajustées conservent leurs noms et capacités.',
  search: 'Rechercher des modèles',
  selectAll: 'Tout sélectionner',
  deselectAll: 'Tout désélectionner',
  noMatches: 'Aucun modèle ne correspond à cette recherche.',
  cancel: 'Annuler',
  close: 'Fermer',
  update: 'Mettre à jour la configuration',
  updating: 'Mise à jour…',
  updated: 'Liste des modèles mise à jour.',
  emptyResult: 'L’endpoint n’a listé aucun modèle.',
  readOnly: 'Ce déploiement n’accepte pas les écritures de configuration.',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  fetch: 'Modelle abrufen',
  fetching: 'Wird abgerufen…',
  fetchHint: 'Fragt den konfigurierten Endpunkt dieser Route, welche Modelle er anbietet',
  dialogTitle: 'Modelle an diesem Endpunkt',
  dialogDescription: 'Wählen Sie die Modelle, die diese Route konfigurieren soll. Bereits angepasste Zeilen behalten Namen und Kapazitäten.',
  search: 'Modelle suchen',
  selectAll: 'Alle auswählen',
  deselectAll: 'Auswahl aufheben',
  noMatches: 'Keine Modelle passen zu dieser Suche.',
  cancel: 'Abbrechen',
  close: 'Schließen',
  update: 'Konfiguration aktualisieren',
  updating: 'Wird aktualisiert…',
  updated: 'Modellliste aktualisiert.',
  emptyResult: 'Der Endpunkt hat keine Modelle aufgelistet.',
  readOnly: 'Diese Bereitstellung akzeptiert keine Konfigurationsschreibvorgänge.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  fetch: 'Получить модели',
  fetching: 'Получение…',
  fetchHint: 'Спросить настроенную конечную точку этого маршрута, какие модели она обслуживает',
  dialogTitle: 'Модели на этой конечной точке',
  dialogDescription: 'Выберите модели, которые должен настроить этот маршрут. Уже настроенные строки сохраняют имена и ёмкости.',
  search: 'Поиск моделей',
  selectAll: 'Выбрать все',
  deselectAll: 'Снять выбор',
  noMatches: 'Ни одна модель не соответствует запросу.',
  cancel: 'Отмена',
  close: 'Закрыть',
  update: 'Обновить конфигурацию',
  updating: 'Обновление…',
  updated: 'Список моделей обновлён.',
  emptyResult: 'Конечная точка не вернула ни одной модели.',
  readOnly: 'Это развертывание не принимает записи конфигурации.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  fetch: 'Obter modelos',
  fetching: 'Obtendo…',
  fetchHint: 'Pergunta ao endpoint configurado desta rota quais modelos ele serve',
  dialogTitle: 'Modelos deste endpoint',
  dialogDescription: 'Escolha os modelos que esta rota deve configurar. Linhas já ajustadas mantêm seus nomes e capacidades.',
  search: 'Pesquisar modelos',
  selectAll: 'Selecionar tudo',
  deselectAll: 'Desmarcar tudo',
  noMatches: 'Nenhum modelo corresponde a esta pesquisa.',
  cancel: 'Cancelar',
  close: 'Fechar',
  update: 'Atualizar configuração',
  updating: 'Atualizando…',
  updated: 'Lista de modelos atualizada.',
  emptyResult: 'O endpoint não listou nenhum modelo.',
  readOnly: 'Esta implantação não aceita gravações de configuração.',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The endpoint refresh card's copy. */
    'settings.modelsRefresh': ModelsRefreshKey
  }
}
