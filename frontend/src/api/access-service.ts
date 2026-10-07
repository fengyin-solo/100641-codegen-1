/**
 * 收运车辆与承运单位准入台账服务：
 * - 登记 / 准运证补录 / 历史台账导入都走这一层，冲突判定只在这一层做；
 * - 准入状态按到期日实时重算，不接受人工勾选；
 * - 进厂计量待核清单的准入同步也由这里统一给出。
 */
import { listRows, saveRows } from '@/data/local-store'
import {
  ACCESS_EXPIRED,
  ACCESS_NEAR,
  ACCESS_VALID,
  checkDraft,
  judgeAccess,
  normalizeDraft,
  normalizePlate,
  occupantText,
  samePermit,
  sameVehicle,
  todayIso,
  vehicleKey,
  type AccessEntry,
  type AccessInput,
  type AccessStatus,
  type AccessView,
} from '@/data/access-core'
import type { ActionResult, EntryRow } from '@/data/types'

export const ACCESS_KEY = 'access'
const WEIGHBRIDGE_KEY = 'weighbridge'

export type LedgerStats = {
  total: number
  valid: number
  near: number
  expired: number
}

export type LedgerResult = {
  ok: boolean
  message: string
  entry?: AccessEntry
}

export type ImportedRow = {
  carrier: string
  plate: string
  permitNo: string
  issuer: string
  expireDate: string
  registeredAt: string
  note: string
}

export type ImportReport = {
  inserted: number
  updated: number
  skipped: number
  rejected: number
  total: number
  details: { line: number; outcome: 'inserted' | 'updated' | 'skipped' | 'rejected'; message: string }[]
}

function readEntries(): AccessEntry[] {
  return listRows(ACCESS_KEY) as AccessEntry[]
}

function writeEntries(entries: AccessEntry[]): void {
  saveRows(ACCESS_KEY, entries as EntryRow[])
}

function nextId(entries: AccessEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1
}

/** 按到期日把 status 重算一遍后落库：页面与看板读到的永远是最新口径。 */
function reconcile(entries: AccessEntry[], asOf: string): AccessEntry[] {
  let dirty = false
  const next = entries.map((entry) => {
    const verdict = judgeAccess(entry.expireDate, asOf)
    const pending = verdict.status !== ACCESS_VALID
    const abnormal = verdict.status === ACCESS_EXPIRED
    if (
      entry.status !== verdict.status ||
      Number(entry.daysLeft) !== verdict.daysLeft ||
      Boolean(entry.pending) !== pending ||
      Boolean(entry.abnormal) !== abnormal
    ) {
      dirty = true
      return { ...entry, status: verdict.status, daysLeft: verdict.daysLeft, pending, abnormal }
    }
    return entry
  })
  if (dirty) {
    writeEntries(next)
  }
  return next
}

/** 供其他模块（如看板汇总）在启动时触发一次状态对齐。 */
export function touchLedger(asOf: string = todayIso()): void {
  reconcile(readEntries(), asOf)
}

function load(asOf: string = todayIso()): AccessEntry[] {
  return reconcile(readEntries(), asOf)
}

export function listLedger(
  filters: { carrier?: string; plate?: string; status?: string; permitNo?: string } = {},
  asOf: string = todayIso(),
): AccessView[] {
  let rows = load(asOf)
  const carrier = filters.carrier?.trim()
  const plate = normalizePlate(filters.plate ?? '')
  const permitNo = filters.permitNo?.trim()
  const status = filters.status?.trim()
  if (carrier) {
    rows = rows.filter((entry) => entry.carrier.includes(carrier))
  }
  if (plate) {
    rows = rows.filter((entry) => normalizePlate(entry.plate).includes(plate))
  }
  if (permitNo) {
    rows = rows.filter((entry) => entry.permitNo.includes(permitNo))
  }
  if (status) {
    rows = rows.filter((entry) => entry.status === status)
  }
  return rows
}

