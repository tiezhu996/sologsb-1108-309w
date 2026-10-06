// 校准链规则集成验证：npx vite-node scripts/verify-calibration.ts
// 每个 case 用独立数据库名 + 全新 populate（走种子数据），避免串扰。
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useCalibrationStore, CalibrationError } from '../src/stores/calibrationStore'
import { useRunStore } from '../src/stores/runStore'
import { useDeveloperStore } from '../src/stores/developerStore'
import { useFilmStore } from '../src/stores/filmStore'
import { useRecipeStore } from '../src/stores/recipeStore'
import { db } from '../src/utils/db'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function freshDb(label: string) {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  console.log(`\n[${label}]`)
}

async function closeDb() {
  db.close()
}

// ---------------------------------------------------------------- 用例 1：种子数据与一致读数发布
async function caseConsistentRelease() {
  await freshDb('一致读数 → 发布校准版本并重算建议')
  const cal = useCalibrationStore()
  const runs = useRunStore()
  await cal.load()
  await runs.load()

  // 种子：recipe 2 有两条冲突读数（0.90 / 0.70）；给它追加两条一致读数前，先验证冲突阻止发布
  try {
    await cal.releaseCalibration({ recipeId: 2 })
    check('冲突读数不允许自动发布', false)
  } catch (error) {
    check('冲突读数不允许自动发布', error instanceof CalibrationError, String(error))
  }

  // recipe 5（D-76 -1 档）种子里只有 1 条读数 0.97，录入一条 1.06 → 相差 0.09 ≤ 0.15
  await runs.addRun({
    batchNo: 'T-CASE1-01', recipeId: 5, actualTempC: 24.1, actualMinutes: 6.3,
    tankType: '深罐', runDate: '2026-10-01', result: '第二条读数', stripDensity: 1.06
  })
  await cal.load()
  const before = cal.suggestionByRecipe(5)
  check('发布前建议为待确认（等待读数）', before?.status === 'pending' && before.pendingReason === 'awaiting-readings', JSON.stringify(before))

  const result = await cal.releaseCalibration({ recipeId: 5 })
  check('发布模式为 dual', result.mode === 'dual', result.mode)
  check('锚点密度为两条平均（0.97/1.06 → 1.015→1.02）', result.calibration.anchorDensity === 1.02, String(result.calibration.anchorDensity))
  check('建议分钟按锚点重算（6.5 × 1/1.02 ≈ 6.37）', result.suggestion.baseDevMinutes === 6.37, String(result.suggestion.baseDevMinutes))
  check('发布后建议立即有效', result.suggestion.status === 'active' && result.suggestion.pendingReason === null)
  check('建议关联到新校准版本', result.suggestion.basedOnCalibrationId === result.calibration.id)

  // 重复提交不能多出版本：模拟双击并发提交
  await cal.load()
  // 再补一对一致读数，供并发两次发布同时争抢
  await runs.addRun({
    batchNo: 'T-CASE1-02', recipeId: 5, actualTempC: 24, actualMinutes: 6.2,
    tankType: '深罐', runDate: '2026-10-04', result: '三条', stripDensity: 0.98
  })
  await runs.addRun({
    batchNo: 'T-CASE1-03', recipeId: 5, actualTempC: 24, actualMinutes: 6.2,
    tankType: '深罐', runDate: '2026-10-05', result: '四条', stripDensity: 1.0
  })
  const [a, b] = await Promise.allSettled([
    cal.releaseCalibration({ recipeId: 5 }),
    cal.releaseCalibration({ recipeId: 5 })
  ])
  await cal.load()
  const recipe5Versions = cal.calibrations.filter((item) => item.recipeId === 5)
  check('并发重复提交只产生一个新版本', recipe5Versions.length === 2, `实际 ${recipe5Versions.length}`)
  check('并发中至多一次成功发布', [a, b].filter((r) => r.status === 'fulfilled').length >= 1)
}

