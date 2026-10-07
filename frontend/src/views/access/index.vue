<template>
  <section class="page" data-module="access">
    <header class="page-head">
      <div>
        <h2>收运车辆与承运单位准入台账</h2>
        <p class="page-desc">
          一家承运单位下按收运车辆逐台登记，每台车挂准运证编号与到期日；准入结论只由到期日自动判定
          （不足 15 天临期，过期不允许保存），不做人工勾选。状态实时同步到
          <RouterLink to="/weighbridge">进厂计量待核清单</RouterLink>。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportCsv">导出台账 CSV</button>
        <button class="btn ghost" type="button" @click="resetLedger">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册收运车辆</span>
        <strong class="stat-value">{{ stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">准予运输</span>
        <strong class="stat-value ok">{{ stats.valid }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">准运证临期（不足 15 天）</span>
        <strong class="stat-value near">{{ stats.near }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">准运证过期（历史留存）</span>
        <strong class="stat-value expired">{{ stats.expired }}</strong>
      </article>
    </div>

    <div class="grid-2">
      <!-- 窗口登记 -->
      <form class="panel" @submit.prevent="doRegister">
        <h3 class="panel-title">① 车辆准入登记</h3>
        <p class="panel-hint">同车同单位不能重复登记；准运证在同一发证机关下不能重号；换单位请在新单位下重新登记。</p>
        <label class="form-item"><span>承运单位</span><input v-model="registerForm.carrierName" placeholder="如：绿源运输有限公司" /></label>
        <label class="form-item"><span>收运车辆车牌</span><input v-model="registerForm.plate" placeholder="如：沪A·12345" /></label>
        <label class="form-item"><span>发证机关</span><input v-model="registerForm.permitIssuer" placeholder="如：上海市绿化和市容管理局" /></label>
        <label class="form-item"><span>准运证编号</span><input v-model="registerForm.permitNo" placeholder="如：ZYZ-2026-0101" /></label>
        <label class="form-item">
          <span>准运证到期日</span>
          <input v-model="registerForm.permitExpiry" type="date" />
        </label>
        <p class="preview" v-if="registerPreview">
          按当前到期日预判：<span class="status-tag" :class="registerPreview.cls">{{ registerPreview.text }}</span>
        </p>
        <button class="btn primary" type="submit">保存登记</button>
        <p v-if="registerMsg" class="form-msg" :class="registerOk ? 'ok-text' : 'error-text'">{{ registerMsg }}</p>
      </form>

      <!-- 准运证补录 -->
      <form class="panel" @submit.prevent="doBackfill">
        <h3 class="panel-title">② 准运证补录递送</h3>
        <p class="panel-hint">同一张证重复递送只记一次、以最后一版为准（版本加一）；证已被别的车先提交占用时不予保存。</p>
        <label class="form-item"><span>承运单位</span><input v-model="backfillForm.carrierName" /></label>
        <label class="form-item"><span>收运车辆车牌</span><input v-model="backfillForm.plate" /></label>
        <label class="form-item"><span>发证机关</span><input v-model="backfillForm.permitIssuer" /></label>
        <label class="form-item"><span>准运证编号</span><input v-model="backfillForm.permitNo" /></label>
        <label class="form-item"><span>准运证到期日（最新版）</span><input v-model="backfillForm.permitExpiry" type="date" /></label>
        <div class="btn-row">
          <button class="btn primary" type="submit">递送补录</button>
          <button class="btn" type="button" @click="enqueueBackfill">加入同时递送队列</button>
        </div>
        <p v-if="backfillMsg" class="form-msg" :class="backfillOk ? 'ok-text' : 'error-text'">{{ backfillMsg }}</p>
      </form>
    </div>

    <!-- 并发同证补录演示 -->
    <section class="panel">
      <h3 class="panel-title">③ 两台车同时补录同一张准运证</h3>
      <p class="panel-hint">
        按入队先后视为提交先后：先提交的车辆占用该准运证，后提交的被拒绝并说明被谁占用。
        同一台车重复递送则按「最后一版」覆盖。
      </p>
      <table class="data-table queue-table">
        <thead>
          <tr><th>顺序</th><th>承运单位</th><th>车牌</th><th>发证机关</th><th>准运证编号</th><th>到期日</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, idx) in queue" :key="idx">
            <td>{{ idx + 1 }}</td>
            <td><input v-model="item.carrierName" /></td>
            <td><input v-model="item.plate" /></td>
            <td><input v-model="item.permitIssuer" /></td>
            <td><input v-model="item.permitNo" /></td>
            <td><input v-model="item.permitExpiry" type="date" /></td>
            <td><button class="link" type="button" @click="queue.splice(idx, 1)">移出队列</button></td>
          </tr>
          <tr v-if="!queue.length">
            <td colspan="7" class="empty-state">队列为空，可用②中的「加入同时递送队列」添加，或载入下方并发样例</td>
          </tr>
        </tbody>
      </table>
      <div class="btn-row">
        <button class="btn" type="button" @click="loadRaceSample">载入并发样例（两新车同抢一张证）</button>
        <button class="btn primary" type="button" :disabled="!queue.length" @click="runQueue">按队列顺序逐条提交</button>
        <button class="btn ghost" type="button" @click="queue = []">清空队列</button>
      </div>
      <ul v-if="queueResults.length" class="result-list">
        <li v-for="line in queueResults" :key="line.line" :class="line.ok ? 'ok-text' : 'error-text'">
          第 {{ line.line }} 条 · {{ line.plate }} · {{ line.permitNo }}：{{ line.message }}
        </li>
      </ul>
    </section>

    <!-- 历史台账导入 -->
    <section class="panel">
      <h3 class="panel-title">④ 历史台账导入（按当时登记的到期日对齐）</h3>
      <p class="panel-hint">
        每行：承运单位,车牌,发证机关,准运证编号,准运证到期日,当时的登记日期。
        在登记日期当天已过期的行不入库；同一份记录（车 + 单位 + 证 + 到期日）重来不会多建一条。
      </p>
      <textarea v-model="importText" class="import-box" rows="6"
        placeholder="绿源运输有限公司,沪G·78901,上海市绿化和市容管理局,ZYZ-2025-0901,2026-08-31,2025-09-01"></textarea>
      <div class="btn-row">
        <button class="btn" type="button" @click="loadImportSample">载入历史样例</button>
        <button class="btn primary" type="button" @click="doImport">执行导入</button>
        <button class="btn ghost" type="button" @click="importText = ''">清空文本</button>
      </div>
      <p v-if="importSummary" class="form-msg" :class="importProblem ? 'error-text' : 'ok-text'">{{ importSummary }}</p>
      <ul v-if="importResults.length" class="result-list">
        <li v-for="line in importResults" :key="line.line" :class="line.ok ? 'ok-text' : 'error-text'">
          第 {{ line.line }} 行 · {{ line.plate || '（车牌缺失）' }} · {{ line.permitNo || '（证号缺失）' }}：{{ line.message }}
        </li>
      </ul>
    </section>

    <!-- 台账清单 -->
    <section class="panel">
      <h3 class="panel-title">准入台账清单</h3>
      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item"><span>承运单位</span><input v-model="query.carrier" placeholder="按承运单位检索" /></label>
        <label class="filter-item"><span>车牌</span><input v-model="query.plate" placeholder="按车牌检索" /></label>
        <label class="filter-item"><span>准运证编号</span><input v-model="query.permitNo" placeholder="按证号检索" /></label>
        <label class="filter-item">
          <span>准入结论</span>
          <select v-model="query.status">
            <option value="">全部</option>
            <option v-for="status in ACCESS_STATUSES" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetQuery">重置</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>承运单位</th>
            <th>车牌</th>
            <th>发证机关</th>
            <th>准运证编号</th>
            <th>到期日</th>
            <th>剩余</th>
            <th>来源/版本</th>
            <th>最后提交</th>
            <th>准入结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td>#{{ item.id }}</td>
            <td>{{ item.carrierName }}</td>
            <td>{{ item.plate }}</td>
            <td>{{ item.permitIssuer }}</td>
            <td>{{ item.permitNo }}</td>
            <td>{{ item.permitExpiry }}</td>
            <td :class="daysClass(item.status)">{{ item.daysLeft }} 天</td>
            <td>{{ item.source }} · v{{ item.version }}</td>
            <td class="muted">{{ item.registeredAt.replace('T', ' ').slice(0, 16) }}</td>
            <td><span class="status-tag" :class="statusClass(item.status)">{{ item.status }}</span></td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="10" class="empty-state">没有符合条件的准入记录</td>
          </tr>
        </tbody>
      </table>
      <p class="panel-hint">
        判定口径：过期（剩余为负）的新记录在保存环节即被拒绝，已落库的历史记录状态随当前日期自动转为「准运证过期」。
      </p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  ACCESS_STATUSES,
  downloadAccessCsv,
  evaluateAccess,
  importHistory,
  listAccess,
  parseImportText,
  registerVehicle,
  resetAccess,
  accessStats,
  submitBackfill,
  submitBackfillQueue,
} from '@/api/access-service'
import type { AccessFormInput, AccessImportLineResult, AccessStatus } from '@/data/access-types'
import type { AccessView } from '@/api/access-service'

const emptyForm = (): AccessFormInput => ({
  carrierName: '',
  plate: '',
  permitIssuer: '',
  permitNo: '',
  permitExpiry: '',
})

const rows = ref<AccessView[]>([])
const stats = ref(accessStats())
const query = reactive<{ carrier: string; plate: string; permitNo: string; status: AccessStatus | '' }>({
  carrier: '',
  plate: '',
  permitNo: '',
  status: '',
})

// ① 登记
const registerForm = reactive<AccessFormInput>(emptyForm())
const registerMsg = ref('')
const registerOk = ref(false)
const registerPreview = computed(() => {
  if (!registerForm.permitExpiry) {
    return null
  }
  try {
    const { status, daysLeft } = evaluateAccess(registerForm.permitExpiry)
    if (status === '准运证过期') {
      return { cls: 'tag-expired', text: `${status}（已过 ${Math.abs(daysLeft)} 天，保存会被拒绝）` }
    }
    if (status === '准运证临期') {
      return { cls: 'tag-near', text: `${status}（还剩 ${daysLeft} 天）` }
    }
    return { cls: 'tag-ok', text: `${status}（还剩 ${daysLeft} 天）` }
  } catch {
    return { cls: 'tag-missing', text: '到期日无效' }
  }
})

function doRegister() {
  const result = registerVehicle({ ...registerForm })
  registerOk.value = result.ok
  registerMsg.value = result.message
  if (result.ok) {
    Object.assign(registerForm, emptyForm())
    reload()
  }
}

// ② 补录
const backfillForm = reactive<AccessFormInput>(emptyForm())
const backfillMsg = ref('')
const backfillOk = ref(false)

function doBackfill() {
  const result = submitBackfill({ ...backfillForm })
  backfillOk.value = result.ok
  backfillMsg.value = result.message
  if (result.ok) {
    Object.assign(backfillForm, emptyForm())
    reload()
  }
}

// ③ 并发同证
type QueueItem = AccessFormInput
const queue = ref<QueueItem[]>([])
const queueResults = ref<AccessImportLineResult[]>([])

function enqueueBackfill() {
  if (!backfillForm.carrierName || !backfillForm.plate || !backfillForm.permitIssuer || !backfillForm.permitNo || !backfillForm.permitExpiry) {
    backfillOk.value = false
    backfillMsg.value = '补录信息不完整，无法加入队列'
    return
  }
  queue.value.push({ ...backfillForm })
  backfillOk.value = true
  backfillMsg.value = `已加入队列，当前队列 ${queue.value.length} 条`
}

function loadRaceSample() {
  queue.value = [
    {
      carrierName: '新城清运有限公司',
      plate: '沪H·80001',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2026-9001',
      permitExpiry: '2027-06-30',
    },
    {
      carrierName: '新城清运有限公司',
      plate: '沪H·80002',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2026-9001',
      permitExpiry: '2027-06-30',
    },
  ]
  queueResults.value = []
}

function runQueue() {
  queueResults.value = submitBackfillQueue(queue.value.map((item) => ({ ...item })))
  reload()
}

// ④ 历史导入
const importText = ref('')
const importResults = ref<AccessImportLineResult[]>([])
const importSummary = ref('')
const importProblem = ref(false)

function loadImportSample() {
  importText.value = [
    // 当时（2025-11-20）未过期 → 导入，今天看已是过期留存
    '洁城环境服务有限公司,沪J·90001,上海市绿化和市容管理局,ZYZ-2025-0601,2026-03-31,2025-10-15',
    // 当时就已过期 → 拒绝
    '洁城环境服务有限公司,沪J·90002,上海市绿化和市容管理局,ZYZ-2024-0009,2025-06-30,2025-10-15',
    // 正常历史记录
    '环联物流有限公司,沪K·10008,浦东新区城管执法局,PD-2025-0210,2027-01-31,2025-12-01',
    // 与种子中 #5 完全同一份（同车同单位同证同到期日）→ 跳过，不多建
    '环联物流有限公司,沪E·56789,浦东新区城管执法局,PD-2026-0312,2026-10-18,2025-12-10',
  ].join('\n')
  importResults.value = []
  importSummary.value = ''
}

function doImport() {
  const parsed = parseImportText(importText.value)
  if (!parsed.length) {
    importProblem.value = true
    importSummary.value = '没有可导入的行'
    return
  }
  const result = importHistory(parsed)
  importResults.value = result.lines
  importProblem.value = result.skipped > 0
  importSummary.value = `导入完成：接收 ${result.accepted} 行，跳过 ${result.skipped} 行；同样的历史表再导一遍不会多出一份。`
  reload()
}

function statusClass(status: AccessStatus): string {
  if (status === '准予运输') return 'tag-ok'
  if (status === '准运证临期') return 'tag-near'
  if (status === '准运证过期') return 'tag-expired'
  return 'tag-missing'
}

function daysClass(status: AccessStatus): string {
  if (status === '准予运输') return 'ok-text'
  if (status === '准运证临期') return 'near-text'
  return 'error-text'
}

function resetQuery() {
  query.carrier = ''
  query.plate = ''
  query.permitNo = ''
  query.status = ''
  reload()
}

function exportCsv() {
  downloadAccessCsv()
}

function resetLedger() {
  resetAccess()
  reload()
  registerMsg.value = '已恢复为示例数据'
  registerOk.value = true
}

function reload() {
  rows.value = listAccess({
    carrier: query.carrier,
    plate: query.plate,
    permitNo: query.permitNo,
    status: query.status,
  })
  stats.value = accessStats()
}

onMounted(reload)
</script>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.panel-title { margin: 0 0 4px; font-size: 15px; }
.panel-hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.form-item { display: block; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.form-item span { display: block; margin-bottom: 2px; }
.form-item input,
.filter-item input,
.filter-item select,
.queue-table input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.form-msg { font-size: 12px; margin: 8px 0 0; }
.ok-text { color: #1a7f37; }
.error-text { color: #b42318; }
.near-text { color: #9a6700; }
.muted { color: var(--muted); }
.preview { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.import-box {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  resize: vertical;
}
.result-list {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.queue-table input { min-width: 110px; }
.stat-value.ok { color: #1a7f37; }
.stat-value.near { color: #9a6700; }
.stat-value.expired { color: #b42318; }
.status-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.tag-ok { background: #e7f6ec; color: #1a7f37; }
.tag-near { background: #fdf1d6; color: #9a6700; }
.tag-expired { background: #fde7e5; color: #b42318; }
.tag-missing { background: #e5e7eb; color: #475569; }
</style>
