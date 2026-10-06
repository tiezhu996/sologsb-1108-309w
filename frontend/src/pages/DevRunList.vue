<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import EmptyPanel from '../components/common/EmptyPanel.vue'
import FilterBar from '../components/common/FilterBar.vue'
import PushPullTag from '../components/common/PushPullTag.vue'
import { useTempCompensate } from '../hooks/useTempCompensate'
import { useCalibrationStore } from '../stores/calibrationStore'
import { useDeveloperStore } from '../stores/developerStore'
import { useFilmStore } from '../stores/filmStore'
import { useRecipeStore } from '../stores/recipeStore'
import { useRunStore } from '../stores/runStore'
import { comboKeyForRecipe } from '../utils/calibration'
import type { CalibrationState, TankType } from '../types/dev-run'

interface FilterValue {
  keyword: string
  selections: Record<string, string[]>
}

interface RunForm {
  batchNo: string
  recipeId: number
  actualTempC: number
  actualMinutes: number
  testDensity: number
  tankType: TankType
  runDate: string
  result: string
}

const route = useRoute()
const filmStore = useFilmStore()
const developerStore = useDeveloperStore()
const recipeStore = useRecipeStore()
const runStore = useRunStore()
const calibrationStore = useCalibrationStore()
const showForm = ref(false)
const saving = ref(false)
const today = new Date().toISOString().slice(0, 10)

const querySelections = (key: string): string[] => {
  const value = route.query[key]
  return typeof value === 'string' && value ? value.split(',') : []
}

const filterValue = ref<FilterValue>({
  keyword: typeof route.query.q === 'string' ? route.query.q : '',
  selections: {
    tankType: querySelections('tankType'),
    result: querySelections('result')
  }
})

const form = reactive<RunForm>({
  batchNo: `R-${today.replace(/-/g, '')}-01`,
  recipeId: 1,
  actualTempC: 20,
  actualMinutes: 8,
  testDensity: 0.65,
  tankType: '双联罐',
  runDate: today,
  result: '密度均匀，中间调细腻'
})

const selectedRecipe = computed(() => recipeStore.recipes.find((recipe) => recipe.id === form.recipeId))
const comboSuggestion = computed(() => {
  const recipe = selectedRecipe.value
  if (!recipe) return undefined
  return calibrationStore.suggestionMap[comboKeyForRecipe(recipe)]
})
const activeSuggestionVersion = computed(() => {
  const suggestion = comboSuggestion.value
  if (suggestion?.state !== '生效' || suggestion.versionId === null) return undefined
  return calibrationStore.versions.find((item) => item.id === suggestion.versionId)
})
/** 待冲建议生效时以校准时间为补偿基准，否则退回配方基准 */
const baseMinutes = computed(() => {
  const suggestion = comboSuggestion.value
  if (suggestion?.state === '生效' && suggestion.minutes !== null) return suggestion.minutes
  return selectedRecipe.value?.devMinutes ?? 8
})
const basisPreview = computed(() => {
  const suggestion = comboSuggestion.value
  const version = activeSuggestionVersion.value
  if (suggestion?.state === '生效' && suggestion.minutes !== null && version) {
    return `校准 v${version.version} · 建议 ${suggestion.minutes.toFixed(2)} 分钟`
  }
  if (suggestion?.revertReason) return `待确认（${suggestion.revertReason}）`
  return '待确认（暂无校准版本）'
})
const referenceTemp = computed(() => selectedRecipe.value?.tempC ?? 20)
const { suggest } = useTempCompensate(referenceTemp)
const suggestion = computed(() => {
  const recipe = selectedRecipe.value
  if (!recipe) return null
  return suggest(baseMinutes.value, form.actualTempC)
})

watch([selectedRecipe, baseMinutes], ([recipe]) => {
  if (!recipe) return
  form.actualTempC = recipe.tempC
  form.actualMinutes = baseMinutes.value
}, { immediate: true })

const filteredRuns = computed(() => {
  const keyword = filterValue.value.keyword.trim().toLowerCase()
  const tankTypes = filterValue.value.selections.tankType ?? []
  const results = filterValue.value.selections.result ?? []
  return runStore.runs.filter((run) => {
    const recipe = recipeStore.recipes.find((item) => item.id === run.recipeId)
    const film = filmStore.films.find((item) => item.id === recipe?.filmId)
    const haystack = `${run.batchNo} ${run.result} ${film?.model ?? ''}`.toLowerCase()
    const matchesKeyword = !keyword || haystack.includes(keyword)
    const matchesTank = tankTypes.length === 0 || tankTypes.includes(run.tankType)
    const matchesResult = results.length === 0 || results.some((item) => run.result.includes(item))
    return matchesKeyword && matchesTank && matchesResult
  })
})

