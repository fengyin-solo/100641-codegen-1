/**
 * 收运车辆与承运单位准入台账 —— 判定口径只留这一份。
 * 页面登记、准运证补录、历史台账导入、进厂计量待核清单，全部调这里的函数，
 * 任何地方都不允许自己再判一遍状态，也不接受人工勾选准入结论。
 */

export const NEAR_EXPIRY_DAYS = 15

export const ACCESS_VALID = '有效'
export const ACCESS_NEAR = '临期'
export const ACCESS_EXPIRED = '已过期'

export type AccessStatus = typeof ACCESS_VALID | typeof ACCESS_NEAR | typeof ACCESS_EXPIRED

export type AccessInput = {
  carrier: string
  plate: string
  permitNo: string
  issuer: string
  expireDate: string
  note?: string
}

/** 台账里逐台登记的一条记录。status 是按到期日算出的缓存，真值以 judgeAccess 为准。 */
export type AccessEntry = AccessInput & {
  id: number
  status: AccessStatus
  daysLeft: number
  pending: boolean
  abnormal: boolean
  registeredAt: string
  permitVersion: number
  note: string
  [field: string]: string | number | boolean
}

export type AccessView = AccessEntry

export type AccessVerdict = {
  status: AccessStatus
  daysLeft: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  )
}

function midnight(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 从基准日到到期日还剩几个完整自然日；到期日当天为 0，过期为负数。 */
export function daysUntil(expireDate: string, asOf: string): number {
  return Math.round((midnight(expireDate) - midnight(asOf)) / 86_400_000)
}

/**
 * 唯一的准入结论口径：
 * - 到期日已过（剩余 < 0）：已过期，记录不允许保存；
 * - 离到期不足十五天（0 <= 剩余 < 15）：临期，先标出来；
 * - 其余：有效。
 */
export function judgeAccess(expireDate: string, asOf: string): AccessVerdict {
  const daysLeft = daysUntil(expireDate, asOf)
  if (daysLeft < 0) {
    return { status: ACCESS_EXPIRED, daysLeft }
  }
  if (daysLeft < NEAR_EXPIRY_DAYS) {
    return { status: ACCESS_NEAR, daysLeft }
  }
  return { status: ACCESS_VALID, daysLeft }
}

/** 车牌归一：粤B·12345 与 粤B12345 视为同一台。 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[^一-龥A-Za-z0-9]/g, '').toUpperCase()
}

/** 同一台收运车辆在同一家承运单位下只能登记一次：判定键 = 承运单位 + 车牌。 */
export function vehicleKey(carrier: string, plate: string): string {
  return `${carrier.trim()}::${normalizePlate(plate)}`
}

/** 准运证编号在同一个发证机关下不能重号：判定键 = 发证机关 + 准运证编号。 */
export function permitKey(issuer: string, permitNo: string): string {
  return `${issuer.trim()}::${permitNo.trim()}`
}

export function sameVehicle(a: AccessEntry, carrier: string, plate: string): boolean {
  return vehicleKey(a.carrier, a.plate) === vehicleKey(carrier, plate)
}

export function samePermit(a: AccessEntry, issuer: string, no: string): boolean {
  return permitKey(a.issuer, a.permitNo) === permitKey(issuer, no)
}

export type NormalizedDraft = {
  carrier: string
  plate: string
  permitNo: string
  issuer: string
  expireDate: string
  note: string
}

export function normalizeDraft(input: AccessInput): NormalizedDraft {
  return {
    carrier: input.carrier.trim(),
    plate: input.plate.trim(),
    permitNo: input.permitNo.trim(),
    issuer: input.issuer.trim(),
    expireDate: input.expireDate.trim(),
    note: (input.note ?? '').trim(),
  }
}

export type DraftCheck = {
  ok: boolean
  code: 'ok' | 'missing' | 'bad_date' | 'expired'
  message: string
}

/** 登记/补录保存前的硬校验：必填、日期合法、过期一律不允许保存。 */
export function checkDraft(
  draft: NormalizedDraft,
  asOf: string,
  opts: { allowExpired?: boolean } = {},
): DraftCheck {
  if (!draft.carrier || !draft.plate || !draft.permitNo || !draft.issuer || !draft.expireDate) {
    return { ok: false, code: 'missing', message: '承运单位、车牌、准运证编号、发证机关、到期日均为必填项' }
  }
  if (!isValidDate(draft.expireDate)) {
    return { ok: false, code: 'bad_date', message: `准运证到期日「${draft.expireDate}」不是合法日期（格式 YYYY-MM-DD）` }
  }
  if (!opts.allowExpired) {
    const verdict = judgeAccess(draft.expireDate, asOf)
    if (verdict.status === ACCESS_EXPIRED) {
      return {
        ok: false,
        code: 'expired',
        message: `准运证已于 ${draft.expireDate} 过期，过期记录不允许保存；如已换新证请按新证到期日补录`,
      }
    }
  }
  return { ok: true, code: 'ok', message: '' }
}

export function occupantText(entry: Pick<AccessEntry, 'carrier' | 'plate'>): string {
  return `承运单位「${entry.carrier}」车牌「${entry.plate}」`
}
