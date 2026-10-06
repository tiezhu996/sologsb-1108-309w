import { calculateCompensatedMinutes } from '../hooks/useTempCompensate'
import type { CalibrationMode, CalibrationReading, CalibrationVersion } from '../types/calibration'
import type { DevRecipe } from '../types/dev-recipe'
import type { Developer } from '../types/developer'
import type { DevRun } from '../types/dev-run'
import type { FilmStock } from '../types/film-stock'

/** 两条试片读数允许的最大密度差 */
export const DENSITY_TOLERANCE = 0.15
/** 校准目标密度（中间调基准级次） */
export const TARGET_STRIP_DENSITY = 1.0
/** 密度修正系数的安全区间，避免单批读数波动把建议拉偏 */
const MIN_ADJUST_FACTOR = 0.85
const MAX_ADJUST_FACTOR = 1.15
const EPSILON = 1e-9

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 两条读数是否一致：相差不超过 0.15（含端点）才允许自动发布 */
export function isConsistentPair(first: number, second: number): boolean {
  return Math.abs(first - second) <= DENSITY_TOLERANCE + EPSILON
}

/** 锚点密度：一致时取两条读数平均，冲突时由人工选定一条，手工校准取目标密度 */
export function anchorDensityFor(
  mode: CalibrationMode,
  readings: CalibrationReading[],
  pickedRunId?: number
): number {
  if (mode === 'manual') return TARGET_STRIP_DENSITY
  if (mode === 'manual-pick') {
    const picked = readings.find((item) => item.runId === pickedRunId)
      ?? readings[readings.length - 1]
    return round2(picked.stripDensity)
  }
  if (readings.length === 2) {
    return round2((readings[0].stripDensity + readings[1].stripDensity) / 2)
  }
  return round2(readings[readings.length - 1]?.stripDensity ?? TARGET_STRIP_DENSITY)
}

/**
 * 由锚点密度推下一批显影分钟：
 * 试片密度偏高 → 缩短显影；偏低 → 延长显影；以配方基准时间为起点并限制修正幅度。
 */
export function suggestedMinutesFor(anchorDensity: number, baseDevMinutes: number): number {
  const rawFactor = TARGET_STRIP_DENSITY / anchorDensity
  const factor = Math.min(MAX_ADJUST_FACTOR, Math.max(MIN_ADJUST_FACTOR, rawFactor))
  return Math.max(0.25, round2(baseDevMinutes * factor))
}

/** 任意实冲温度下的待冲建议分钟（在基准建议上做温度补偿） */
export function suggestedMinutesAtTemp(baseDevMinutes: number, baseTempC: number, tempC: number): number {
  return calculateCompensatedMinutes(baseDevMinutes, tempC, baseTempC)
}

export function toReading(run: DevRun): CalibrationReading | null {
  if (run.id === undefined || typeof run.stripDensity !== 'number') return null
  return {
    runId: run.id,
    runDate: run.runDate,
    batchNo: run.batchNo,
    actualTempC: run.actualTempC,
    actualMinutes: run.actualMinutes,
    stripDensity: run.stripDensity
  }
}

interface BuildVersionInput {
  recipeId: number
  versionNo: number
  mode: CalibrationMode
  readings: CalibrationReading[]
  pickedRunId?: number
  publishedAt: string
  recipe: DevRecipe
  film: FilmStock
  developer: Developer
}

/** 组装一条不可变校准版本（含当时配方 / 乳剂 / 工作液快照与建议参数） */
export function buildCalibrationVersion(input: BuildVersionInput): CalibrationVersion {
  const { recipe, film, developer } = input
  const anchorDensity = anchorDensityFor(input.mode, input.readings, input.pickedRunId)
  const densitySpread = input.mode === 'manual' || input.readings.length < 2
    ? null
    : round2(Math.abs(input.readings[0].stripDensity - input.readings[1].stripDensity))
  return {
    recipeId: input.recipeId,
    versionNo: input.versionNo,
    mode: input.mode,
    publishedAt: input.publishedAt,
    readings: input.readings,
    densitySpread,
    anchorDensity,
    filmSnapshot: {
      filmId: film.id ?? 0,
      model: film.model,
      format: film.format,
      emulsionNo: film.emulsionNo
    },
    developerSnapshot: {
      developerId: developer.id ?? 0,
      name: developer.name,
      dilution: developer.dilution,
      state: developer.state
    },
    recipeSnapshot: {
      tempC: recipe.tempC,
      devMinutes: recipe.devMinutes,
      dilution: recipe.dilution,
      pushPull: recipe.pushPull
    },
    suggestedDevMinutes: suggestedMinutesFor(anchorDensity, recipe.devMinutes),
    schemaRev: 3
  }
}

export const MODE_LABELS: Record<CalibrationMode, string> = {
  dual: '双试片一致',
  'manual-pick': '冲突人工选定',
  manual: '手工校准'
}
