import { defineStore } from 'pinia'
import { db } from '../utils/db'
import { resolveDensityConflict } from '../utils/chain'
import type { CalibrationVersion, ComboSuggestion, DensityConflict } from '../types/calibration'

export const useCalibrationStore = defineStore('calibration', {
  state: () => ({
    versions: [] as CalibrationVersion[],
    suggestions: [] as ComboSuggestion[],
    conflicts: [] as DensityConflict[],
    loading: false
  }),
  getters: {
    suggestionMap: (state) => Object.fromEntries(
      state.suggestions.map((item) => [item.comboKey, item])
    ) as Record<string, ComboSuggestion>,
    openConflicts: (state) => state.conflicts.filter((item) => item.state === '待选定'),
    activeSuggestions: (state) => state.suggestions.filter((item) => item.state === '生效'),
    versionsOf: (state) => (comboKey: string) => state.versions
      .filter((item) => item.comboKey === comboKey)
      .sort((a, b) => b.version - a.version)
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        const [versions, suggestions, conflicts] = await Promise.all([
          db.calibrations.orderBy('id').reverse().toArray(),
          db.suggestions.toArray(),
          db.conflicts.orderBy('id').reverse().toArray()
        ])
        this.versions = versions
        this.suggestions = suggestions
        this.conflicts = conflicts
      } finally {
        this.loading = false
      }
    },
    async resolveConflict(conflictId: number, chosenRunId: number): Promise<void> {
      try {
        await db.transaction(
          'rw',
          [db.conflicts, db.runs, db.calibrations, db.suggestions, db.recipes],
          () => resolveDensityConflict(conflictId, chosenRunId)
        )
      } catch (error) {
        await this.load()
        throw error
      }
      await this.load()
    }
  }
})
