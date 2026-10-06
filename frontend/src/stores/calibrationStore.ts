import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import {
  buildCalibrationVersion,
  isConsistentPair,
  toReading
} from '../utils/calibration'
import type {
  CalibrationMode,
  CalibrationReading,
  CalibrationVersion,
  PendingReason,
  PendingSuggestion
} from '../types/calibration'
import type { DevRun } from '../types/dev-run'

export class CalibrationError extends Error {}

interface ReleaseOptions {
  recipeId: number
  /** 冲突时人工选定的实冲记录 id；双试片一致自动发布时不传 */
  pickedRunId?: number
  /** 防止重复提交的客户端幂等键：版本号 + 依据读数 id 排序拼接 */
  releaseKey?: string
}

interface ReleaseResult {
  calibration: CalibrationVersion
  suggestion: PendingSuggestion
  mode: CalibrationMode
}

/** 计算某配方已被发布版本消费过的实冲 id 集合（旧手工版本不消费实冲） */
async function consumedRunIds(recipeId: number): Promise<Set<number>> {
  const versions = await db.calibrations.where('recipeId').equals(recipeId).toArray()
  const ids = new Set<number>()
  for (const version of versions) {
    for (const reading of version.readings) ids.add(reading.runId)
  }
  return ids
}

/** 尚未参与校准发布、且登记了试片密度的读数（按时间 / id 升序） */
async function candidateReadings(recipeId: number): Promise<{ runs: DevRun[]; readings: CalibrationReading[] }> {
  const consumed = await consumedRunIds(recipeId)
  const runs = (await db.runs.where('recipeId').equals(recipeId).toArray())
    .filter((run) => run.id !== undefined && !consumed.has(run.id) && typeof run.stripDensity === 'number')
    .sort((a, b) => (a.runDate === b.runDate ? (a.id ?? 0) - (b.id ?? 0) : a.runDate.localeCompare(b.runDate)))
  return { runs, readings: runs.map((run) => toReading(run)).filter((item): item is CalibrationReading => item !== null) }
}

function reasonPriority(reason: PendingReason): number {
  if (reason === 'developer-scrapped') return 3
  if (reason === 'film-batch-changed') return 2
  if (reason === 'awaiting-readings') return 1
  return 0
}

