import { defineStore } from 'pinia'
import { db, plain, SCHEMA_REV } from '../utils/db'
import { comboKeyOf } from '../utils/calibration'
import { advanceCalibrationChain, basisLabelForRecipe } from '../utils/chain'
import type { DevRun } from '../types/dev-run'

type NewRun = Omit<DevRun, 'id' | 'schemaRev' | 'comboKey' | 'basisLabel' | 'densitySource' | 'calibrationState'>

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: [] as DevRun[],
    loading: false
  }),
  getters: {
    recentRuns: (state) => [...state.runs]
      .sort((a, b) => b.runDate.localeCompare(a.runDate))
      .slice(0, 6)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.runs = await db.runs.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    async addRun(payload: NewRun): Promise<number> {
      try {
        // 单事务写入：记录、显影液用量、校准链推进，任一失败整体回滚
        const id = await db.transaction(
          'rw',
          [db.runs, db.recipes, db.developers, db.calibrations, db.suggestions, db.conflicts],
          async () => {
            const duplicated = await db.runs.filter((item) => item.batchNo === payload.batchNo).first()
            if (duplicated) throw new Error(`批次号 ${payload.batchNo} 已存在，重复提交已拦截`)
            const recipe = await db.recipes.get(payload.recipeId)
            if (!recipe || recipe.id === undefined) throw new Error('所选配方不存在，无法保存冲洗记录')
            const next: DevRun = {
              ...payload,
              comboKey: comboKeyOf(recipe.filmId, recipe.developerId, recipe.id),
              basisLabel: await basisLabelForRecipe(payload.recipeId),
              densitySource: '实测',
              calibrationState: '待配对',
              schemaRev: SCHEMA_REV
            }
            const runId = await db.runs.add(plain(next))
            const developer = await db.developers.get(recipe.developerId)
            if (developer && developer.id !== undefined && developer.state !== '报废') {
              await db.developers.update(developer.id, plain({ usedRolls: developer.usedRolls + 1 }))
            }
            await advanceCalibrationChain(runId)
            return runId
          }
        )
        await this.load()
        return id
      } catch (error) {
        // 写入失败后从数据库恢复原状态
        await this.load()
        throw error
      }
    },
    async writeBackNote(runId: number, recipeId: number): Promise<void> {
      const run = await db.runs.get(runId)
      if (!run) return
      const note = `${run.runDate} 实冲 ${run.actualTempC}°C / ${run.actualMinutes} 分钟：${run.result}`
      await db.recipes.update(recipeId, plain({ note }))
    }
  }
})
