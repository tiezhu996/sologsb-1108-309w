export type TankType = '双联罐' | '深罐'

export interface DevRun {
  id?: number
  batchNo: string
  recipeId: number
  actualTempC: number
  actualMinutes: number
  tankType: TankType
  runDate: string
  result: string
  /** 试片密度（光楔片选定级次读数），同一配方两条读数相差不超过 0.15 才能发布校准版本 */
  stripDensity?: number | null
  schemaRev?: number
}