export function ledgerStats(asOf: string = todayIso()): LedgerStats {
  const entries = load(asOf)
  return {
    total: entries.length,
    valid: entries.filter((entry) => entry.status === ACCESS_VALID).length,
    near: entries.filter((entry) => entry.status === ACCESS_NEAR).length,
    expired: entries.filter((entry) => entry.status === ACCESS_EXPIRED).length,
  }
}

type UpsertKind = '登记' | '补录'

function upsert(
  raw: AccessInput,
  kind: UpsertKind,
  asOf: string,
  opts: { registeredAt?: string; allowExpired?: boolean } = {},
): LedgerResult {
  const draft = normalizeDraft(raw)
  const check = checkDraft(draft, asOf, { allowExpired: opts.allowExpired })
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  const entries = load(asOf)
  const vehicleHit = entries.find((entry) => sameVehicle(entry, draft.carrier, draft.plate))
  const permitHit = entries.find((entry) => samePermit(entry, draft.issuer, draft.permitNo))

  if (kind === '登记') {
    // 同一台车在同一家承运单位下不能重复登记；换单位按新单位重走一版。
    if (vehicleHit) {
      return {
        ok: false,
        message: `车牌「${draft.plate}」已登记在承运单位「${draft.carrier}」名下（准运证 ${vehicleHit.permitNo}），同一台车在同一家单位下不能重复登记；若已更换承运单位，请按新单位重新登记`,
      }
    }
    // 同号准运证已挂在别的车上：后提交要说明被谁占了。
    if (permitHit) {
      return {
        ok: false,
        message: `发证机关「${draft.issuer}」下准运证编号「${draft.permitNo}」已被${occupantText(permitHit)}占用，不能重复发放`,
      }
    }
    const verdict = judgeAccess(draft.expireDate, asOf)
    const entry: AccessEntry = {
      id: nextId(entries),
      ...draft,
      status: verdict.status,
      daysLeft: verdict.daysLeft,
      pending: verdict.status !== ACCESS_VALID,
      abnormal: verdict.status === ACCESS_EXPIRED,
      registeredAt: opts.registeredAt ?? asOf,
      permitVersion: 1,
    }
    writeEntries([...entries, entry])
    return { ok: true, message: `登记成功，准入结论：${verdictLabel(entry, asOf)}`, entry }
  }

  // 补录：同一张准运证的重复递送只记一次，以最后一版为准。
  if (permitHit && !sameVehicle(permitHit, draft.carrier, draft.plate)) {
    return {
      ok: false,
      message: `发证机关「${draft.issuer}」下准运证「${draft.permitNo}」已被${occupantText(permitHit)}占用，本张准运证只保留先提交的那一台，后提交不予受理`,
    }
  }
  if (vehicleHit && permitHit && vehicleHit.id !== permitHit.id) {
    return {
      ok: false,
      message: `车牌「${draft.plate}」名下准运证与发证机关「${draft.issuer}」下编号「${draft.permitNo}」分属两条记录，请核对后再补录`,
    }
  }

  if (vehicleHit) {
    const verdict = judgeAccess(draft.expireDate, asOf)
    const samePermitResubmit = samePermit(vehicleHit, draft.issuer, draft.permitNo)
    const updated: AccessEntry = {
      ...vehicleHit,
      ...draft,
      status: verdict.status,
      daysLeft: verdict.daysLeft,
      pending: verdict.status !== ACCESS_VALID,
      abnormal: verdict.status === ACCESS_EXPIRED,
      // 同一张证重复递送：版本 +1，以最后一版为准；换了新证：从第 1 版重新计。
      permitVersion: samePermitResubmit ? Number(vehicleHit.permitVersion) + 1 : 1,
    }
    writeEntries(entries.map((entry) => (entry.id === vehicleHit.id ? updated : entry)))
    return {
      ok: true,
      message: `补录成功，已按最后一版更新${samePermitResubmit ? `（第 ${updated.permitVersion} 版）` : '（新证第 1 版）'}，准入结论：${verdictLabel(updated, asOf)}`,
      entry: updated,
    }
  }

  // 补录时该车还没登记过：直接落一版，仍要拦截准运证被别的车占用的情形（上面已拦）。
  const verdict = judgeAccess(draft.expireDate, asOf)
  const entry: AccessEntry = {
    id: nextId(entries),
    ...draft,
    status: verdict.status,
    daysLeft: verdict.daysLeft,
    pending: verdict.status !== ACCESS_VALID,
    abnormal: verdict.status === ACCESS_EXPIRED,
    registeredAt: opts.registeredAt ?? asOf,
    permitVersion: 1,
  }
  writeEntries([...entries, entry])
  return { ok: true, message: `补录成功（此前无登记，已按第 1 版落账），准入结论：${verdictLabel(entry, asOf)}`, entry }
}