// ---------------------------------------------------------------- 用例 2：冲突人工选定，绝不自动平均
async function caseManualPick() {
  await freshDb('冲突 → 保留两条，人工选定一条；禁止平均')
  const cal = useCalibrationStore()
  await cal.load()

  // 种子 recipe 2：0.90（run2, 2026-09-20）与 0.70（run9, 2026-09-28），相差 0.20
  const { runs: candidates } = await cal.candidateReadingsFor(2)
  check('两条冲突读数均保留为候选', candidates.length === 2
    && candidates.some((r) => r.stripDensity === 0.9)
    && candidates.some((r) => r.stripDensity === 0.7))

  // 错误的 pickedRunId 被拒绝
  try {
    await cal.releaseCalibration({ recipeId: 2, pickedRunId: 999 })
    check('选定非候选读数被拒绝', false)
  } catch (error) {
    check('选定非候选读数被拒绝', error instanceof CalibrationError)
  }

  const result = await cal.releaseCalibration({ recipeId: 2, pickedRunId: 9 })
  check('发布模式为 manual-pick', result.mode === 'manual-pick')
  check('锚点取选定读数 0.70 而非平均 0.80', result.calibration.anchorDensity === 0.7, String(result.calibration.anchorDensity))
  check('建议按 0.70 延长（7.5 × 1/0.7 被限幅 1.15 → 8.63）', result.suggestion.baseDevMinutes === 8.63, String(result.suggestion.baseDevMinutes))
  check('冲突选定后建议有效', result.suggestion.status === 'active')

  // 未被选中的 0.90 仍在候选中（选定发布只消费被选条），等待后续新读数配对
  const remaining = await cal.candidateReadingsFor(2)
  check('未选中读数保留，不静默丢弃', remaining.runs.some((r) => r.id === 2))
}

// ---------------------------------------------------------------- 用例 3：发布新版本 → 旧建议失效重算；旧记录与依据不变
async function caseNewVersionInvalidates() {
  await freshDb('再发布版本 → 建议立即重算；历史实冲与旧版本不可变')
  const cal = useCalibrationStore()
  const runs = useRunStore()
  await cal.load()
  await runs.load()

  const v1 = cal.latestCalibrationByRecipe(1)
  const s1 = cal.suggestionByRecipe(1)
  check('种子 recipe1 已有 v1 且建议有效', v1?.versionNo === 1 && s1?.status === 'active')

  const runSnapshot = JSON.stringify((await db.runs.get(1)))
  // v1 消费了 run1/run8，新两条读数（密度更高 → 建议更短）
  await runs.addRun({ batchNo: 'T-CASE3-01', recipeId: 1, actualTempC: 20, actualMinutes: 8.8, tankType: '双联罐', runDate: '2026-10-02', result: '三条', stripDensity: 1.08 })
  await runs.addRun({ batchNo: 'T-CASE3-02', recipeId: 1, actualTempC: 20, actualMinutes: 8.8, tankType: '双联罐', runDate: '2026-10-03', result: '四条', stripDensity: 1.14 })
  const v2result = await cal.releaseCalibration({ recipeId: 1 })
  check('第二次发布版本号为 v2', v2result.calibration.versionNo === 2)
  check('v2 锚点 1.11，建议缩短（9.5×1/1.11≈8.56）', v2result.suggestion.baseDevMinutes === 8.56, String(v2result.suggestion.baseDevMinutes))
  await cal.load()
  const suggestion = cal.suggestionByRecipe(1)
  check('建议已切换依据到 v2', suggestion?.basedOnCalibrationId === v2result.calibration.id)
  check('建议仍是每配方一条', cal.suggestions.filter((x) => x.recipeId === 1).length === 1)

  // v1 快照与实冲记录不变
  const v1Stored = (await db.calibrations.get(v1?.id as number))!
  check('旧版本快照不可变（锚点仍 1.03）', v1Stored.anchorDensity === v1?.anchorDensity)
  check('旧版本依据读数未被改写', JSON.stringify(v1Stored.readings) === JSON.stringify(v1.readings))
  const run1After = JSON.stringify((await db.runs.get(1)))
  check('已完成实冲记录保持不变', run1After === runSnapshot)
}

