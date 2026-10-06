<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import EmptyPanel from '../components/common/EmptyPanel.vue'
import PushPullTag from '../components/common/PushPullTag.vue'
import StatBadge from '../components/common/StatBadge.vue'
import { useCalibrationStore } from '../stores/calibrationStore'
import { useDeveloperStore } from '../stores/developerStore'
import { useFilmStore } from '../stores/filmStore'
import { useRecipeStore } from '../stores/recipeStore'
import { useRunStore } from '../stores/runStore'
import { DENSITY_TOLERANCE, TARGET_DENSITY, comboKeyForRecipe } from '../utils/calibration'
import { comboPendingRuns } from '../utils/chain'
import type { DensityConflict } from '../types/calibration'
import type { DevRecipe } from '../types/dev-recipe'

const calibrationStore = useCalibrationStore()
const developerStore = useDeveloperStore()
const filmStore = useFilmStore()
const recipeStore = useRecipeStore()
const runStore = useRunStore()
const resolving = ref(false)

const pendingComboCount = computed(() => (
  recipeStore.recipes.filter((recipe) => {
    const suggestion = calibrationStore.suggestionMap[comboKeyForRecipe(recipe)]
    return suggestion?.state !== '生效'
  }).length
))

function filmLabel(filmId: number): string {
  const film = filmStore.films.find((item) => item.id === filmId)
  return film ? `${film.model} · ${film.format} · ${film.emulsionNo}` : '未知胶片'
}

function developerLabel(developerId: number): string {
  const developer = developerStore.developers.find((item) => item.id === developerId)
  return developer ? `${developer.name} · ${developer.category}` : '未知显影液'
}

function comboTitle(recipe: DevRecipe): string {
  return `${filmLabel(recipe.filmId)} · ${developerLabel(recipe.developerId)}`
}

function runBrief(runId: number) {
  return runStore.runs.find((item) => item.id === runId)
}

function conflictRuns(conflict: DensityConflict) {
  return conflict.runIds.map((runId, index) => ({
    runId,
    reading: conflict.readings[index] ?? 0,
    run: runBrief(runId)
  }))
}

function suggestionOf(recipe: DevRecipe) {
  return calibrationStore.suggestionMap[comboKeyForRecipe(recipe)]
}

function pendingRunsOf(recipe: DevRecipe) {
  return comboPendingRuns(runStore.runs, comboKeyForRecipe(recipe))
}

