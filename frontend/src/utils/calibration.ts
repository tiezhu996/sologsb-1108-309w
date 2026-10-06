import type { DevRecipe } from '../types/dev-recipe'
import type { CalibrationResolution } from '../types/calibration'

/** 中间调目标密度：校准链把试片密度向该值收敛 */
export const TARGET_DENSITY = 0.65
/** 同一组合两条读数允许的最大差值，超过则视为冲突 */
export const DENSITY_TOLERANCE = 0.15
/** 每偏离目标密度 0.10，显影时间约反向调整 8% */
export const DENSITY_TIME_SLOPE = 0.8

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 组合键：胶片乳剂批次 + 显影液 + 配方，三者共同确定一条校准链 */
export function comboKeyOf(filmId: number, developerId: number, recipeId: number): string {
  return `${filmId}|${developerId}|${recipeId}`
}

export function comboKeyForRecipe(recipe: DevRecipe): string {
  return comboKeyOf(recipe.filmId, recipe.developerId, recipe.id ?? 0)
}

export function parseComboKey(comboKey: string): { filmId: number; developerId: number; recipeId: number } {
  const [filmId = 0, developerId = 0, recipeId = 0] = comboKey.split('|').map(Number)
  return { filmId, developerId, recipeId }
}

/** 两条读数相差不超过容差才能发布校准版本 */
export function evaluatePair(first: number, second: number): 'publish' | 'conflict' {
  return Math.abs(first - second) <= DENSITY_TOLERANCE + 1e-9 ? 'publish' : 'conflict'
}

/** 仅在读数一致（或人工选定单条）时调用，冲突读数绝不进入平均 */
export function averageDensity(readings: number[]): number {
  if (readings.length === 0) return TARGET_DENSITY
  const total = readings.reduce((sum, item) => sum + item, 0)
  return round3(total / readings.length)
}

/** 由校准密度折算下一批基准显影时间：密度偏高则缩短，偏低则延长 */
export function suggestMinutesFromDensity(baseMinutes: number, calibratedDensity: number): number {
  const delta = calibratedDensity - TARGET_DENSITY
  const factor = Math.min(1.6, Math.max(0.5, 1 - delta * DENSITY_TIME_SLOPE))
  return Math.max(0.25, round2(Math.max(0.1, baseMinutes) * factor))
}

export interface DedupeParts {
  comboKey: string
  readings: number[]
  runIds: number[]
  resolution: CalibrationResolution
}

/** 幂等键：同一组合、同一组读数与来源记录的重复提交只会命中已有版本 */
export function buildDedupeKey(parts: DedupeParts): string {
  const runIds = [...parts.runIds].sort((a, b) => a - b).join('+')
  return `${parts.comboKey}|${parts.resolution}|${parts.readings.join('+')}|${runIds}`
}
