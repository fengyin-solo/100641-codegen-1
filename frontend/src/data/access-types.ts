/** 收运车辆与承运单位准入台账的领域类型。
 * 判定口径不落在页面上，全部由 src/api/access-service.ts 计算。 */

// 准入结论只此四种：准入状态由准运证到期日推导，不允许人工勾选
export type AccessStatus = '准予运输' | '准运证临期' | '准运证过期' | '未登记准入'

// 记录来源：窗口登记、准运证补录、历史台账导入
export type AccessSource = '登记' | '补录' | '历史导入'

export type AccessRecord = {
  id: number
  /** 承运单位 */
  carrierName: string
  /** 收运车辆车牌 */
  plate: string
  /** 发证机关 */
  permitIssuer: string
  /** 准运证编号 */
  permitNo: string
  /** 准运证到期日 YYYY-MM-DD */
  permitExpiry: string
  /** 最后一版提交时间（ISO 字符串） */
  registeredAt: string
  /** 来源 */
  source: AccessSource
  /** 版本号：首版为 1，同一张准运证每补录一次加一，记录始终只有一条 */
  version: number
}

export type AccessLedger = {
  seq: number
  records: AccessRecord[]
}

/** 登记 / 补录表单的统一输入 */
export type AccessFormInput = {
  carrierName: string
  plate: string
  permitIssuer: string
  permitNo: string
  permitExpiry: string
}

/** 历史台账导入的一行：比窗口登记多一个「当时的登记日期」，按当时到期日对齐 */
export type AccessImportInput = AccessFormInput & {
  registeredDate: string
}

export type AccessItemResult = {
  ok: boolean
  message: string
  id?: number
}

export type AccessImportLineResult = AccessItemResult & {
  line: number
  plate: string
  permitNo: string
}

export type AccessImportResult = {
  accepted: number
  skipped: number
  lines: AccessImportLineResult[]
}
