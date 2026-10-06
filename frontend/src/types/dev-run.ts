export type TankType = '双联罐' | '深罐'
export type DensitySource = '实测' | '手工校准'
export type CalibrationState = '待配对' | '冲突待选' | '已入版' | '已结清'

export interface DevRun {
  id?: number
  batchNo: string
  recipeId: number
  actualTempC: number
  actualMinutes: number
  tankType: TankType
  runDate: string
  result: string
  /** 试片密度：录入实冲时登记，是校准链的输入 */
  testDensity: number
  /** 实测读数参与配对；手工校准为旧数据升级补齐，直接进入已结清 */
  densitySource: DensitySource
  calibrationState: CalibrationState
  /** 组合键：胶片乳剂批次 + 显影液 + 配方 */
  comboKey: string
  /** 保存时的待冲建议快照，后续版本发布不回写 */
  basisLabel: string
  schemaRev?: number
}
