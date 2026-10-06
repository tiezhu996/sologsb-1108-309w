<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useCalibrationStore, CalibrationError } from '../../stores/calibrationStore'
import { useDeveloperStore } from '../../stores/developerStore'
import { useFilmStore } from '../../stores/filmStore'
import { useRecipeStore } from '../../stores/recipeStore'
import { useRunStore } from '../../stores/runStore'
import {
  DENSITY_TOLERANCE,
  isConsistentPair,
  MODE_LABELS,
  round2
} from '../../utils/calibration'
import type { DevRun } from '../../types/dev-run'
import type { PendingReason } from '../../types/calibration'

const props = defineProps<{
  /** 只展示指定配方；不传则展示全部配方 */
  recipeId?: number
  compact?: boolean
}>()

const filmStore = useFilmStore()
const developerStore = useDeveloperStore()
const recipeStore = useRecipeStore()
const runStore = useRunStore()
const calibrationStore = useCalibrationStore()

/** recipeId -> 未消费读数（异步加载） */
const pendingRunsMap = ref<Record<number, DevRun[]>>({})
const publishingId = ref<number | null>(null)
const confirmingId = ref<number | null>(null)

const recipes = computed(() =>
  props.recipeId !== undefined
    ? recipeStore.recipes.filter((item) => item.id === props.recipeId)
    : recipeStore.recipes
)

const REASON_LABELS: Record<Exclude<PendingReason, null>, string> = {
  'developer-scrapped': '工作液已报废，建议先复核显影液',
  'film-batch-changed': '胶片已更换乳剂批次，建议先复核',
  'awaiting-readings': '尚无校准版本，等待两条试片读数'
}

function filmOf(recipeId: number) {
  const recipe = recipeStore.recipes.find((item) => item.id === recipeId)
  return filmStore.films.find((item) => item.id === recipe?.filmId)
}

function developerOf(recipeId: number) {
  const recipe = recipeStore.recipes.find((item) => item.id === recipeId)
  return developerStore.developers.find((item) => item.id === recipe?.developerId)
}

function chainTitle(recipeId: number): string {
  const recipe = recipeStore.recipes.find((item) => item.id === recipeId)
  const film = filmOf(recipeId)
  const developer = developerOf(recipeId)
  return `${film?.emulsionNo ?? '未知乳剂'} → ${developer?.name ?? '未知工作液'} → 配方 #${recipe?.id ?? recipeId}`
}

function pendingPair(recipeId: number): DevRun[] {
  return pendingRunsMap.value[recipeId] ?? []
}

function pairState(pair: DevRun[]): { tone: string; label: string; spread: number | null } {
  if (pair.length === 0) return { tone: '', label: '暂无未发布的试片读数', spread: null }
  if (pair.length === 1) {
    return { tone: 'status--warning', label: `已有 1 条读数 ${pair[0].stripDensity?.toFixed(2)}，再录 1 条`, spread: null }
  }
  const [first, second] = pair
  const spread = round2(Math.abs((first.stripDensity ?? 0) - (second.stripDensity ?? 0)))
  if (isConsistentPair(first.stripDensity ?? 0, second.stripDensity ?? 0)) {
    return { tone: 'status--ok', label: `读数一致（相差 ${spread.toFixed(2)} ≤ ${DENSITY_TOLERANCE.toFixed(2)}）`, spread }
  }
  return { tone: 'status--danger', label: `读数冲突（相差 ${spread.toFixed(2)} > ${DENSITY_TOLERANCE.toFixed(2)}），保留两条待人工选定`, spread }
}

function reasonLabel(reason: PendingReason): string {
  return reason ? REASON_LABELS[reason] : ''
}

async function refreshCandidates(): Promise<void> {
  const next: Record<number, DevRun[]> = {}
  for (const recipe of recipes.value) {
    if (recipe.id === undefined) continue
    const { runs } = await calibrationStore.candidateReadingsFor(recipe.id)
    next[recipe.id] = runs.slice(0, 2)
  }
  pendingRunsMap.value = next
}

async function release(recipeId: number, pickedRunId?: number): Promise<void> {
  publishingId.value = recipeId
  try {
    const result = await calibrationStore.releaseCalibration({ recipeId, pickedRunId })
    await Promise.all([calibrationStore.load(), refreshCandidates()])
    if (result.mode === 'dual') {
      ElMessage.success(`校准版本 v${result.calibration.versionNo} 已发布，待冲建议已按新读数重算`)
    } else if (result.mode === 'manual-pick') {
      ElMessage.success(`已按人工选定读数发布 v${result.calibration.versionNo}，待冲建议已重算`)
    }
  } catch (error) {
    if (error instanceof CalibrationError) {
      ElMessage.warning(error.message)
    } else {
      throw error
    }
  } finally {
    publishingId.value = null
  }
}

