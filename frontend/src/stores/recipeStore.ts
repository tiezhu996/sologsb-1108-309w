import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import { calculateCompensatedMinutes } from '../hooks/useTempCompensate'
import type { DevRecipe } from '../types/dev-recipe'
import type { Dilution } from '../types/developer'
import type { PushPull } from '../types/dev-recipe'
import type { PendingSuggestion } from '../types/calibration'
import { useCalibrationStore } from './calibrationStore'

type NewRecipe = Omit<DevRecipe, 'id' | 'schemaRev'>

export const useRecipeStore = defineStore('recipe', {
  state: () => ({
    recipes: [] as DevRecipe[],
    loading: false,
    filterFilmId: 'all' as number | 'all',
    filterDilution: 'all' as Dilution | 'all',
    filterPushPull: 'all' as PushPull | 'all',
    targetTempC: 20
  }),
  getters: {
    filteredRecipes: (state) => state.recipes.filter((recipe) => {
      const matchesFilm = state.filterFilmId === 'all' || recipe.filmId === state.filterFilmId
      const matchesDilution = state.filterDilution === 'all' || recipe.dilution === state.filterDilution
      const matchesPushPull = state.filterPushPull === 'all' || recipe.pushPull === state.filterPushPull
      return matchesFilm && matchesDilution && matchesPushPull
    }),
    compensatedRecipes(): Array<DevRecipe & { compensatedMinutes: number }> {
      return this.filteredRecipes.map((recipe) => ({
        ...recipe,
        compensatedMinutes: calculateCompensatedMinutes(recipe.devMinutes, this.targetTempC, recipe.tempC)
      }))
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.recipes = await db.recipes.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    /** 新配方尚无实冲读数：同时建立待确认建议，等两条一致试片发布首版校准 */
    async addRecipe(payload: NewRecipe): Promise<number> {
      const calibrationStore = useCalibrationStore()
      const id = await db.transaction('rw', [db.recipes, db.suggestions], async () => {
        const next = { ...payload, schemaRev: 3 }
        const newId = await db.recipes.add(plain(next))
        await db.suggestions.add(plain({
          recipeId: newId,
          status: 'pending',
          pendingReason: 'awaiting-readings',
          basedOnCalibrationId: null,
          baseTempC: payload.tempC,
          baseDevMinutes: payload.devMinutes,
          calculatedAt: new Date().toISOString(),
          schemaRev: 3
        } satisfies PendingSuggestion))
        return newId
      })
      await Promise.all([this.load(), calibrationStore.load()])
      return id
    },
    async updateNote(id: number, note: string): Promise<void> {
      await db.recipes.update(id, plain({ note }))
      await this.load()
    }
  }
})
