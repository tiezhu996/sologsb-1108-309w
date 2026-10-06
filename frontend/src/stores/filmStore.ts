import { defineStore } from 'pinia'
import { db, plain } from '../utils/db'
import type { FilmStock } from '../types/film-stock'
import { useCalibrationStore } from './calibrationStore'

type NewFilm = Omit<FilmStock, 'id' | 'schemaRev'>

export const useFilmStore = defineStore('film', {
  state: () => ({
    films: [] as FilmStock[],
    loading: false
  }),
  getters: {
    totalRolls: (state) => state.films.reduce((sum, film) => sum + film.rollsLeft, 0),
    lowStockCount: (state) => state.films.filter((film) => film.rollsLeft <= 2).length
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        this.films = await db.films.orderBy('id').reverse().toArray()
      } finally {
        this.loading = false
      }
    },
    /** 登记新乳剂批次；同型号同画幅出现新批次时，旧批次配方的待冲建议同事务退回待确认 */
    async addFilm(payload: NewFilm): Promise<number> {
      const calibrationStore = useCalibrationStore()
      const id = await db.transaction('rw', [db.films, db.recipes, db.suggestions], async () => {
        const next = { ...payload, schemaRev: 3 }
        const newId = await db.films.add(plain(next))
        await calibrationStore.setbackByFilmBatchChange(payload)
        return newId
      })
      await Promise.all([this.load(), calibrationStore.load()])
      return id
    },
    async changeRolls(id: number, rollsLeft: number): Promise<void> {
      await db.films.update(id, plain({ rollsLeft: Math.max(0, rollsLeft) }))
      await this.load()
    }
  }
})