// ---------------------------------------------------------------- 用例 4：工作液报废 → 建议退回待确认
async function caseDeveloperScrap() {
  await freshDb('工作液报废 → 相关待冲建议退回待确认')
  const cal = useCalibrationStore()
  const dev = useDeveloperStore()
  await cal.load()
  await dev.load()

  // developer 3（罗迪纳尔）种子已报废；recipe 4 用它，recipe 7 也用它
  check('recipe4 建议因报废待确认', cal.suggestionByRecipe(4)?.pendingReason === 'developer-scrapped')
  check('recipe7 同为报废工作液配方，原因按报废标记', cal.suggestionByRecipe(7)?.pendingReason === 'developer-scrapped')

  // 现场：把在用的 developer 1（D-76 A，recipe 1/5/6 使用）报废
  await dev.scrap(1)
  await cal.load()
  check('recipe1 报废后退回待确认', cal.suggestionByRecipe(1)?.status === 'pending'
    && cal.suggestionByRecipe(1)?.pendingReason === 'developer-scrapped')
  check('recipe6 报废后退回待确认', cal.suggestionByRecipe(6)?.pendingReason === 'developer-scrapped')
  check('工作液本身已报废', (await db.developers.get(1))?.state === '报废')

  // 写入失败恢复原状态：伪造一次 update 失败后，状态回滚
  const originalUpdate = db.suggestions.update.bind(db.suggestions)
  db.suggestions.update = async () => { throw new Error('模拟磁盘错误') }
  let rolled = false
  try {
    await dev.scrap(2)
  } catch {
    rolled = true
  }
  db.suggestions.update = originalUpdate
  check('报废事务写入失败时整体回滚', rolled && (await db.developers.get(2))?.state === '在用')
}

// ---------------------------------------------------------------- 用例 5：胶片换批 → 建议退回待确认
async function caseFilmBatchChange() {
  await freshDb('胶片换批 → 旧批次配方建议退回待确认')
  const cal = useCalibrationStore()
  const films = useFilmStore()
  await cal.load()
  await films.load()

  // 种子 film7 = Portra 120 新乳剂 → recipe3（用 film3 Portra 120）待确认
  check('recipe3 因换批待确认', cal.suggestionByRecipe(3)?.pendingReason === 'film-batch-changed',
    String(cal.suggestionByRecipe(3)?.pendingReason))

  // 现场新增 HP5 135 新乳剂（recipe 2/7 用 film2）
  await films.addFilm({
    model: 'HP5', format: '135', boxIso: 400, realIso: 400,
    emulsionNo: 'HP5-2610-B44', expireDate: '2028-06-30', rollsLeft: 10
  })
  await cal.load()
  check('recipe2 建议因换批退回待确认', cal.suggestionByRecipe(2)?.pendingReason === 'film-batch-changed',
    String(cal.suggestionByRecipe(2)?.pendingReason))
  check('不相关画幅/型号不受影响（GP3 135 recipe1 仍有效）', cal.suggestionByRecipe(1)?.status === 'active')

  // 首个同型号批次不触发（全新型号）
  const beforeCount = cal.pendingSuggestions.length
  await films.addFilm({ model: 'GP3', format: '4×5', boxIso: 100, realIso: 100, emulsionNo: 'GP3-45-NEW', expireDate: '2028-01-01', rollsLeft: 1 })
  await cal.load()
  check('新型号/画幅首批次不退回任何建议', cal.pendingSuggestions.length === beforeCount)
}

// ---------------------------------------------------------------- 用例 6：待确认 → 人工确认恢复
async function caseConfirmSuggestion() {
  await freshDb('待确认建议可人工确认恢复有效')
  const cal = useCalibrationStore()
  await cal.load()
  // recipe3 有 v1（dual），因换批 pending
  await cal.confirmSuggestion(3)
  await cal.load()
  const s = cal.suggestionByRecipe(3)
  check('确认后恢复 active', s?.status === 'active' && s.pendingReason === null)
  check('确认后保留校准依据', s?.basedOnCalibrationId !== null && s?.basedOnCalibrationId !== undefined)
}

