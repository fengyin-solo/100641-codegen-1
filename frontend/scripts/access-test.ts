/**
 * 判定口径与冲突规则的自测：不依赖浏览器，用内存仓储跑 access-service。
 * 运行：npm run test:access（esbuild 即时打包后用 node 执行）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const SRC_DIR = resolve(process.cwd(), 'src')

const AS_OF = '2026-10-07'
let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`  ✗ ${message}`)
  }
}

// access-service 依赖浏览器 localStorage 的 local-store，用虚拟模块替成内存版，
// 被测的业务逻辑（access-core + access-service）保持为仓库里的真代码。
async function compileService() {
  const virtualStore = `
    const memory = new Map()
    export function listRows(key) { return memory.get(key) ?? [] }
    export function saveRows(key, rows) { memory.set(key, rows) }
    export function resetRows(key) { memory.delete(key); return [] }
    export function allRows() { return Object.fromEntries(memory) }
  `
  const dir = mkdtempSync(join(tmpdir(), 'access-test-'))
  const outfile = join(dir, 'service.mjs')
  await build({
    entryPoints: [join(process.cwd(), 'src/api/access-service.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    absWorkingDir: process.cwd(),
    plugins: [
      {
        name: 'at-alias',
        setup(pluginBuild) {
          // 唯一的浏览器依赖（localStorage 仓储）换成内存版；其余 @/ 别名落到 src 下。
          pluginBuild.onResolve({ filter: /^@\/data\/local-store$/ }, () => ({
            path: 'memory-local-store',
            namespace: 'virtual-store',
          }))
          pluginBuild.onLoad({ filter: /^memory-local-store$/, namespace: 'virtual-store' }, () => ({
            contents: virtualStore,
            resolveDir: process.cwd(),
          }))
          pluginBuild.onResolve({ filter: /^@\// }, (args) => ({
            path: join(SRC_DIR, `${args.path.slice(2)}.ts`),
          }))
        },
      },
    ],
  })
  const code = pathToFileURL(outfile).href
  return {
    service: await import(code),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

async function run() {
  const { service, cleanup } = await compileService()

  try {
    // 1) 判定口径边界：0~14 天临期，过期禁存
    const expired = service.registerEntry(
      { carrier: '甲公司', plate: '粤B11111', permitNo: 'P-1', issuer: '局A', expireDate: '2026-10-06' },
      AS_OF,
    )
    assert(!expired.ok && expired.message.includes('过期'), '过期一天的准运证不允许保存')

    const exactToday = service.registerEntry(
      { carrier: '甲公司', plate: '粤B11111', permitNo: 'P-1', issuer: '局A', expireDate: AS_OF },
      AS_OF,
    )
    assert(exactToday.ok, '到期日当天可保存（剩余0天，标临期）')
    assert(exactToday.entry.status === '临期' && exactToday.entry.daysLeft === 0, '到期日当天为临期/剩余0天')

    const fourteenDays = service.registerEntry(
      { carrier: '甲公司', plate: '粤B22222', permitNo: 'P-2', issuer: '局A', expireDate: '2026-10-21' },
      AS_OF,
    )
    assert(fourteenDays.entry.status === '临期' && fourteenDays.entry.daysLeft === 14, '剩14天为临期（不足十五天）')

    const fifteenDays = service.registerEntry(
      { carrier: '甲公司', plate: '粤B33333', permitNo: 'P-3', issuer: '局A', expireDate: '2026-10-22' },
      AS_OF,
    )
    assert(fifteenDays.entry.status === '有效' && fifteenDays.entry.daysLeft === 15, '正好剩15天为有效')

    // 2) 同一台车同一家单位不能重复登记（车牌标点归一）
    const dupVehicle = service.registerEntry(
      { carrier: '甲公司', plate: '粤B·33333', permitNo: 'P-9', issuer: '局A', expireDate: '2027-01-01' },
      AS_OF,
    )
    assert(!dupVehicle.ok && dupVehicle.message.includes('不能重复登记'), '同车牌（标点归一）同单位重复登记被拒')

    // 3) 换单位按新单位重新走一版：允许
    const switchCarrier = service.registerEntry(
      { carrier: '乙公司', plate: '粤B33333', permitNo: 'P-30', issuer: '局A', expireDate: '2027-02-01' },
      AS_OF,
    )
    assert(switchCarrier.ok, '同一台车换承运单位可按新单位重新登记')

    // 4) 准运证编号同一发证机关不能重号；不同机关同号允许
    const dupPermit = service.registerEntry(
      { carrier: '乙公司', plate: '粤B44444', permitNo: 'P-3', issuer: '局A', expireDate: '2027-03-01' },
      AS_OF,
    )
    assert(!dupPermit.ok && dupPermit.message.includes('粤B33333'), '同号准运证被占用时要说明被谁占了')
    const otherIssuer = service.registerEntry(
      { carrier: '乙公司', plate: '粤B44444', permitNo: 'P-3', issuer: '局B', expireDate: '2027-03-01' },
      AS_OF,
    )
    assert(otherIssuer.ok, '同编号不同发证机关允许并存')

    // 5) 补录：同一张证重复递送只记一次、以最后一版为准（版本递增）
    const resubmit = service.resubmitPermit(
      { carrier: '甲公司', plate: '粤B22222', permitNo: 'P-2', issuer: '局A', expireDate: '2027-12-31' },
      AS_OF,
    )
    assert(resubmit.ok && resubmit.entry.permitVersion === 2, '同证补录版本到第2版')
    assert(resubmit.entry.expireDate === '2027-12-31' && resubmit.entry.status === '有效', '补录以最后一版到期日为准')
    const ledgerAfter = service.listLedger({ plate: '粤B22222' }, AS_OF)
    assert(ledgerAfter.length === 1, '同证补录不新增记录，只保留一条')

    // 换了新证：版本重新从 1 计
    const newPermit = service.resubmitPermit(
      { carrier: '甲公司', plate: '粤B22222', permitNo: 'P-2-NEW', issuer: '局A', expireDate: '2028-01-01' },
      AS_OF,
    )
    assert(newPermit.entry.permitVersion === 1, '补录换新证后版本重新计为1')

    // 6) 两台车同时补录同一张证：只保留先提交的
    service.registerEntry(
      { carrier: '丙公司', plate: '粤B55555', permitNo: 'P-SAME', issuer: '局A', expireDate: '2027-05-01' },
      AS_OF,
    )
    const second = service.resubmitPermit(
      { carrier: '丙公司', plate: '粤B66666', permitNo: 'P-SAME', issuer: '局A', expireDate: '2027-05-01' },
      AS_OF,
    )
    assert(!second.ok && second.message.includes('粤B55555'), '后提交同号证被拒并说明被先提交的谁占用')

    // 7) 历史台账导入：幂等 + 按当时到期日对齐 + 文件内占号
    const history = [
      // 已在账的车：跳过，不覆盖到期日，不多一份
      { carrier: '甲公司', plate: '粤B33333', permitNo: 'P-3', issuer: '局A', expireDate: '2025-01-01', registeredAt: '2024-01-01', note: '重复导入' },
      // 新增一条 2025 年已过期的历史证：照单导入标过期
      { carrier: '丁公司', plate: '粤B77777', permitNo: 'P-OLD', issuer: '局A', expireDate: '2025-01-01', registeredAt: '2024-06-01', note: '历史过期' },
      // 文件内两台车同时递同一张证：先到保留，后到拒收并写明被谁占
      { carrier: '丁公司', plate: '粤B88888', permitNo: 'P-DUP', issuer: '局A', expireDate: '2027-06-01', registeredAt: '2026-01-01', note: '先到' },
      { carrier: '丁公司', plate: '粤B99999', permitNo: 'P-DUP', issuer: '局A', expireDate: '2027-06-01', registeredAt: '2026-01-02', note: '后到' },
    ]
    const report1 = service.importHistory(history, AS_OF)
    assert(
      report1.inserted === 2 && report1.skipped === 1 && report1.rejected === 1,
      `首次导入 2增1跳1拒，实际：${JSON.stringify(report1.details.map((d: { outcome: string }) => d.outcome))}`,
    )
    const dupLine = report1.details.find((d: { outcome: string }) => d.outcome === 'rejected')
    assert(Boolean(dupLine && dupLine.message.includes('粤B88888')), '导入拒收说明被先提交的那台车占用')
    const oldEntry = service.listLedger({ plate: '粤B77777' }, AS_OF)[0]
    assert(oldEntry.status === '已过期', '历史过期证照单导入并自动标已过期')

    const report2 = service.importHistory(history, AS_OF)
    assert(
      report2.inserted === 0 && report2.skipped === 3 && report2.rejected === 1,
      `重来一遍不多一份（3 条已在账全部跳过），实际：${JSON.stringify(report2.details.map((d: { outcome: string }) => d.outcome))}`,
    )
    const untouched = service.listLedger({ plate: '粤B33333' }, AS_OF)[0]
    assert(untouched.expireDate === '2026-10-22', '重复导入按当时到期日对齐，不覆盖台账到期日')

    // 8) 待核清单同步
    const arrival = service.recordArrival(
      { weighNo: 'W-1', carrier: '甲公司', plate: '粤B22222', arrivedAt: AS_OF },
      AS_OF,
    )
    assert(arrival.ok, '门岗登记到车成功')
    const row = service.listPendingCheck(AS_OF).find((item: { weighNo: string }) => item.weighNo === 'W-1')
    assert(row && row.status === '有效' && row.permitNo === 'P-2-NEW', '待核清单实时同步台账准入状态（补录后的新证）')
    const arrivalDup = service.recordArrival(
      { weighNo: 'W-1', carrier: '甲公司', plate: '粤B22222', arrivedAt: AS_OF },
      AS_OF,
    )
    assert(!arrivalDup.ok, '同计量单号重复到车被拦截')

    // 未登记车辆：查无准入，禁止入厂
    service.recordArrival({ weighNo: 'W-2', carrier: '庚公司', plate: '粤B00000', arrivedAt: AS_OF }, AS_OF)
    const unknown = service.listPendingCheck(AS_OF).find((item: { weighNo: string }) => item.weighNo === 'W-2')
    assert(unknown && unknown.status === '未登记' && unknown.gateDecision.includes('禁止'), '查无准入登记的车禁止入厂')

    // 同车牌两家单位且没报承运单位：歧义需人工核对
    service.recordArrival({ weighNo: 'W-3', carrier: '', plate: '粤B33333', arrivedAt: AS_OF }, AS_OF)
    const ambiguous = service.listPendingCheck(AS_OF).find((item: { weighNo: string }) => item.weighNo === 'W-3')
    assert(ambiguous && ambiguous.ambiguous && ambiguous.gateDecision.includes('人工核对'), '同车牌挂两家单位时提示人工核对')
  } finally {
    cleanup()
  }

  console.log(`准入台账自测：${passed} 通过，${failed} 失败`)
  if (failed > 0) {
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