function recipeLabel(id: number): string {
  const recipe = recipeStore.recipes.find((item) => item.id === id)
  if (!recipe) return '未知配方'
  const film = filmStore.films.find((item) => item.id === recipe.filmId)
  const developer = developerStore.developers.find((item) => item.id === recipe.developerId)
  return `${film?.model ?? '未知胶片'} · ${developer?.name ?? '未知显影液'} · ${recipe.tempC}°C`
}

function recipeForRun(id: number) {
  return recipeStore.recipes.find((item) => item.id === id)
}

function calibrationChip(state: CalibrationState): string {
  const map: Record<CalibrationState, string> = {
    待配对: 'status--amber',
    冲突待选: 'status--rose',
    已入版: 'status--cyan',
    已结清: 'status--settled'
  }
  return map[state]
}

function applySuggestion(): void {
  if (!suggestion.value) return
  form.actualMinutes = suggestion.value.minutes
}

async function submitRun(): Promise<void> {
  if (!form.batchNo.trim() || !form.recipeId || !form.result.trim()) {
    ElMessage.warning('请填写批次号、配方与结果评价')
    return
  }
  if (!Number.isFinite(form.testDensity) || form.testDensity <= 0) {
    ElMessage.warning('请登记本次试片密度')
    return
  }
  saving.value = true
  const selectedDeveloper = developerStore.developers.find((item) => item.id === selectedRecipe.value?.developerId)
  const willExceedLimit = selectedDeveloper !== undefined
    && selectedDeveloper.state !== '报废'
    && selectedDeveloper.usedRolls + 1 > selectedDeveloper.maxRolls
  try {
    await runStore.addRun({
      batchNo: form.batchNo.trim(),
      recipeId: Number(form.recipeId),
      actualTempC: Number(form.actualTempC),
      actualMinutes: Number(form.actualMinutes),
      testDensity: Number(form.testDensity),
      tankType: form.tankType,
      runDate: form.runDate,
      result: form.result.trim()
    })
    await Promise.all([developerStore.load(), recipeStore.load(), calibrationStore.load()])
    if (willExceedLimit) {
      ElMessage.warning('冲洗记录已保存，本次已超过显影液标称可冲上限，请评估后标记报废')
    } else {
      ElMessage.success('冲洗记录已保存，试片密度已进入校准链')
    }
    form.batchNo = `R-${today.replace(/-/g, '')}-${String(runStore.runs.length + 1).padStart(2, '0')}`
    form.result = ''
    showForm.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败，已恢复原状态')
  } finally {
    saving.value = false
  }
}

async function writeBack(recipeId?: number, runId?: number): Promise<void> {
  if (recipeId === undefined || runId === undefined) return
  await runStore.writeBackNote(runId, recipeId)
  await recipeStore.load()
  ElMessage.success('本次实冲结果已回写配方注释')
}

onMounted(async () => {
  await Promise.all([
    filmStore.load(),
    developerStore.load(),
    recipeStore.load(),
    runStore.load(),
    calibrationStore.load()
  ])
  if (recipeStore.recipes[0]?.id !== undefined) {
    form.recipeId = recipeStore.recipes[0].id
  }
})
</script>