export function registerEntry(input: AccessInput, asOf: string = todayIso()): LedgerResult {
  return upsert(input, '登记', asOf)
}

export function resubmitPermit(input: AccessInput, asOf: string = todayIso()): LedgerResult {
  return upsert(input, '补录', asOf)
}

export function removeEntry(id: number, asOf: string = todayIso()): ActionResult {
  const entries = load(asOf)
  if (!entries.some((entry) => Number(entry.id) === id)) {
    return { ok: false, message: `没有找到编号为 ${id} 的准入台账记录` }
  }
  writeEntries(entries.filter((entry) => Number(entry.id) !== id))
  return { ok: true, message: '台账记录已删除' }
}

function verdictLabel(entry: AccessEntry, asOf: string): string {
  if (entry.status === ACCESS_VALID) {
    return `有效（剩余 ${entry.daysLeft} 天）`
  }
  if (entry.status === ACCESS_NEAR) {
    return `临期（距到期不足十五天，剩余 ${entry.daysLeft} 天）`
  }
  return `已过期（${entry.expireDate} 到期，${asOf} 判定）`
}

/**
 * 历史台账导入：按当时登记的到期日对齐，重复导入不会多出一份。
 * allowExpired：历史数据里本就有过期证，照单收下并标「已过期」，
 * 不走「过期记录不允许保存」的人工登记闸口。
 */
