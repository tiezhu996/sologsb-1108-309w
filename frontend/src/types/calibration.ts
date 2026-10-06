/** 校准依据：双试片自动发布，还是冲突时人工选定一条，或旧数据按手工校准补齐 */
export type CalibrationMode = 'dual' | 'manual-pick' | 'manual'

/** 待冲建议状态：有效 / 待确认（工作液报废、胶片换批或尚无校准版本） */
export type SuggestionStatus = 'active' | 'pending'

/** 待确认原因，用于界面提示 */
export type PendingReason =
  | 'developer-scrapped'
  | 'film-batch-changed'
  | 'awaiting-readings'
  | null

/** 单条实冲试片读数的不可变快照 */
export interface CalibrationReading {
  runId: number
  runDate: string
  batchNo: string
  actualTempC: number
  actualMinutes: number
  stripDensity: number
}

export interface CalibrationVersion {
  id?: number
  recipeId: number
  /** 该配方第几个发布版本，从 1 开始，发布后不可变 */
  versionNo: number
  mode: CalibrationMode
  publishedAt: string
  /** 发布时依据的读数；manual 模式（旧数据补齐）为空 */
  readings: CalibrationReading[]
  /** 两条读数密度差，manual 模式为 null */
  densitySpread: number | null
  /** 发布时锁定的锚点密度（一致取平均；冲突人工选定取该条；手工校准取目标密度） */
  anchorDensity: number
  /** 发布时乳剂批次快照，保证“当时依据”不随后续换批改变 */
  filmSnapshot: {
    filmId: number
    model: string
    format: string
    emulsionNo: string
  }
  /** 发布时显影液工作液快照 */
  developerSnapshot: {
    developerId: number
    name: string
    dilution: string
    state: string
  }
  /** 发布时配方参数快照 */
  recipeSnapshot: {
    tempC: number
    devMinutes: number
    dilution: string
    pushPull: string
  }
  /** 由锚点密度推得的下一批建议显影分钟（基准温度下） */
  suggestedDevMinutes: number
  schemaRev?: number
}

export interface PendingSuggestion {
  id?: number
  recipeId: number
  status: SuggestionStatus
  pendingReason: PendingReason
  /** 版本发布后重算所依据的校准版本；无校准版本（待读数）时为 null */
  basedOnCalibrationId: number | null
  /** 建议基准温度与分钟，发布新版本会立即重算 */
  baseTempC: number
  baseDevMinutes: number
  /** 重算时间，即所依据校准版本的发布时间 */
  calculatedAt: string
  schemaRev?: number
}