export const useCalibrationStore = defineStore('calibration', {
  state: () => ({
    calibrations: [] as CalibrationVersion[],
    suggestions: [] as PendingSuggestion[],
    loading: false
  }),
  getters: {
    suggestionByRecipe: (state) => (recipeId: number): PendingSuggestion | undefined =>
      state.suggestions.find((item) => item.recipeId === recipeId),
    latestCalibrationByRecipe: (state) => (recipeId: number): CalibrationVersion | undefined =>
      state.calibrations
        .filter((item) => item.recipeId === recipeId)
        .sort((a, b) => b.versionNo - a.versionNo)[0],
    activeSuggestions(state): PendingSuggestion[] {
      return state.suggestions.filter((item) => item.status === 'active')
    },
    pendingSuggestions(state): PendingSuggestion[] {
      return state.suggestions.filter((item) => item.status === 'pending')
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        const [calibrations, suggestions] = await Promise.all([
          db.calibrations.orderBy('id').toArray(),
          db.suggestions.toArray()
        ])
        this.calibrations = calibrations
        this.suggestions = suggestions
      } finally {
        this.loading = false
      }
    },

    /** 读取当前待配对的未消费读数（供界面提示一致 / 冲突） */
    async candidateReadingsFor(recipeId: number) {
      return candidateReadings(recipeId)
    },

    /**
     * 发布校准版本（全程单事务，写入失败回滚，不留半成品）：
     * - 两条读数相差 ≤ 0.15：按一致自动发布
     * - 相差 > 0.15：必须由人工选定一条，禁止自动平均
     * - 重复提交（同一版本依据同一组读数）不再多出版本
     */
    async releaseCalibration(options: ReleaseOptions): Promise<ReleaseResult> {
      const { recipeId, pickedRunId } = options
      return db.transaction('rw', [db.calibrations, db.suggestions, db.recipes, db.films, db.developers, db.runs], async () => {
        const recipe = await db.recipes.get(recipeId)
        if (!recipe) throw new CalibrationError('配方不存在')
        const film = await db.films.get(recipe.filmId)
        const developer = await db.developers.get(recipe.developerId)
        if (!film || !developer) throw new CalibrationError('校准链不完整：胶片批次或显影液缺失')

        const { readings } = await candidateReadings(recipeId)
        const pair = readings.slice(0, 2)

        // 幂等优先：并发重复提交时，后到的事务在此看到已提交版本（候选已为空），直接返回
        const released = await db.calibrations.where('recipeId').equals(recipeId).toArray()

        if (pair.length < 2) {
          const latest = released.sort((a, b) => b.versionNo - a.versionNo)[0]
          if (latest) {
            const suggestion = (await db.suggestions.where('recipeId').equals(recipeId).first()) as PendingSuggestion
            return { calibration: latest, suggestion, mode: latest.mode }
          }
          throw new CalibrationError('需要两条登记了试片密度的实冲读数才能发布')
        }

        const spread = Math.abs(pair[0].stripDensity - pair[1].stripDensity)
        const consistent = isConsistentPair(pair[0].stripDensity, pair[1].stripDensity)

        let mode: CalibrationMode
        let selectedReadings: CalibrationReading[]
        if (consistent) {
          mode = 'dual'
          selectedReadings = pair
        } else {
          if (pickedRunId === undefined) {
            throw new CalibrationError('两条读数相差超过 0.15，已保留冲突，请人工选定一条后发布')
          }
          const picked = pair.find((item) => item.runId === pickedRunId)
          if (!picked) throw new CalibrationError('人工选定的读数不在当前冲突对中')
          mode = 'manual-pick'
          selectedReadings = pair.filter((item) => item.runId === pickedRunId)
        }

        // 同模式、同依据读数已经发布过则直接返回，不产生新版本
        const duplicate = released.find((version) => {
          if (version.mode !== mode) return false
          const ids = version.readings.map((item) => item.runId).sort((a, b) => a - b).join(',')
          const want = selectedReadings.map((item) => item.runId).sort((a, b) => a - b).join(',')
          return ids === want
        })
        if (duplicate) {
          const suggestion = (await db.suggestions.where('recipeId').equals(recipeId).first()) as PendingSuggestion
          return { calibration: duplicate, suggestion, mode }
        }

        const versionNo = released.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1
        const publishedAt = new Date().toISOString()
        const version = buildCalibrationVersion({
          recipeId,
          versionNo,
          mode,
          readings: selectedReadings,
          pickedRunId,
          publishedAt,
          recipe,
          film,
          developer
        })
        const calibrationId = await db.calibrations.add(plain(version))
        const storedVersion = { ...version, id: calibrationId }

        // 版本发布后，待冲建议立即失效并重算（已完成实冲与旧版本快照保持不变）
        const existing = await db.suggestions.where('recipeId').equals(recipeId).first()
        const nextSuggestion: PendingSuggestion = {
          recipeId,
          status: 'active',
          pendingReason: null,
          basedOnCalibrationId: calibrationId,
          baseTempC: recipe.tempC,
          baseDevMinutes: version.suggestedDevMinutes,
          calculatedAt: publishedAt,
          schemaRev: 3
        }
        let storedSuggestion: PendingSuggestion
        if (existing) {
          await db.suggestions.update(existing.id as number, plain(nextSuggestion))
          storedSuggestion = { ...nextSuggestion, id: existing.id }
        } else {
          const suggestionId = await db.suggestions.add(plain(nextSuggestion))
          storedSuggestion = { ...nextSuggestion, id: suggestionId }
        }

        return { calibration: storedVersion, suggestion: storedSuggestion, mode }
      })
    },

    /**
     * 工作液报废：引用该工作液的待冲建议先退回待确认。
     * 在报废事务内调用（Dexie 嵌套事务复用当前事务），保证与报废写入同生共死。
     */
    async setbackByDeveloperScrap(developerId: number): Promise<void> {
      const recipes = await db.recipes.where('developerId').equals(developerId).toArray()
      for (const recipe of recipes) {
        const suggestion = await db.suggestions.where('recipeId').equals(recipe.id as number).first()
        if (!suggestion) continue
        if (reasonPriority(suggestion.pendingReason) < reasonPriority('developer-scrapped')) {
          await db.suggestions.update(suggestion.id as number, plain({
            status: 'pending',
            pendingReason: 'developer-scrapped'
          } satisfies Partial<PendingSuggestion>))
        }
      }
    },

    /** 胶片换批（同型号同画幅登记新乳剂批次）：旧批次配方的待冲建议退回待确认 */
    async setbackByFilmBatchChange(film: { model: string; format: string; emulsionNo: string }): Promise<void> {
      const sameKind = await db.films.where('model').equals(film.model).toArray()
      const siblingBatches = sameKind.filter((item) => item.format === film.format)
      if (siblingBatches.length <= 1) return
      const oldBatchIds = siblingBatches
        .filter((item) => item.emulsionNo !== film.emulsionNo)
        .map((item) => item.id as number)
      if (oldBatchIds.length === 0) return
      const recipes = await db.recipes.where('filmId').anyOf(oldBatchIds).toArray()
      for (const recipe of recipes) {
        const suggestion = await db.suggestions.where('recipeId').equals(recipe.id as number).first()
        if (!suggestion) continue
        if (reasonPriority(suggestion.pendingReason) < reasonPriority('film-batch-changed')) {
          await db.suggestions.update(suggestion.id as number, plain({
            status: 'pending',
            pendingReason: 'film-batch-changed'
          } satisfies Partial<PendingSuggestion>))
        }
      }
    },

    /** 人工确认待冲建议仍可沿用（换批 / 报废后复核完成） */
    async confirmSuggestion(recipeId: number): Promise<void> {
      const suggestion = await db.suggestions.where('recipeId').equals(recipeId).first()
      if (!suggestion || suggestion.status !== 'pending') return
      await db.transaction('rw', [db.suggestions, db.recipes, db.calibrations], async () => {
        const latest = await db.calibrations.where('recipeId').equals(recipeId)
          .reverse().sortBy('versionNo')
        const version = latest[0]
        await db.suggestions.update(suggestion.id as number, plain({
          status: 'active',
          pendingReason: null,
          basedOnCalibrationId: version?.id ?? suggestion.basedOnCalibrationId,
          calculatedAt: new Date().toISOString()
        } satisfies Partial<PendingSuggestion>))
      })
    }
  }
})