export function importHistory(
  rows: ImportedRow[],
  asOf: string = todayIso(),
): ImportReport {
  const report: ImportReport = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    total: rows.length,
    details: [],
  }
  // 在本次导入内也做一次占号判断：文件里两台车同时递同一张证，只保留先出现的那一台。
  const claimedVehicles = new Set<string>()
  const claimedPermits = new Map<string, { carrier: string; plate: string; line: number }>()

  let working = load(asOf)

  rows.forEach((raw, index) => {
    const line = index + 1
    const draft = normalizeDraft(raw)
    const check = checkDraft(draft, raw.registeredAt || asOf, { allowExpired: true })
    if (!check.ok) {
      report.rejected += 1
      report.details.push({ line, outcome: 'rejected', message: check.message })
      return
    }
    // 历史台账按「当时登记的到期日」对齐：以该条登记日为基准校验日期非空合法，
    // 状态仍统一以今天为准重算；已存在的同一台车不覆盖到期日，保证重来一遍不多一份。
    const vKey = vehicleKey(draft.carrier, draft.plate)
    if (claimedVehicles.has(vKey)) {
      report.skipped += 1
      report.details.push({
        line,
        outcome: 'skipped',
        message: `同一份文件内「${draft.carrier}/${draft.plate}」已出现过，重复行只记一次`,
      })
      return
    }

    const permitHolder = claimedPermits.get(`${draft.issuer.trim()}::${draft.permitNo}`)
    const permitHitExisting = working.find((entry) => samePermit(entry, draft.issuer, draft.permitNo))
    const vehicleHit = working.find((entry) => sameVehicle(entry, draft.carrier, draft.plate))

    if (vehicleHit) {
      // 重来一遍：同一台车同一家单位已经在账，按当时登记的到期日对齐不覆盖，直接跳过。
      claimedVehicles.add(vKey)
      if (!permitHolder && !permitHitExisting) {
        claimedPermits.set(`${draft.issuer.trim()}::${draft.permitNo}`, {
          carrier: draft.carrier,
          plate: draft.plate,
          line,
        })
      }
      report.skipped += 1
      report.details.push({
        line,
        outcome: 'skipped',
        message: `${draft.carrier}/${draft.plate} 已在台账中（到期日 ${vehicleHit.expireDate}），按当时登记的到期日对齐，不重复入账`,
      })
      return
    }

    const holder = permitHolder ?? (permitHitExisting
      ? { carrier: permitHitExisting.carrier, plate: permitHitExisting.plate, line: 0 }
      : undefined)
    if (holder) {
      report.rejected += 1
      report.details.push({
        line,
        outcome: 'rejected',
        message: `准运证「${draft.issuer}/${draft.permitNo}」已被${holder.line ? `本文件第 ${holder.line} 行的` : ''}${occupantText(holder)}占用，只保留先提交的那一台`,
      })
      return
    }

    const verdict = judgeAccess(draft.expireDate, asOf)
    const entry: AccessEntry = {
      id: nextId(working),
      ...draft,
      status: verdict.status,
      daysLeft: verdict.daysLeft,
      pending: verdict.status !== ACCESS_VALID,
      abnormal: verdict.status === ACCESS_EXPIRED,
      registeredAt: raw.registeredAt || asOf,
      permitVersion: 1,
    }
    working = [...working, entry]
    claimedVehicles.add(vKey)
    claimedPermits.set(`${draft.issuer.trim()}::${draft.permitNo}`, {
      carrier: draft.carrier,
      plate: draft.plate,
      line,
    })
    report.inserted += 1
    report.details.push({
      line,
      outcome: 'inserted',
      message: `已导入：${draft.carrier}/${draft.plate}，按到期日 ${draft.expireDate} 判定为「${verdict.status}」`,
    })
  })

  writeEntries(working)
  return report
}

/* ------------------------------ 进厂待核清单同步 ------------------------------ */

export type PendingCheckRow = {
  weighId: number
  weighNo: string
  carrier: string
  plate: string
  arrivedAt: string
  matched: boolean
  ambiguous: boolean
  status: AccessStatus | '未登记'
  daysLeft: number | null
  permitNo: string
  permitVersion: number
  gateDecision: string
}

function gateDecision(status: AccessStatus | '未登记', ambiguous: boolean, daysLeft: number | null): string {
  if (ambiguous) {
    return '需人工核对承运单位'
  }
  if (status === ACCESS_VALID) {
    return daysLeft !== null && daysLeft < 15 ? '临期放行' : '放行'
  }
  if (status === ACCESS_NEAR) {
    return '临期限期'
  }
  if (status === ACCESS_EXPIRED) {
    return '禁止入厂'
  }
  return '禁止入厂（查无准入）'
}