async function confirmSuggestion(recipeId: number): Promise<void> {
  confirmingId.value = recipeId
  try {
    await calibrationStore.confirmSuggestion(recipeId)
    await calibrationStore.load()
    ElMessage.success('待冲建议已确认恢复有效')
  } finally {
    confirmingId.value = null
  }
}

onMounted(async () => {
  await Promise.all([
    filmStore.load(),
    developerStore.load(),
    recipeStore.load(),
    runStore.load(),
    calibrationStore.load()
  ])
  await refreshCandidates()
})

// 实冲记录增减（页面内新录入）后刷新待发布读数
watch(() => runStore.runs.length, () => {
  void refreshCandidates()
})
</script>

<template>
  <section class="calibration-chain" :class="{ 'calibration-chain--compact': compact }">
    <article
      v-for="recipeId in recipes.map((item) => item.id).filter((id): id is number => id !== undefined)"
      :key="recipeId"
      class="panel cal-card"
      data-testid="cal-card"
    >
      <header class="cal-card__head">
        <div>
          <h2>{{ chainTitle(recipeId) }}</h2>
          <p>
            {{ filmOf(recipeId)?.model }} {{ filmOf(recipeId)?.format }} ·
            {{ developerOf(recipeId)?.category }} {{ developerOf(recipeId)?.dilution }} ·
            基准 {{ calibrationStore.latestCalibrationByRecipe(recipeId)?.recipeSnapshot.tempC ?? '—' }}°C
          </p>
        </div>
        <span
          v-if="calibrationStore.suggestionByRecipe(recipeId)?.status === 'active'"
          class="status-chip status--ok"
          data-testid="suggestion-active"
        >待冲建议有效</span>
        <span v-else class="status-chip status--warning" data-testid="suggestion-pending">待确认</span>
      </header>

      <!-- 当前待冲建议 -->
      <div class="cal-suggestion" data-testid="cal-suggestion">
        <div>
          <small>下一卷待冲建议</small>
          <strong>
            {{ calibrationStore.suggestionByRecipe(recipeId)?.baseTempC }}°C /
            {{ (calibrationStore.suggestionByRecipe(recipeId)?.baseDevMinutes ?? 0).toFixed(2) }} 分钟
          </strong>
        </div>
        <div class="cal-suggestion__basis">
          <template v-if="calibrationStore.latestCalibrationByRecipe(recipeId)">
            <small>
              依据 v{{ calibrationStore.latestCalibrationByRecipe(recipeId)?.versionNo }} ·
              {{ MODE_LABELS[calibrationStore.latestCalibrationByRecipe(recipeId)?.mode ?? 'manual'] }}
            </small>
            <small>重算于 {{ (calibrationStore.suggestionByRecipe(recipeId)?.calculatedAt ?? '').slice(0, 10) }}</small>
          </template>
          <small v-else>尚无发布版本，暂按配方基准显示，不用于修正</small>
        </div>
        <button
          v-if="calibrationStore.suggestionByRecipe(recipeId)?.status === 'pending'"
          type="button"
          class="ghost-button"
          data-testid="confirm-suggestion"
          :disabled="confirmingId === recipeId"
          @click="confirmSuggestion(recipeId)"
        >{{ confirmingId === recipeId ? '确认中…' : '复核后确认' }}</button>
      </div>

      <p v-if="calibrationStore.suggestionByRecipe(recipeId)?.pendingReason" class="cal-pending-reason">
        ⚠ {{ reasonLabel(calibrationStore.suggestionByRecipe(recipeId)?.pendingReason ?? null) }}
      </p>

      <!-- 未消费读数 -->
      <div class="cal-readings">
        <div class="cal-readings__head">
          <span>待发布试片读数</span>
          <span :class="['status-chip', pairState(pendingPair(recipeId)).tone]">{{ pairState(pendingPair(recipeId)).label }}</span>
        </div>
        <ul v-if="pendingPair(recipeId).length">
          <li v-for="run in pendingPair(recipeId)" :key="run.id" :data-testid="`pending-reading-${run.id}`">
            <strong>{{ run.stripDensity?.toFixed(2) }}</strong>
            <span>{{ run.batchNo }} · {{ run.runDate }} · {{ run.actualTempC }}°C / {{ run.actualMinutes }} 分钟</span>
          </li>
        </ul>

        <div v-if="pendingPair(recipeId).length >= 2" class="cal-readings__actions">
          <button
            v-if="isConsistentPair(pendingPair(recipeId)[0].stripDensity ?? 0, pendingPair(recipeId)[1].stripDensity ?? 0)"
            type="button"
            class="primary-button"
            data-testid="release-dual"
            :disabled="publishingId === recipeId"
            @click="release(recipeId)"
          >{{ publishingId === recipeId ? '发布中…' : '发布校准版本' }}</button>
          <template v-else>
            <button
              v-for="run in pendingPair(recipeId).slice(0, 2)"
              :key="run.id"
              type="button"
              class="ghost-button"
              :data-testid="`release-pick-${run.id}`"
              :disabled="publishingId === recipeId"
              @click="release(recipeId, run.id)"
            >{{ publishingId === recipeId ? '发布中…' : `选定 ${run.stripDensity?.toFixed(2)} 发布` }}</button>
          </template>
        </div>
      </div>

      <!-- 已发布版本（只读快照） -->
      <details v-if="calibrationStore.calibrations.filter((item) => item.recipeId === recipeId).length" class="cal-history">
        <summary>已发布校准版本（{{ calibrationStore.calibrations.filter((item) => item.recipeId === recipeId).length }}）</summary>
        <ol>
          <li v-for="version in calibrationStore.calibrations
            .filter((item) => item.recipeId === recipeId)
            .sort((a, b) => b.versionNo - a.versionNo)" :key="version.id">
            <div class="cal-history__title">
              <strong>v{{ version.versionNo }} · {{ MODE_LABELS[version.mode] }}</strong>
              <span>{{ version.publishedAt.slice(0, 10) }} 发布</span>
            </div>
            <div class="cal-history__grid">
              <span><small>当时乳剂</small>{{ version.filmSnapshot.emulsionNo }}</span>
              <span><small>当时工作液</small>{{ version.developerSnapshot.name }} · {{ version.developerSnapshot.state }}</span>
              <span><small>基准配方</small>{{ version.recipeSnapshot.tempC }}°C / {{ version.recipeSnapshot.devMinutes }} 分钟</span>
              <span><small>锚点密度</small>{{ version.anchorDensity.toFixed(2) }}<template v-if="version.densitySpread !== null">（差 {{ version.densitySpread.toFixed(2) }}）</template></span>
              <span><small>发布建议</small>{{ version.suggestedDevMinutes.toFixed(2) }} 分钟</span>
              <span v-if="version.readings.length"><small>依据读数</small>{{ version.readings.map((item) => item.stripDensity.toFixed(2)).join(' / ') }}</span>
            </div>
          </li>
        </ol>
      </details>
    </article>
  </section>
