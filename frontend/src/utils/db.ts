import Dexie, { type Table } from 'dexie'
import type { FilmStock } from '../types/film-stock'
import type { Developer } from '../types/developer'
import type { DevRecipe } from '../types/dev-recipe'
import type { DevRun } from '../types/dev-run'
import type { CalibrationVersion, PendingSuggestion } from '../types/calibration'
import { buildCalibrationVersion } from './calibration'

export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const filmSeeds: FilmStock[] = [
  { id: 1, model: 'GP3', format: '135', boxIso: 100, realIso: 100, emulsionNo: 'GP3-2504-A17', expireDate: '2027-08-01', rollsLeft: 12, schemaRev: 3 },
  { id: 2, model: 'HP5', format: '135', boxIso: 400, realIso: 640, emulsionNo: 'HP5-2509-B31', expireDate: '2026-11-30', rollsLeft: 3, schemaRev: 3 },
  { id: 3, model: 'Portra', format: '120', boxIso: 400, realIso: 320, emulsionNo: 'PC400-147-02', expireDate: '2027-03-18', rollsLeft: 5, schemaRev: 3 },
  { id: 4, model: 'GP3', format: '120', boxIso: 100, realIso: 100, emulsionNo: 'GP3-2404-C08', expireDate: '2026-10-12', rollsLeft: 2, schemaRev: 3 },
  { id: 5, model: 'HP5', format: '4×5', boxIso: 400, realIso: 400, emulsionNo: 'HP5-45-24C', expireDate: '2027-01-20', rollsLeft: 8, schemaRev: 3 },
  { id: 6, model: 'Portra', format: '135', boxIso: 400, realIso: 400, emulsionNo: 'PC400-132-01', expireDate: '2025-12-31', rollsLeft: 0, schemaRev: 3 },
  { id: 7, model: 'Portra', format: '120', boxIso: 400, realIso: 320, emulsionNo: 'PC400-147-05', expireDate: '2028-02-28', rollsLeft: 8, schemaRev: 3 }
]

const developerSeeds: Developer[] = [
  { id: 1, name: '柯达 D-76 工作液 A', category: 'D-76', dilution: '1:1', volumeMl: 1000, mixedAt: '2026-09-12', maxRolls: 12, usedRolls: 4, state: '在用', schemaRev: 3 },
  { id: 2, name: '伊尔福 HC-110 稀释液', category: 'HC-110', dilution: '1:3', volumeMl: 1000, mixedAt: '2026-09-16', maxRolls: 16, usedRolls: 8, state: '在用', schemaRev: 3 },
  { id: 3, name: '罗迪纳尔 高稀释工作液', category: 'Rodinal', dilution: '1:3', volumeMl: 500, mixedAt: '2026-08-28', maxRolls: 10, usedRolls: 10, state: '报废', schemaRev: 3 },
  { id: 4, name: '柯达 C-41 彩色套药', category: 'C-41', dilution: '1:3', volumeMl: 1000, mixedAt: '2026-09-20', maxRolls: 12, usedRolls: 0, state: '新配', schemaRev: 3 },
  { id: 5, name: '旧版 D-76 补充液', category: 'D-76', dilution: '1:1', volumeMl: 750, mixedAt: '2026-05-10', maxRolls: 10, usedRolls: 10, state: '报废', schemaRev: 3 }
]

