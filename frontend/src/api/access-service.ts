import { accessLedger, resetAccessLedger, saveAccessLedger } from '@/data/access-store'
import type {
  AccessFormInput,
  AccessImportInput,
  AccessImportLineResult,
  AccessImportResult,
  AccessItemResult,
  AccessRecord,
  AccessStatus,
} from '@/data/access-types'

// 准入台账唯一的判定口径：
// 1) 到期日与今天相差不足 15 天（且未过期）→ 准运证临期
// 2) 到期日早于今天 → 准运证过期（登记/补录时直接不允许保存）
// 3) 其余 → 准予运输
// 状态一律由到期日现算，页面上没有人工勾选的入口。
export const NEAR_EXPIRY_DAYS = 15
export const ACCESS_STATUSES: AccessStatus[] = ['准予运输', '准运证临期', '准运证过期', '未登记准入']
export const ACCESS_COLUMNS = [
  '承运单位',
  '车牌',
  '发证机关',
  '准运证编号',
  '准运证到期日',
  '登记日期',
  '来源',
  '版本',
  '准入结论',
] as const

export type AccessView = AccessRecord & {
  daysLeft: number
  status: AccessStatus
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseDate(value: string): Date | null {
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null
  }
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function toUtcDay(now: Date | string | undefined): Date {
  if (now === undefined) {
    const current = new Date()
    return new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()))
  }
  if (now instanceof Date) {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  }
  const parsed = parseDate(now)
  if (!parsed) {
    throw new Error(`日期「${now}」无法识别，需要 YYYY-MM-DD 格式`)
  }
  return parsed
}

function daysLeftOf(expiry: string, today: Date): number {
  const expiryDate = parseDate(expiry)
  if (!expiryDate) {
    return Number.NaN
  }
  return Math.round((expiryDate.getTime() - today.getTime()) / MS_PER_DAY)
}

/** 唯一的状态推导入口：任何页面要准入结论都走这里，保证口径只有一份。 */
export function evaluateAccess(expiry: string, now: Date | string | undefined = undefined): {
  status: AccessStatus
  daysLeft: number
} {
  const today = toUtcDay(now)
  const daysLeft = daysLeftOf(expiry, today)
  if (Number.isNaN(daysLeft)) {
    throw new Error(`准运证到期日「${expiry}」无法识别`)
  }
  if (daysLeft < 0) {
    return { status: '准运证过期', daysLeft }
  }
  if (daysLeft < NEAR_EXPIRY_DAYS) {
    return { status: '准运证临期', daysLeft }
  }
  return { status: '准予运输', daysLeft }
}

function normText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