/** 待核清单：进厂计量里还没复核过的车，按 车牌+承运单位 对齐台账，准入状态实时同步过来。 */
export function listPendingCheck(asOf: string = todayIso()): PendingCheckRow[] {
  const ledger = load(asOf)
  const weighRows = listRows(WEIGHBRIDGE_KEY)
  return weighRows
    .filter((row) => row.status !== '已复核')
    .map((row) => {
      const carrier = String(row['承运单位'] ?? row['垃圾来源'] ?? '').trim()
      const plate = String(row['进场车牌'] ?? '').trim()
      const byPlate = ledger.filter((entry) => normalizePlate(entry.plate) === normalizePlate(plate))
      let hit: AccessEntry | undefined
      let ambiguous = false
      // 报了承运单位：按「单位＋车牌」精确对齐；
      // 没报承运单位：全平台只挂一台才能直接认，同车牌挂多家单位一律算歧义。
      if (carrier) {
        hit = byPlate.find((entry) => entry.carrier.trim() === carrier)
        if (!hit && byPlate.length > 0) {
          ambiguous = true
        }
      } else if (byPlate.length === 1) {
        hit = byPlate[0]
      } else if (byPlate.length > 1) {
        ambiguous = true
      }
      const status: AccessStatus | '未登记' = hit ? hit.status : '未登记'
      const daysLeft = hit ? hit.daysLeft : null
      return {
        weighId: Number(row.id),
        weighNo: String(row['计量单号'] ?? row.id),
        carrier: carrier || (hit ? hit.carrier : ''),
        plate,
        arrivedAt: String(row['过磅时间'] ?? asOf),
        matched: Boolean(hit) && !ambiguous,
        ambiguous,
        status,
        daysLeft,
        permitNo: hit ? hit.permitNo : '',
        permitVersion: hit ? Number(hit.permitVersion) : 0,
        gateDecision: gateDecision(status, ambiguous, daysLeft),
      }
    })
}

/** 门岗登记到车：先落进厂计量待核清单，准入结论由台账同步，不由门岗填。 */
export function recordArrival(
  input: { weighNo: string; carrier: string; plate: string; arrivedAt: string },
  asOf: string = todayIso(),
): ActionResult {
  const weighNo = input.weighNo.trim()
  const carrier = input.carrier.trim()
  const plate = input.plate.trim()
  if (!weighNo || !plate) {
    return { ok: false, message: '计量单号、车牌均为必填项；承运单位记不清可先留空，由待核清单提示人工核对' }
  }
  const rows = listRows(WEIGHBRIDGE_KEY)
  if (rows.some((row) => String(row['计量单号']) === weighNo)) {
    return { ok: false, message: `计量单号「${weighNo}」已存在，请勿重复登记到车` }
  }
  const row: EntryRow = {
    id: rows.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1,
    status: '待过磅',
    pending: true,
    abnormal: false,
    计量单号: weighNo,
    进场车牌: plate,
    承运单位: carrier,
    垃圾来源: carrier,
    毛重: '',
    皮重: '',
    净重: '',
    过磅时间: input.arrivedAt || asOf,
    计量状态: '待过磅',
  }
  saveRows(WEIGHBRIDGE_KEY, [...rows, row])
  const check = listPendingCheck(asOf).find((item) => item.weighId === Number(row.id))
  return {
    ok: true,
    message: check
      ? `已进入待核清单，准入同步：${check.status === '未登记' ? '查无准入登记' : check.status}（${check.gateDecision}）`
      : '已进入待核清单',
  }
}

/* -------------------------------- 台账导出 -------------------------------- */

const EXPORT_HEADERS = [
  '编号',
  '承运单位',
  '车牌',
  '准运证编号',
  '发证机关',
  '准运证到期日',
  '准入结论',
  '剩余天数',
  '登记日期',
  '版本',
  '备注',
]

export function exportLedger(asOf: string = todayIso()): { filename: string; content: string } {
  const lines = [EXPORT_HEADERS.join(',')]
  for (const entry of listLedger({}, asOf)) {
    lines.push(
      [
        entry.id,
        entry.carrier,
        entry.plate,
        entry.permitNo,
        entry.issuer,
        entry.expireDate,
        entry.status,
        entry.daysLeft,
        entry.registeredAt,
        entry.permitVersion,
        entry.note,
      ]
        .map((value) => String(value).replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '收运车辆与承运单位准入台账.csv', content: `﻿${lines.join('\n')}` }
}


export function downloadLedger(asOf: string = todayIso()): void {
  const { filename, content } = exportLedger(asOf)
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
