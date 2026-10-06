export type CalibrationResolution = '自动' | '人工选定'
export type SuggestionState = '生效' | '待确认'
export type RevertReason = '工作液报废' | '胶片换批' | ''
export type ConflictState = '待选定' | '已解决'

/** 校准版本：同一组合（胶片乳剂批次 + 显影液 + 配方）两条一致读数发布后生效 */
export interface CalibrationVersion {
  id?: number
  comboKey: string
  filmId: number
  developerId: number
  recipeId: number
  version: number
  readings: number[]
  calibratedDensity: number
  suggestedMinutes: number
  sourceRunIds: number[]
  resolution: CalibrationResolution
  dedupeKey: string
  createdAt: string
  schemaRev?: number
}

/** 待冲建议：每个组合一条，版本发布后失效重算，报废或换批时退回待确认 */
export interface ComboSuggestion {
  id?: number
  comboKey: string
  filmId: number
  developerId: number
  recipeId: number
  state: SuggestionState
  minutes: number | null
  versionId: number | null
  revertReason: RevertReason
  updatedAt: string
  schemaRev?: number
}

/** 密度冲突：两条读数相差超过容差时保留双方，等待人工选定 */
export interface DensityConflict {
  id?: number
  comboKey: string
  runIds: number[]
  readings: number[]
  state: ConflictState
  resolvedByRunId?: number
  schemaRev?: number
}