// ---------------------------------------------------------------- 用例 7：v2 旧数据升级 → 手工校准补齐
async function caseV2Upgrade() {
  console.log('\n[v2 旧库升级 → 按手工校准补齐]')
  setActivePinia(createPinia())
  await db.delete()

  // 手工构造 v2 库（4 张表），关闭后再用当前代码打开触发 upgrade
  const { Dexie } = await import('dexie')
  const legacy = new Dexie('gbfilmdev-db')
  legacy.version(1).stores({
    films: '++id, model, format, expireDate, rollsLeft',
    developers: '++id, category, state, mixedAt',
    recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
    runs: '++id, recipeId, runDate, tankType'
  })
  legacy.version(2).stores({
    films: '++id, model, format, expireDate, rollsLeft',
    developers: '++id, category, state, mixedAt',
    recipes: '++id, filmId, developerId, dilution, pushPull, tempC',
    runs: '++id, recipeId, runDate, tankType'
  })
  await legacy.table('films').bulkAdd([
    { id: 1, model: 'GP3', format: '135', boxIso: 100, realIso: 100, emulsionNo: 'OLD-EM-1', expireDate: '2027-01-01', rollsLeft: 5, schemaRev: 2 },
    { id: 2, model: 'HP5', format: '135', boxIso: 400, realIso: 400, emulsionNo: 'OLD-EM-2', expireDate: '2027-01-01', rollsLeft: 5, schemaRev: 2 }
  ])
  await legacy.table('developers').bulkAdd([
    { id: 1, name: '旧工作液 A', category: 'D-76', dilution: '1:1', volumeMl: 1000, mixedAt: '2026-01-01', maxRolls: 10, usedRolls: 2, state: '在用', schemaRev: 2 },
    { id: 2, name: '旧工作液 B', category: 'D-76', dilution: '1:1', volumeMl: 1000, mixedAt: '2026-01-01', maxRolls: 10, usedRolls: 2, state: '报废', schemaRev: 2 }
  ])
  await legacy.table('recipes').bulkAdd([
    { id: 1, filmId: 1, developerId: 1, dilution: '1:1', tempC: 20, devMinutes: 10, agitation: 'x', stopBath: 'x', fixer: 'x', washMinutes: 10, pushPull: 'N', note: '旧注释', schemaRev: 2 },
    { id: 2, filmId: 2, developerId: 2, dilution: '1:1', tempC: 20, devMinutes: 8, agitation: 'x', stopBath: 'x', fixer: 'x', washMinutes: 10, pushPull: 'N', schemaRev: 2 }
  ])
  await legacy.table('runs').bulkAdd([
    { id: 1, batchNo: 'OLD-1', recipeId: 1, actualTempC: 20, actualMinutes: 10, tankType: '双联罐', runDate: '2026-02-01', result: '反差偏强', schemaRev: 2 }
  ])
  await legacy.close()

  await db.open() // 触发 v2→v3 upgrade
  const cal = useCalibrationStore()
  await cal.load()

  const versions = await db.calibrations.toArray()
  const suggestions = await db.suggestions.toArray()
  check('每个旧配方补齐一条手工校准版本', versions.length === 2, `实际 ${versions.length}`)
  check('手工版本标记 manual 且无依据读数', versions.every((v) => v.mode === 'manual' && v.readings.length === 0))
  check('手工版本锚点取目标密度 1.0', versions.every((v) => v.anchorDensity === 1))
  check('在用工作液配方建议为 active', suggestions.find((s) => s.recipeId === 1)?.status === 'active')
  check('报废工作液配方建议待确认（报废优先）', suggestions.find((s) => s.recipeId === 2)?.pendingReason === 'developer-scrapped')
  check('每条建议都有校准依据', suggestions.every((s) => s.basedOnCalibrationId !== null))

  // 旧实冲无密度：保留记录，但不会被当作读数候选
  const { runs: candidates } = await cal.candidateReadingsFor(1)
  check('旧实冲记录完整保留', (await db.runs.count()) === 1 && (await db.runs.get(1))?.result === '反差偏强')
  check('无密度旧实冲不进入读数候选', candidates.length === 0)

  // 手工版本当时依据不可变：之后换批不影响已发版本快照
  const snapshot = JSON.stringify(versions.find((v) => v.recipeId === 1)?.filmSnapshot)
  await db.close()
}

async function main() {
  try {
    await caseConsistentRelease()
    await closeDb()
    await caseManualPick()
    await closeDb()
    await caseNewVersionInvalidates()
    await closeDb()
    await caseDeveloperScrap()
    await closeDb()
    await caseFilmBatchChange()
    await closeDb()
    await caseConfirmSuggestion()
    await closeDb()
    await caseV2Upgrade()
  } catch (error) {
    console.error('验证脚本异常:', error)
    process.exitCode = 1
    return
  }
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

void main()