<template>
  <section class="page-shell">
    <header class="page-hero page-hero--compact">
      <div>
        <span class="eyebrow">RUN JOURNAL</span>
        <h1>冲洗记录与结果评价</h1>
        <p>录入实冲温度、时间与试片密度，密度读数进入校准链，成为下一批的待冲建议。</p>
      </div>
      <button type="button" class="primary-button" data-testid="new-run" @click="showForm = !showForm">
        {{ showForm ? '收起表单' : '新建冲洗记录' }}
      </button>
    </header>

    <form v-if="showForm" class="inline-form" data-testid="form-run" @submit.prevent="submitRun">
      <div class="inline-form__head">
        <div>
          <h2>录入本次实冲</h2>
          <p>选择配方后自动带入待冲建议，试片密度将与同组合读数配对校准。</p>
        </div>
        <PushPullTag v-if="selectedRecipe" :value="selectedRecipe.pushPull" show-hint />
      </div>
      <div class="form-grid form-grid--three">
        <label>
          <span>批次号</span>
          <input v-model="form.batchNo" data-testid="field-batchNo" type="text" />
        </label>
        <label class="span-2">
          <span>冲洗配方</span>
          <select v-model.number="form.recipeId" data-testid="field-recipeId">
            <option v-for="recipe in recipeStore.recipes" :key="recipe.id" :value="recipe.id">
              {{ recipeLabel(recipe.id ?? 0) }}
            </option>
          </select>
        </label>
        <label>
          <span>实测温度</span>
          <input v-model.number="form.actualTempC" data-testid="field-actualTempC" type="number" min="10" max="50" step="0.1" />
        </label>
        <label>
          <span>实际时间</span>
          <input v-model.number="form.actualMinutes" data-testid="field-actualMinutes" type="number" min="0.25" max="90" step="0.25" />
        </label>
        <label>
          <span>试片密度</span>
          <input v-model.number="form.testDensity" data-testid="field-testDensity" type="number" min="0.1" max="2" step="0.01" />
        </label>
        <label>
          <span>罐型</span>
          <select v-model="form.tankType" data-testid="field-tankType">
            <option value="双联罐">双联罐</option>
            <option value="深罐">深罐</option>
          </select>
        </label>
        <label>
          <span>冲洗日期</span>
          <input v-model="form.runDate" data-testid="field-runDate" type="date" />
        </label>
        <label class="span-3">
          <span>结果评价</span>
          <input v-model="form.result" data-testid="field-result" type="text" placeholder="记录反差、灰雾与密度表现" />
        </label>
        <div class="span-3 compensation-callout">
          <div>
            <strong>温度补偿建议</strong>
            <p v-if="suggestion">{{ suggestion.advice }}；显影液用量会在保存后加一卷。</p>
            <p v-else>请选择一条配方后查看修正建议。</p>
            <p class="basis-line" data-testid="basis-preview">待冲依据：{{ basisPreview }}</p>
          </div>
          <button type="button" class="ghost-button" :disabled="!suggestion" @click="applySuggestion">采用修正时间</button>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="ghost-button" @click="showForm = false">取消</button>
        <button type="submit" class="primary-button" data-testid="submit-run" :disabled="saving">
          {{ saving ? '保存中…' : '保存冲洗记录' }}
        </button>
      </div>
    </form>

    <div class="stat-strip">
      <div class="simple-stat"><span>记录总数</span><strong data-testid="count-run">{{ runStore.runs.length }}</strong><small>次</small></div>
      <div class="simple-stat"><span>当前筛选</span><strong>{{ filteredRuns.length }}</strong><small>次</small></div>
      <div class="simple-stat"><span>待配对读数</span><strong>{{ runStore.runs.filter((item) => item.calibrationState === '待配对').length }}</strong><small>条</small></div>
    </div>

    <FilterBar
      v-model="filterValue"
      :fields="[
        { key: 'tankType', label: '罐型', options: ['双联罐', '深罐'] },
        { key: 'result', label: '结果特点', options: ['密度均匀', '暗部略薄', '反差稍强', '高光保留', '灰雾'] }
      ]"
    />

    <div v-if="filteredRuns.length" class="run-list">
      <article v-for="run in filteredRuns" :key="run.id" class="run-card" data-testid="row-run">
        <div class="run-card__date">
          <strong>{{ run.runDate.slice(5) }}</strong>
          <span>{{ run.runDate.slice(0, 4) }}</span>
        </div>
        <div class="run-card__body">
          <div class="entity-card__title">
            <div>
              <h2>{{ run.batchNo }}</h2>
              <p>{{ recipeLabel(run.recipeId) }}</p>
            </div>
            <div class="run-card__tags">
              <span class="status-chip" :class="calibrationChip(run.calibrationState)">{{ run.calibrationState }}</span>
              <PushPullTag v-if="recipeForRun(run.recipeId)" :value="recipeForRun(run.recipeId)?.pushPull ?? 'N'" />
            </div>
          </div>
          <div class="run-parameters">
            <span><small>实测温度</small><strong>{{ run.actualTempC }}°C</strong></span>
            <span><small>实际时间</small><strong>{{ run.actualMinutes }} 分钟</strong></span>
            <span><small>试片密度</small><strong data-testid="run-density">{{ run.testDensity.toFixed(2) }}</strong></span>
            <span><small>罐型</small><strong>{{ run.tankType }}</strong></span>
          </div>
          <blockquote>{{ run.result }}</blockquote>
          <div class="run-card__foot">
            <small>当时依据：{{ run.basisLabel }}</small>
            <small v-if="recipeForRun(run.recipeId)?.note">配方注释：{{ recipeForRun(run.recipeId)?.note }}</small>
            <button type="button" class="text-button" @click="writeBack(run.recipeId, run.id)">回写配方注释</button>
          </div>
        </div>
      </article>
    </div>
    <EmptyPanel v-else title="没有符合条件的冲洗记录" description="调整罐型、结果特点或关键字后重新查看。" />
  </section>
</template>

<style scoped>
.basis-line {
  margin-top: 4px;
  color: var(--ink-soft);
  font-size: 12px;
}

.run-card__tags {
  display: flex;
  gap: 8px;
  align-items: center;
}

.status--settled {
  color: #6d6558;
  background: #ece5d8;
}
</style>