const recipeSeeds: DevRecipe[] = [
  { id: 1, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 9.5, agitation: '每 30s 摇 5s', stopBath: '酸性停显 1 分钟', fixer: '快速定影 5 分钟', washMinutes: 10, pushPull: 'N', note: '日光下层次稳定', schemaRev: 3 },
  { id: 2, filmId: 2, developerId: 2, dilution: '1:3', tempC: 20, devMinutes: 7.5, agitation: '前 30s 连续，其后每 30s 摇 5s', stopBath: '停显 1 分钟', fixer: '定影 5 分钟', washMinutes: 10, pushPull: '+1', note: '暗部略薄，注意高光', schemaRev: 3 },
  { id: 3, filmId: 3, developerId: 4, dilution: '1:3', tempC: 38, devMinutes: 3.25, agitation: '每 30s 翻转 5s', stopBath: 'C-41 停显 1 分钟', fixer: '漂定 6.5 分钟', washMinutes: 6, pushPull: 'N', note: '严格维持 38°C', schemaRev: 3 },
  { id: 4, filmId: 4, developerId: 3, dilution: '1:3', tempC: 20, devMinutes: 11, agitation: '第 1 分钟连续，之后每 30s 摇 5s', stopBath: '停显 1 分钟', fixer: '定影 5 分钟', washMinutes: 12, pushPull: 'N', note: '齿孔边缘略高密度', schemaRev: 3 },
  { id: 5, filmId: 5, developerId: 1, dilution: '1:1', tempC: 24, devMinutes: 6.5, agitation: '每 30s 摇 5s', stopBath: '停显 1 分钟', fixer: '定影 5 分钟', washMinutes: 10, pushPull: '-1', note: '大画幅按页片盘显', schemaRev: 3 },
  { id: 6, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 12.5, agitation: '每 30s 摇 5s，后段减少', stopBath: '停显 1 分钟', fixer: '定影 5 分钟', washMinutes: 10, pushPull: '+2', note: '阴天场景可尝试', schemaRev: 3 },
  { id: 7, filmId: 2, developerId: 3, dilution: '1:3', tempC: 20, devMinutes: 13, agitation: '每 30s 摇 5s', stopBath: '停显 1 分钟', fixer: '定影 5 分钟', washMinutes: 12, pushPull: '+1', note: '颗粒明显，反差充足', schemaRev: 3 }
]

const runSeeds: DevRun[] = [
  { id: 1, batchNo: 'R-260918-01', recipeId: 1, actualTempC: 20.2, actualMinutes: 9.4, tankType: '双联罐', runDate: '2026-09-18', result: '密度均匀，中间调细腻', stripDensity: 1.04, schemaRev: 3 },
  { id: 2, batchNo: 'R-260920-02', recipeId: 2, actualTempC: 20.5, actualMinutes: 7.2, tankType: '双联罐', runDate: '2026-09-20', result: '暗部略薄，高光可控', stripDensity: 0.9, schemaRev: 3 },
  { id: 3, batchNo: 'R-260921-03', recipeId: 3, actualTempC: 38.1, actualMinutes: 3.25, tankType: '深罐', runDate: '2026-09-21', result: '肤色自然，灰雾轻微', stripDensity: 1.04, schemaRev: 3 },
  { id: 4, batchNo: 'R-260922-04', recipeId: 4, actualTempC: 19.8, actualMinutes: 11.2, tankType: '双联罐', runDate: '2026-09-22', result: '反差合适，边缘密度偏高', stripDensity: 1.08, schemaRev: 3 },
  { id: 5, batchNo: 'R-260923-05', recipeId: 5, actualTempC: 24.2, actualMinutes: 6.4, tankType: '深罐', runDate: '2026-09-23', result: '高光保留，暗部通透', stripDensity: 0.97, schemaRev: 3 },
  { id: 6, batchNo: 'R-260924-06', recipeId: 6, actualTempC: 19.5, actualMinutes: 13.2, tankType: '双联罐', runDate: '2026-09-24', result: '反差稍强，颗粒可接受', stripDensity: 1.12, schemaRev: 3 },
  { id: 7, batchNo: 'R-260925-07', recipeId: 7, actualTempC: 20.1, actualMinutes: 12.8, tankType: '双联罐', runDate: '2026-09-25', result: '阴影细节不足，建议延长 0.5 分钟', stripDensity: 0.82, schemaRev: 3 },
  { id: 8, batchNo: 'R-260927-08', recipeId: 1, actualTempC: 20.0, actualMinutes: 9.05, tankType: '双联罐', runDate: '2026-09-27', result: '密度稳定，可定为下批基准', stripDensity: 1.02, schemaRev: 3 },
  { id: 9, batchNo: 'R-260928-09', recipeId: 2, actualTempC: 20.4, actualMinutes: 7.3, tankType: '双联罐', runDate: '2026-09-28', result: '两张试片读数差距大，待复拍确认', stripDensity: 0.7, schemaRev: 3 },
  { id: 10, batchNo: 'R-260929-10', recipeId: 3, actualTempC: 38.0, actualMinutes: 3.2, tankType: '深罐', runDate: '2026-09-29', result: '色彩饱和，密度一致', stripDensity: 1.02, schemaRev: 3 },
  { id: 11, batchNo: 'R-260930-11', recipeId: 6, actualTempC: 19.6, actualMinutes: 12.6, tankType: '双联罐', runDate: '2026-09-30', result: '高光仍厚，继续缩短时间', stripDensity: 1.18, schemaRev: 3 }
]

