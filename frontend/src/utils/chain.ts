import { db, plain, SCHEMA_REV } from './db'
import {
  averageDensity,
  buildDedupeKey,
  comboKeyOf,
  evaluatePair,
  parseComboKey,
  suggestMinutesFromDensity
} from './calibration'
import type { CalibrationResolution, ComboSuggestion, RevertReason } from '../types/calibration'
import type { DevRun } from '../types/dev-run'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 保存实冲前快照当前待冲建议，作为该记录永久的当时依据 */
export async function basisLabelForRecipe(recipeId: number): Promise<string> {
  const recipe = await db.recipes.get(recipeId)
  if (!recipe || recipe.id === undefined) return '待确认（暂无校准版本）'
  const comboKey = comboKeyOf(recipe.filmId, recipe.developerId, recipe.id)
  const suggestion = await db.suggestions.where('comboKey').equals(comboKey).first()
  if (suggestion?.state === '生效' && suggestion.versionId !== null && suggestion.minutes !== null) {
    const version = await db.calibrations.get(suggestion.versionId)
    if (version) return `校准 v${version.version} · 建议 ${suggestion.minutes.toFixed(2)} 分钟`
  }
  if (suggestion?.revertReason) return `待确认（${suggestion.revertReason}）`
  return '待确认（暂无校准版本）'
}

async function upsertSuggestion(next: Omit<ComboSuggestion, 'id' | 'schemaRev'>): Promise<void> {
  const existing = await db.suggestions.where('comboKey').equals(next.comboKey).first()
  if (existing?.id !== undefined) {
    await db.suggestions.update(existing.id, plain({ ...next }))
  } else {
    await db.suggestions.add(plain({ ...next, schemaRev: SCHEMA_REV }))
  }
}

export interface PublishInput {
  comboKey: string
  readings: number[]
  runIds: number[]
  resolution: CalibrationResolution
}

/**
 * 发布校准版本并立即重算待冲建议。
 * 重复提交命中 dedupeKey 时直接返回已有版本，不会多出版本。
 */
export async function publishCalibrationVersion(input: PublishInput): Promise<number> {
  const dedupeKey = buildDedupeKey(input)
  const existing = await db.calibrations.where('dedupeKey').equals(dedupeKey).first()
  if (existing?.id !== undefined) return existing.id
  const { filmId, developerId, recipeId } = parseComboKey(input.comboKey)
  const recipe = await db.recipes.get(recipeId)
  if (!recipe) throw new Error('组合对应的配方不存在，无法发布校准版本')
  const calibratedDensity = averageDensity(input.readings)
  const suggestedMinutes = suggestMinutesFromDensity(recipe.devMinutes, calibratedDensity)
  const siblings = await db.calibrations.where('comboKey').equals(input.comboKey).toArray()
  const version = siblings.reduce((max, item) => Math.max(max, item.version), 0) + 1
  const id = await db.calibrations.add(plain({
    comboKey: input.comboKey,
    filmId,
    developerId,
    recipeId,
    version,
    readings: [...input.readings],
    calibratedDensity,
    suggestedMinutes,
    sourceRunIds: [...input.runIds],
    resolution: input.resolution,
    dedupeKey,
    createdAt: today(),
    schemaRev: SCHEMA_REV
  }))
  // 版本发布即让旧待冲建议失效，同事务内重算替换
  await upsertSuggestion({
    comboKey: input.comboKey,
    filmId,
    developerId,
    recipeId,
    state: '生效',
    minutes: suggestedMinutes,
    versionId: id,
    revertReason: '',
    updatedAt: today()
  })
  for (const runId of input.runIds) {
    await db.runs.update(runId, plain({ calibrationState: '已入版' }))
  }
  return id
}

/**
 * 新实冲读数进入校准链：取该组合最近两条待配对读数，
 * 一致则自动发布版本，不一致则保留为冲突等待人工选定。
 */
export async function advanceCalibrationChain(runId: number): Promise<void> {
  const run = await db.runs.get(runId)
  if (!run || run.id === undefined) return
  if (run.densitySource !== '实测' || run.calibrationState !== '待配对') return
  const pending = (await db.runs.toArray())
    .filter((item) => (
      item.id !== undefined
      && item.comboKey === run.comboKey
      && item.densitySource === '实测'
      && item.calibrationState === '待配对'
    ))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  if (pending.length < 2) return
  const [first, second] = pending.slice(-2)
  const readings = [first.testDensity, second.testDensity]
  const runIds = [first.id as number, second.id as number]
  if (evaluatePair(readings[0], readings[1]) === 'publish') {
    await publishCalibrationVersion({ comboKey: run.comboKey, readings, runIds, resolution: '自动' })
    return
  }
  const openConflicts = await db.conflicts.where('state').equals('待选定').toArray()
  const duplicated = openConflicts.some((item) => (
    item.comboKey === run.comboKey
    && [...item.runIds].sort((a, b) => a - b).join('+') === [...runIds].sort((a, b) => a - b).join('+')
  ))
  if (duplicated) return
  await db.conflicts.add(plain({
    comboKey: run.comboKey,
    runIds,
    readings,
    state: '待选定',
    schemaRev: SCHEMA_REV
  }))
  await db.runs.update(runIds[0], plain({ calibrationState: '冲突待选' }))
  await db.runs.update(runIds[1], plain({ calibrationState: '冲突待选' }))
}

/** 人工选定冲突读数：以选定读数发布版本，另一条结清保留，绝不取平均 */
export async function resolveDensityConflict(conflictId: number, chosenRunId: number): Promise<void> {
  const conflict = await db.conflicts.get(conflictId)
  if (!conflict || conflict.state !== '待选定') return
  const index = conflict.runIds.indexOf(chosenRunId)
  if (index < 0) throw new Error('所选读数不属于该冲突')
  const rejectedRunId = conflict.runIds[1 - index]
  await publishCalibrationVersion({
    comboKey: conflict.comboKey,
    readings: [conflict.readings[index]],
    runIds: [chosenRunId],
    resolution: '人工选定'
  })
  await db.runs.update(rejectedRunId, plain({ calibrationState: '已结清' }))
  await db.conflicts.update(conflictId, plain({ state: '已解决', resolvedByRunId: chosenRunId }))
}

/** 工作液报废或胶片换批：相关组合的待冲建议先退回待确认，版本历史保留 */
export async function revertSuggestionsToPending(
  filter: { developerId?: number; filmId?: number },
  reason: Exclude<RevertReason, ''>
): Promise<void> {
  const targets = (await db.suggestions.toArray()).filter((item) => (
    item.state === '生效'
    && (filter.developerId === undefined || item.developerId === filter.developerId)
    && (filter.filmId === undefined || item.filmId === filter.filmId)
  ))
  for (const item of targets) {
    if (item.id === undefined) continue
    await db.suggestions.update(item.id, plain({
      state: '待确认',
      minutes: null,
      versionId: null,
      revertReason: reason,
      updatedAt: today()
    }))
  }
}

export function comboPendingRuns(runs: DevRun[], comboKey: string): DevRun[] {
  return runs
    .filter((run) => run.comboKey === comboKey && (run.calibrationState === '待配对' || run.calibrationState === '冲突待选'))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}