</template>

<style scoped>
.calibration-chain {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
  margin: 18px 0;
}

.calibration-chain--compact {
  grid-template-columns: 1fr;
  margin: 0;
}

.cal-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cal-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.cal-card__head h2 {
  margin: 0 0 4px;
  font-size: 15px;
}

.cal-card__head p {
  margin: 0;
  font-size: 12px;
  opacity: 0.72;
}

.cal-suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(56, 120, 102, 0.08);
}

.cal-suggestion small {
  display: block;
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 2px;
}

.cal-suggestion strong {
  font-size: 19px;
}

.cal-suggestion__basis {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 160px;
}

.cal-pending-reason {
  margin: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(196, 138, 42, 0.12);
  font-size: 12.5px;
}

.cal-readings {
  border-top: 1px dashed rgba(120, 120, 120, 0.3);
  padding-top: 12px;
}

.cal-readings__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  margin-bottom: 8px;
}

.cal-readings ul {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cal-readings li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12.5px;
}

.cal-readings li strong {
  font-size: 16px;
  min-width: 42px;
}

.cal-readings__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cal-history summary {
  cursor: pointer;
  font-size: 12.5px;
  opacity: 0.8;
}

.cal-history ol {
  margin: 10px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cal-history__title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.cal-history__title span {
  font-size: 11.5px;
  opacity: 0.65;
}

.cal-history__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
  margin-top: 4px;
  font-size: 12px;
}

.cal-history__grid small {
  display: block;
  opacity: 0.6;
  font-size: 10.5px;
}
</style>