const findFilm = (id: number): FilmStock => filmSeeds.find((item) => item.id === id) ?? filmSeeds[0]
const findDeveloper = (id: number): Developer => developerSeeds.find((item) => item.id === id) ?? developerSeeds[0]
const findRecipe = (id: number): DevRecipe => recipeSeeds.find((item) => item.id === id) ?? recipeSeeds[0]
const findRun = (id: number): DevRun => runSeeds.find((item) => item.id === id) ?? runSeeds[0]

/** 全新数据库的校准链：配方 1 / 3 / 6 已发布双试片版本，配方 2 留存冲突待人工选定 */
function readingSeed(runId: number) {
  const run = findRun(runId)
  return {
    runId: run.id as number,
    runDate: run.runDate,
    batchNo: run.batchNo,
    actualTempC: run.actualTempC,
    actualMinutes: run.actualMinutes,
    stripDensity: run.stripDensity as number
  }
}

const calibrationSeeds: CalibrationVersion[] = [
  {
    id: 1,
    ...buildCalibrationVersion({
      recipeId: 1,
      versionNo: 1,
      mode: 'dual',
      readings: [1, 8].map(readingSeed),
      publishedAt: '2026-09-27T18:10:00.000Z',
      recipe: findRecipe(1),
      film: findFilm(1),
      developer: findDeveloper(1)
    })
  },
  {
    id: 2,
    ...buildCalibrationVersion({
      recipeId: 3,
      versionNo: 1,
      mode: 'dual',
      readings: [3, 10].map(readingSeed),
      publishedAt: '2026-09-29T18:10:00.000Z',
      recipe: findRecipe(3),
      film: findFilm(3),
      developer: findDeveloper(4)
    })
  },
  {
    id: 3,
    ...buildCalibrationVersion({
      recipeId: 6,
      versionNo: 1,
      mode: 'dual',
      readings: [6, 11].map(readingSeed),
      publishedAt: '2026-09-30T18:10:00.000Z',
      recipe: findRecipe(6),
      film: findFilm(1),
      developer: findDeveloper(1)
    })
  }
]

const suggestionSeeds: PendingSuggestion[] = [
  { id: 1, recipeId: 1, status: 'active', pendingReason: null, basedOnCalibrationId: 1, baseTempC: 20, baseDevMinutes: calibrationSeeds[0].suggestedDevMinutes, calculatedAt: '2026-09-27T18:10:00.000Z', schemaRev: 3 },
  { id: 2, recipeId: 2, status: 'pending', pendingReason: 'awaiting-readings', basedOnCalibrationId: null, baseTempC: 20, baseDevMinutes: 7.5, calculatedAt: '2026-09-28T18:10:00.000Z', schemaRev: 3 },
  { id: 3, recipeId: 3, status: 'pending', pendingReason: 'film-batch-changed', basedOnCalibrationId: 2, baseTempC: 38, baseDevMinutes: calibrationSeeds[1].suggestedDevMinutes, calculatedAt: '2026-09-29T18:10:00.000Z', schemaRev: 3 },
  { id: 4, recipeId: 4, status: 'pending', pendingReason: 'developer-scrapped', basedOnCalibrationId: null, baseTempC: 20, baseDevMinutes: 11, calculatedAt: '2026-09-25T18:10:00.000Z', schemaRev: 3 },
  { id: 5, recipeId: 5, status: 'pending', pendingReason: 'awaiting-readings', basedOnCalibrationId: null, baseTempC: 24, baseDevMinutes: 6.5, calculatedAt: '2026-09-25T18:10:00.000Z', schemaRev: 3 },
  { id: 6, recipeId: 6, status: 'active', pendingReason: null, basedOnCalibrationId: 3, baseTempC: 20, baseDevMinutes: calibrationSeeds[2].suggestedDevMinutes, calculatedAt: '2026-09-30T18:10:00.000Z', schemaRev: 3 },
  { id: 7, recipeId: 7, status: 'pending', pendingReason: 'developer-scrapped', basedOnCalibrationId: null, baseTempC: 20, baseDevMinutes: 13, calculatedAt: '2026-09-25T18:10:00.000Z', schemaRev: 3 }
]