async function resolve(conflictId: number | undefined, chosenRunId: number): Promise<void> {
  if (conflictId === undefined || resolving.value) return
  resolving.value = true
  try {
    await calibrationStore.resolveConflict(conflictId, chosenRunId)
    await runStore.load()
    ElMessage.success('已按选定读数发布校准版本，待冲建议同步重算')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '校准版本发布失败，已恢复原状态')
  } finally {
    resolving.value = false
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
})
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--compact">
      <div>
        <span class="eyebrow">CALIBRATION CHAIN</span>
        <h1>校准链与待冲建议</h1>
        <p>试片密度按「乳剂批次 + 显影液 + 配方」组合配对，两条读数相差不超过 {{ DENSITY_TOLERANCE }} 才发布校准版本。</p>
      </div>
      <div class="page-hero__stamp">{{ TARGET_DENSITY.toFixed(2) }}<br /><small>目标密度</small></div>
    </header>

    <div class="stat-strip">
      <StatBadge label="已发布版本" :value="calibrationStore.versions.length" hint="重复提交不会多出版本" tone="amber" />
      <StatBadge label="生效建议" :value="calibrationStore.activeSuggestions.length" hint="版本发布后即时重算" tone="cyan" />
      <StatBadge label="待确认组合" :value="pendingComboCount" hint="报废或换批后先退回待确认" tone="rose" />
      <StatBadge label="未解决冲突" :value="calibrationStore.openConflicts.length" hint="保留两条读数等人工选定" />
    </div>

    <div v-if="calibrationStore.openConflicts.length" class="panel conflict-panel" data-testid="conflict-panel">
      <div class="panel__head">
        <div>
          <h2>密度冲突待选定</h2>
          <p>两条读数相差超过 {{ DENSITY_TOLERANCE }}，不取平均；请人工选定一条作为发布依据。</p>
        </div>
      </div>
      <article v-for="conflict in calibrationStore.openConflicts" :key="conflict.id" class="conflict-card" data-testid="row-conflict">
        <div
          v-for="entry in conflictRuns(conflict)"
          :key="entry.runId"
          class="conflict-card__side"
        >
          <strong class="conflict-card__density">{{ entry.reading.toFixed(2) }}</strong>
          <div>
            <span>{{ entry.run?.batchNo ?? `记录 #${entry.runId}` }}</span>
            <small>{{ entry.run?.runDate }} · {{ entry.run?.actualTempC }}°C / {{ entry.run?.actualMinutes }} 分钟</small>
            <small v-if="entry.run?.result">{{ entry.run.result }}</small>
          </div>
          <button
            type="button"
            class="primary-button"
            :disabled="resolving"
            :data-testid="`resolve-conflict-${entry.runId}`"
            @click="resolve(conflict.id, entry.runId)"
          >采用该读数</button>
        </div>
        <div class="conflict-card__delta">
          相差 {{ Math.abs((conflict.readings[0] ?? 0) - (conflict.readings[1] ?? 0)).toFixed(2) }}
        </div>
      </article>
    </div>

    <div v-if="recipeStore.recipes.length" class="combo-list">
      <article
        v-for="recipe in recipeStore.recipes"
        :key="recipe.id"
        class="entity-card combo-card"
        data-testid="row-combo"
      >
        <div class="entity-card__main">
          <div class="entity-card__title">
            <div>
              <h2>{{ comboTitle(recipe) }}</h2>
              <p>配方 #{{ recipe.id }} · {{ recipe.dilution }} · {{ recipe.tempC }}°C / {{ recipe.devMinutes.toFixed(2) }} 分钟基准</p>
            </div>
            <PushPullTag :value="recipe.pushPull" />
          </div>
          <div class="combo-card__suggestion">
            <template v-if="suggestionOf(recipe)?.state === '生效'">
              <span class="status-chip status--cyan" data-testid="suggestion-active">生效</span>
              <strong>{{ suggestionOf(recipe)?.minutes?.toFixed(2) }} 分钟</strong>
              <small>
                校准 v{{ calibrationStore.versions.find((item) => item.id === suggestionOf(recipe)?.versionId)?.version }}
                · 发布于 {{ calibrationStore.versions.find((item) => item.id === suggestionOf(recipe)?.versionId)?.createdAt }}
              </small>
            </template>
            <template v-else>
              <span class="status-chip status--amber" data-testid="suggestion-pending">待确认</span>
              <small v-if="suggestionOf(recipe)?.revertReason">{{ suggestionOf(recipe)?.revertReason }}后退回，等待新的试片密度配对</small>
              <small v-else>暂无校准版本，等待两条一致试片密度</small>
            </template>
          </div>
          <div v-if="pendingRunsOf(recipe).length" class="combo-card__pending">
            <span v-for="run in pendingRunsOf(recipe)" :key="run.id" class="pending-reading">
              {{ run.batchNo }} · 密度 {{ run.testDensity.toFixed(2) }}
              <em>{{ run.calibrationState }}</em>
            </span>
          </div>
          <div v-if="calibrationStore.versionsOf(comboKeyForRecipe(recipe)).length" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>版本</th>
                  <th>试片读数</th>
                  <th>校准密度</th>
                  <th>建议时间</th>
                  <th>来源</th>
                  <th>发布日期</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="version in calibrationStore.versionsOf(comboKeyForRecipe(recipe))" :key="version.id" data-testid="row-version">
                  <td><strong>v{{ version.version }}</strong></td>
                  <td>{{ version.readings.map((item) => item.toFixed(2)).join(' / ') }}</td>
                  <td>{{ version.calibratedDensity.toFixed(3) }}</td>
                  <td>{{ version.suggestedMinutes.toFixed(2) }} 分钟</td>
                  <td>{{ version.resolution }}</td>
                  <td>{{ version.createdAt }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <small v-else class="combo-card__empty">该组合尚未发布校准版本。</small>
        </div>
      </article>
    </div>
    <EmptyPanel v-else title="还没有配方组合" description="先在配方表编排配方，再用实冲试片密度建立校准链。" />
  </section>
</template>

<style scoped>
.conflict-panel {
  display: grid;
  gap: 14px;
}

.conflict-card {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 14px;
  border: 1px dashed var(--line-strong);
  border-radius: 14px;
  background: rgba(255, 248, 238, 0.7);
}

.conflict-card__side {
  display: grid;
  gap: 8px;
  justify-items: start;
  align-content: start;
}

.conflict-card__side > div {
  display: grid;
  gap: 2px;
}

.conflict-card__side small {
  color: var(--ink-soft);
}

.conflict-card__density {
  font-family: "Avenir Next Condensed", sans-serif;
  font-size: 30px;
  line-height: 1;
}

.conflict-card__delta {
  position: absolute;
  top: -10px;
  left: 50%;
  padding: 2px 10px;
  border-radius: 999px;
  color: #983f38;
  background: #f5ddd8;
  font-size: 11px;
  font-weight: 700;
  transform: translateX(-50%);
}

.combo-list {
  display: grid;
  gap: 16px;
}

.combo-card__suggestion {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(244, 238, 226, 0.65);
}

.combo-card__suggestion strong {
  font-family: "Avenir Next Condensed", sans-serif;
  font-size: 22px;
}

.combo-card__suggestion small {
  color: var(--ink-soft);
}

.combo-card__pending {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pending-reading {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 12px;
}

.pending-reading em {
  color: var(--ink-soft);
  font-style: normal;
}

.combo-card__empty {
  color: var(--ink-soft);
}

@media (max-width: 720px) {
  .conflict-card {
    grid-template-columns: 1fr;
  }
}
</style>