// 车牌去中点、空格并转大写：沪a·12345 与 沪A12345 视为同一台
function normPlate(value: string): string {
  return normText(value)
    .replace(/[·・.*]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

// 准运证编号去空格/连字符转大写：ZYZ-2026-0101 与 ZYZ20260101 视为同号
function normPermit(value: string): string {
  return normText(value)
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

function vehicleKey(carrier: string, plate: string): string {
  return `${normText(carrier)}@@${normPlate(plate)}`
}

function permitKey(issuer: string, permitNo: string): string {
  return `${normText(issuer)}@@${normPermit(permitNo)}`
}

function recordVehicleKey(record: AccessRecord): string {
  return vehicleKey(record.carrierName, record.plate)
}

function recordPermitKey(record: AccessRecord): string {
  return permitKey(record.permitIssuer, record.permitNo)
}

function validateBase(input: AccessFormInput, baselineLabel: string, baseline: Date): AccessItemResult | null {
  const carrierName = normText(input.carrierName)
  const plate = normText(input.plate)
  const permitIssuer = normText(input.permitIssuer)
  const permitNo = normText(input.permitNo)
  const expiryText = input.permitExpiry.trim()
  if (!carrierName || !plate || !permitIssuer || !permitNo || !expiryText) {
    return { ok: false, message: '承运单位、车牌、发证机关、准运证编号、到期日均为必填项' }
  }
  if (!parseDate(expiryText)) {
    return { ok: false, message: `准运证到期日「${expiryText}」不是有效的 YYYY-MM-DD 日期` }
  }
  const daysLeft = daysLeftOf(expiryText, baseline)
  if (daysLeft < 0) {
    return {
      ok: false,
      message: `该准运证${baselineLabel}已过期（到期日 ${expiryText}），过期记录不允许保存`,
    }
  }
  return null
}

function currentIso(at: string | undefined): string {
  if (at) {
    return at
  }
  return new Date().toISOString()
}

function toView(record: AccessRecord, today: Date): AccessView {
  const { status, daysLeft } = evaluateAccess(record.permitExpiry, today)
  return { ...record, daysLeft, status }
}

export type AccessQuery = {
  carrier?: string
  plate?: string
  permitNo?: string
  status?: AccessStatus | ''
}

export function listAccess(query: AccessQuery = {}, now: Date | string | undefined = undefined): AccessView[] {
  const today = toUtcDay(now)
  const carrier = normText(query.carrier ?? '')
  const plate = normPlate(query.plate ?? '')
  const no = normPermit(query.permitNo ?? '')
  return accessLedger()
    .records.map((record) => toView(record, today))
    .filter((item) => {
      if (carrier && !item.carrierName.includes(carrier)) return false
      if (plate && !normPlate(item.plate).includes(plate)) return false
      if (no && !normPermit(item.permitNo).includes(no)) return false
      if (query.status && item.status !== query.status) return false
      return true
    })
    .sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : a.registeredAt > b.registeredAt ? -1 : b.id - a.id))
}

export function accessStats(now: Date | string | undefined = undefined) {
  const today = toUtcDay(now)
  const records = accessLedger().records
  const views = records.map((record) => toView(record, today))
  return {
    total: records.length,
    valid: views.filter((item) => item.status === '准予运输').length,
    near: views.filter((item) => item.status === '准运证临期').length,
    expired: views.filter((item) => item.status === '准运证过期').length,
  }
}

/**
 * 窗口登记：一台车在一家承运单位下建一条准入记录。
 * - 过期准运证不允许保存
 * - 同一台车在同一家承运单位下不能重复登记（换单位按新单位重新登记，不在此放行）
 * - 准运证编号在同一发证机关下不能重号，被占用时说明被谁占了
 */
export function registerVehicle(
  input: AccessFormInput,
  options: { at?: string; now?: string } = {},
): AccessItemResult {
  const today = toUtcDay(options.now)
  const invalid = validateBase(input, '今天', today)
  if (invalid) {
    return invalid
  }
  const carrierName = normText(input.carrierName)
  const plate = normText(input.plate)
  const permitIssuer = normText(input.permitIssuer)
  const permitNo = normText(input.permitNo)
  const expiryText = input.permitExpiry.trim()

  const ledger = accessLedger()
  const sameVehicle = ledger.records.find(
    (record) => recordVehicleKey(record) === vehicleKey(carrierName, plate),
  )
  if (sameVehicle) {
    return {
      ok: false,
      message:
        `车牌 ${plate} 已登记在 ${carrierName} 名下（台账编号 #${sameVehicle.id}，准运证 ${sameVehicle.permitNo}），` +
        '同一台车在同一家承运单位下不能重复登记；换到其他承运单位请到新单位下重新登记，' +
        '同一单位准运证换证请走「准运证补录」。',
    }
  }
  const occupied = ledger.records.find(
    (record) => recordPermitKey(record) === permitKey(permitIssuer, permitNo),
  )
  if (occupied) {
    return {
      ok: false,
      message:
        `准运证 ${permitNo}（发证机关 ${permitIssuer}）已被车牌 ${occupied.plate}、` +
        `承运单位 ${occupied.carrierName}（台账编号 #${occupied.id}）占用，同一发证机关下准运证编号不能重号。`,
    }
  }

  const id = ledger.seq + 1
  const record: AccessRecord = {
    id,
    carrierName,
    plate,
    permitIssuer,
    permitNo,
    permitExpiry: expiryText,
    registeredAt: currentIso(options.at),
    source: '登记',
    version: 1,
  }
  saveAccessLedger({ seq: id, records: [...ledger.records, record] })
  return { ok: true, message: `已为 ${carrierName} 登记车辆 ${plate}（台账编号 #${id}）`, id }
}

/**
 * 准运证补录递送，以准运证（发证机关 + 编号）为口径：
 * - 同一张证重复递送：只保留一条，覆盖到期日/提交时间，版本加一，以最后一版为准
 * - 证已被别的车（含换单位后的同一车牌）占用：拒绝保存，并说明被谁占、谁先提交
 * - 证尚未占用：落到本车名下；本车在该单位下已有别的证，按换证补录处理
 * 过期准运证任何情况下都不允许保存。
 */
export function submitBackfill(
  input: AccessFormInput,
  options: { at?: string; now?: string } = {},
): AccessItemResult {
  const today = toUtcDay(options.now)
  const invalid = validateBase(input, '今天', today)
  if (invalid) {
    return invalid
  }
  const carrierName = normText(input.carrierName)
  const plate = normText(input.plate)
  const permitIssuer = normText(input.permitIssuer)
  const permitNo = normText(input.permitNo)
  const expiryText = input.permitExpiry.trim()
  const submittedAt = currentIso(options.at)

  const ledger = accessLedger()
  const index = ledger.records.findIndex(
    (record) => recordPermitKey(record) === permitKey(permitIssuer, permitNo),
  )

  // 该准运证已经有主：同一辆车重复递送 → 覆盖最后一版；别的车来递 → 说明被谁占了
  if (index >= 0) {
    const holder = ledger.records[index]
    if (recordVehicleKey(holder) !== vehicleKey(carrierName, plate)) {
      return {
        ok: false,
        message:
          `准运证 ${permitNo} 已被先提交的车牌 ${holder.plate}（承运单位 ${holder.carrierName}，` +
          `台账编号 #${holder.id}，提交时间 ${holder.registeredAt.replace('T', ' ').slice(0, 16)}）占用，` +
          '本次补录不予保存。',
      }
    }
    const nextVersion = holder.version + 1
    const updated: AccessRecord = {
      ...holder,
      permitExpiry: expiryText,
      registeredAt: submittedAt,
      source: '补录',
      version: nextVersion,
    }
    const records = [...ledger.records]
    records[index] = updated
    saveAccessLedger({ ...ledger, records })
    return {
      ok: true,
      id: holder.id,
      message: `第 ${nextVersion} 版补录已接收，台账只保留最后一版（台账编号 #${holder.id}）。`,
    }
  }

  // 证还没有主：同一台车在同一单位下已有别的证 → 换证补录；否则按补录新建一版
  const ownIndex = ledger.records.findIndex(
    (record) => recordVehicleKey(record) === vehicleKey(carrierName, plate),
  )
  if (ownIndex >= 0) {
    const own = ledger.records[ownIndex]
    const updated: AccessRecord = {
      ...own,
      permitIssuer,
      permitNo,
      permitExpiry: expiryText,
      registeredAt: submittedAt,
      source: '补录',
      version: own.version + 1,
    }
    const records = [...ledger.records]
    records[ownIndex] = updated
    saveAccessLedger({ ...ledger, records })
    return {
      ok: true,
      id: own.id,
      message: `已按补录将 ${plate} 的准运证换为 ${permitNo}，原准运证 ${own.permitNo} 被替换（台账编号 #${own.id}）。`,
    }
  }

  const id = ledger.seq + 1
  const record: AccessRecord = {
    id,
    carrierName,
    plate,
    permitIssuer,
    permitNo,
    permitExpiry: expiryText,
    registeredAt: submittedAt,
    source: '补录',
    version: 1,
  }
  saveAccessLedger({ seq: id, records: [...ledger.records, record] })
  return { ok: true, id, message: `补录已接收，${plate} 首次占用准运证 ${permitNo}（台账编号 #${id}）。` }
}

export type QueuedBackfill = AccessFormInput & { at?: string; now?: string }

/**
 * 两台车同时补录同一张证：按提交先后逐条落库，先提交的占证，后提交的被拒绝并给出占用者。
 * 队列顺序即提交顺序（同时间戳也按排队先后判定）。
 */
export function submitBackfillQueue(items: QueuedBackfill[]): AccessImportLineResult[] {
  return items.map((item, offset) => {
    const { at, now, ...input } = item
    const result = submitBackfill(input, { at, now })
    return {
      line: offset + 1,
      plate: normPlate(item.plate),
      permitNo: normText(item.permitNo),
      ok: result.ok,
      message: result.message,
      id: result.id,
    }
  })
}

/**
 * 历史台账导入：每行带「当时的登记日期」，按当时登记的到期日对齐。
 * - 以当时日期判定：那时已过期的行不入库
 * - 同一台车 + 同一家单位 + 同一发证机关 + 同一准运证编号 + 同一到期日 即同一份，重来不多建
 * - 车重 / 证重同样跳过，并说明冲突对象
 */
export function importHistory(rows: AccessImportInput[]): AccessImportResult {
  const lines: AccessImportLineResult[] = []
  let accepted = 0
  let skipped = 0

  rows.forEach((raw, offset) => {
    const line = offset + 1
    const reportPlate = normPlate(raw.plate)
    const reportPermit = normText(raw.permitNo)
    const baseDateText = raw.registeredDate.trim()
    const baseDate = parseDate(baseDateText)
    if (!baseDate) {
      skipped += 1
      lines.push({ line, plate: reportPlate, permitNo: reportPermit, ok: false, message: `登记日期「${baseDateText}」不是有效的 YYYY-MM-DD 日期，未导入` })
      return
    }
    const invalid = validateBase(raw, `在 ${baseDateText} 时`, baseDate)
    if (invalid) {
      skipped += 1
      lines.push({ line, plate: reportPlate, permitNo: reportPermit, ok: false, message: invalid.message })
      return
    }

    const carrierName = normText(raw.carrierName)
    const plate = normText(raw.plate)
    const permitIssuer = normText(raw.permitIssuer)
    const permitNo = normText(raw.permitNo)
    const expiryText = raw.permitExpiry.trim()
    const ledger = accessLedger()

    const sameTuple = ledger.records.find(
      (record) =>
        recordVehicleKey(record) === vehicleKey(carrierName, plate) &&
        recordPermitKey(record) === permitKey(permitIssuer, permitNo) &&
        record.permitExpiry === expiryText,
    )
    if (sameTuple) {
      skipped += 1
      lines.push({
        line,
        plate,
        permitNo,
        ok: true,
        id: sameTuple.id,
        message: `与台账编号 #${sameTuple.id}（到期日 ${sameTuple.permitExpiry}）一致，重复导入不另建档。`,
      })
      return
    }

    const sameVehicle = ledger.records.find(
      (record) => recordVehicleKey(record) === vehicleKey(carrierName, plate),
    )
    if (sameVehicle) {
      skipped += 1
      lines.push({
        line,
        plate,
        permitNo,
        ok: false,
        message: `车牌 ${plate} 在 ${carrierName} 名下已存在台账编号 #${sameVehicle.id}（准运证 ${sameVehicle.permitNo}），不重复建档。`,
      })
      return
    }

    const occupied = ledger.records.find(
      (record) => recordPermitKey(record) === permitKey(permitIssuer, permitNo),
    )
    if (occupied) {
      skipped += 1
      lines.push({
        line,
        plate,
        permitNo,
        ok: false,
        message:
          `准运证 ${permitNo} 已被车牌 ${occupied.plate}（${occupied.carrierName}，台账编号 #${occupied.id}）占用，该行未导入。`,
      })
      return
    }

    const id = ledger.seq + 1
    const record: AccessRecord = {
      id,
      carrierName,
      plate,
      permitIssuer,
      permitNo,
      permitExpiry: expiryText,
      registeredAt: `${baseDateText}T00:00:00.000Z`,
      source: '历史导入',
      version: 1,
    }
    saveAccessLedger({ seq: id, records: [...ledger.records, record] })
    accepted += 1
    lines.push({ line, plate, permitNo, ok: true, id, message: `已按 ${baseDateText} 登记的到期日对齐导入（台账编号 #${id}）。` })
  })

  return { accepted, skipped, lines }
}

/** 解析历史台账粘贴文本：每行 承运单位,车牌,发证机关,准运证编号,到期日,登记日期 */
export function parseImportText(text: string): AccessImportInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells = line.split(/[,，\t]/).map((cell) => cell.trim())
      return {
        carrierName: cells[0] ?? '',
        plate: cells[1] ?? '',
        permitIssuer: cells[2] ?? '',
        permitNo: cells[3] ?? '',
        permitExpiry: cells[4] ?? '',
        registeredDate: cells[5] ?? '',
      }
    })
}