export class FilmDevDatabase extends Dexie {
  films!: Table<FilmStock, number>
  developers!: Table<Developer, number>
  recipes!: Table<DevRecipe, number>
  runs!: Table<DevRun, number>
  calibrations!: Table<CalibrationVersion, number>
  suggestions!: Table<PendingSuggestion, number>

  constructor() {
    super('gbfilmdev-db')
    this.version(1).stores({
      films: '++id, model, format, expireDate, rollsLeft',
      developers: '++id, category, state, mixedAt',
      recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
      runs: '++id, recipeId, runDate, tankType'
    })
    this.version(2).stores({
      films: '++id, model, format, expireDate, rollsLeft',
      developers: '++id, category, state, mixedAt',
      recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
      runs: '++id, recipeId, runDate, tankType'
    }).upgrade(async (transaction) => {
      await transaction.table('films').toCollection().modify((film: FilmStock) => {
        film.schemaRev = 2
      })
      await transaction.table('developers').toCollection().modify((developer: Developer) => {
        developer.schemaRev = 2
      })
      await transaction.table('recipes').toCollection().modify((recipe: DevRecipe) => {
        recipe.schemaRev = 2
      })
      await transaction.table('runs').toCollection().modify((run: DevRun) => {
        run.schemaRev = 2
      })
    })
    // v3：实冲登记试片密度；新增校准版本与待冲建议，形成 乳剂批次→工作液→配方→实冲→校准→建议 链
    this.version(3).stores({
      films: '++id, model, format, expireDate, rollsLeft',
      developers: '++id, category, state, mixedAt',
      recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
      runs: '++id, recipeId, runDate, tankType',
      calibrations: '++id, recipeId, versionNo, publishedAt',
      suggestions: '++id, &recipeId, status'
    }).upgrade(async (transaction) => {
      const filmsTable = transaction.table<FilmStock, number>('films')
      const developersTable = transaction.table<Developer, number>('developers')
      const recipesTable = transaction.table<DevRecipe, number>('recipes')
      const runsTable = transaction.table<DevRun, number>('runs')
      const calibrationsTable = transaction.table<CalibrationVersion, number>('calibrations')
      const suggestionsTable = transaction.table<PendingSuggestion, number>('suggestions')

      await filmsTable.toCollection().modify((film: FilmStock) => { film.schemaRev = 3 })
      await developersTable.toCollection().modify((developer: Developer) => { developer.schemaRev = 3 })
      await recipesTable.toCollection().modify((recipe: DevRecipe) => { recipe.schemaRev = 3 })
      // 旧实冲没有试片密度：保留记录与当时参数，不参与校准配对
      await runsTable.toCollection().modify((run: DevRun) => { run.schemaRev = 3 })

      // 旧数据按手工校准补齐：每个配方发一条 v1 手工版本，待冲建议依据它重算
      const films = await filmsTable.toArray()
      const developers = await developersTable.toArray()
      const recipes = await recipesTable.toArray()
      const upgradedAt = new Date().toISOString()
      for (const recipe of recipes) {
        const film = films.find((item) => item.id === recipe.filmId)
        const developer = developers.find((item) => item.id === recipe.developerId)
        if (!film || !developer) continue
        const version = buildCalibrationVersion({
          recipeId: recipe.id as number,
          versionNo: 1,
          mode: 'manual',
          readings: [],
          publishedAt: upgradedAt,
          recipe,
          film,
          developer
        })
        const calibrationId = await calibrationsTable.add(plain(version))
        await suggestionsTable.add(plain({
          recipeId: recipe.id as number,
          status: developer.state === '报废' ? 'pending' : 'active',
          pendingReason: developer.state === '报废' ? 'developer-scrapped' : null,
          basedOnCalibrationId: calibrationId,
          baseTempC: recipe.tempC,
          baseDevMinutes: version.suggestedDevMinutes,
          calculatedAt: upgradedAt,
          schemaRev: 3
        } satisfies PendingSuggestion))
      }
    })
  }
}

export const db = new FilmDevDatabase()

db.on('populate', () => Promise.all([
  db.films.bulkAdd(plain(filmSeeds)),
  db.developers.bulkAdd(plain(developerSeeds)),
  db.recipes.bulkAdd(plain(recipeSeeds)),
  db.runs.bulkAdd(plain(runSeeds)),
  db.calibrations.bulkAdd(plain(calibrationSeeds)),
  db.suggestions.bulkAdd(plain(suggestionSeeds))
]))