/**
 * 进厂计量待核清单联动：用车牌反查当前有效的准入结论。
 * 一辆车换过单位时可能有多条，按最后一版提交时间取最新的一条；查不到即未登记准入。
 */
export function resolvePlateAccess(
  plate: string,
  now: Date | string | undefined = undefined,
): { status: AccessStatus; daysLeft: number; record: AccessView } | { status: '未登记准入' } {
  const today = toUtcDay(now)
  const key = normPlate(plate)
  const holders = accessLedger()
    .records.filter((record) => normPlate(record.plate) === key)
    .map((record) => toView(record, today))
    .sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : a.registeredAt > b.registeredAt ? -1 : b.id - a.id))
  const current = holders[0]
  if (!current) {
    return { status: '未登记准入' }
  }
  return { status: current.status, daysLeft: current.daysLeft, record: current }
}

export function resetAccess(): void {
  resetAccessLedger()
}

export function exportAccessCsv(now: Date | string | undefined = undefined): { filename: string; content: string } {
  const header = [
    '台账编号',
    '承运单位',
    '车牌',
    '发证机关',
    '准运证编号',
    '准运证到期日',
    '剩余天数',
    '准入结论',
    '来源',
    '版本',
    '最后提交时间',
  ]
  const lines = [header.join(',')]
  for (const item of listAccess({}, now)) {
    lines.push(
      [
        item.id,
        item.carrierName,
        item.plate,
        item.permitIssuer,
        item.permitNo,
        item.permitExpiry,
        item.daysLeft,
        item.status,
        item.source,
        `v${item.version}`,
        item.registeredAt.replace('T', ' ').slice(0, 16),
      ]
        .map((cell) => String(cell).replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '收运车辆与承运单位准入台账.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadAccessCsv(now: Date | string | undefined = undefined): void {
  const { filename, content } = exportAccessCsv(now)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
