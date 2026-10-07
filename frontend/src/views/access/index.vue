<template>
  <section class="page" data-module="access">
    <header class="page-head">
      <div>
        <h2>收运车辆与承运单位准入台账</h2>
        <p class="page-desc">
          一个承运单位下面按收运车辆逐台登记，每台车挂准运证编号与到期日；准入结论由到期日自动判定，无需人工勾选，状态实时同步到
          <RouterLink class="inline-link" to="/weighbridge">进厂计量待核清单</RouterLink>。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记收运车辆</button>
        <button class="btn" type="button" @click="openResubmitBlank">准运证补录</button>
        <button class="btn" type="button" @click="openImport">导入历史台账</button>
        <button class="btn" type="button" @click="exportRows">导出台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.cls">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend rule-box">
      判定口径（全平台只此一份）：距到期不足十五天标「临期」，已过期的准运证不允许保存；同一台收运车辆在同一家承运单位下不能重复登记（换单位按新单位重新登记）；准运证编号在同一发证机关下不能重号。判定基准日：{{ today }}
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>承运单位</span>
        <input v-model="filters.carrier" placeholder="按承运单位检索" />
      </label>
      <label class="filter-item">
        <span>车牌</span>
        <input v-model="filters.plate" placeholder="按车牌检索" />
      </label>
      <label class="filter-item">
        <span>准运证编号</span>
        <input v-model="filters.permitNo" placeholder="按准运证编号检索" />
      </label>
      <label class="filter-item">
        <span>准入结论</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option value="有效">有效</option>
          <option value="临期">临期</option>
          <option value="已过期">已过期</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="feedback" class="feedback" :class="feedback.ok ? 'ok' : 'error-text'">
      {{ feedback.text }}
    </div>

    <div v-for="group in groups" :key="group.carrier" class="ledger-group">
      <h3 class="group-head">
        {{ group.carrier }}
        <span class="group-count">在册 {{ group.entries.length }} 台 · 有效 {{ countBy(group, '有效') }} · 临期 {{ countBy(group, '临期') }} · 过期 {{ countBy(group, '已过期') }}</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>车牌</th>
            <th>准运证编号</th>
            <th>发证机关</th>
            <th>准运证到期日</th>
            <th>准入结论</th>
            <th>准运证版本</th>
            <th>登记日期</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in group.entries" :key="String(entry.id)">
            <td>{{ entry.plate }}</td>
            <td>{{ entry.permitNo }}</td>
            <td>{{ entry.issuer }}</td>
            <td>{{ entry.expireDate }}</td>
            <td><span class="badge" :class="badgeClass(entry.status)">{{ statusText(entry) }}</span></td>
            <td>第 {{ entry.permitVersion }} 版</td>
            <td>{{ entry.registeredAt }}</td>
            <td>{{ entry.note || '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openResubmit(entry)">准运证补录</button>
              <button class="link danger" type="button" @click="remove(entry)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!groups.length" class="empty-state ledger-empty">当前条件下没有准入台账记录，可先登记收运车辆</p>

    <!-- 登记 / 补录弹窗 -->
    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ formMode === 'create' ? '登记收运车辆' : '准运证补录' }}</h3>
          <button class="link" type="button" @click="closeForm">关闭</button>
        </header>
        <form class="modal-body form-grid" @submit.prevent="submitForm">
          <label class="form-item">
            <span>承运单位 *</span>
            <input v-model="form.carrier" placeholder="如：洁城环卫运输有限公司" />
          </label>
          <label class="form-item">
            <span>收运车辆车牌 *</span>
            <input v-model="form.plate" placeholder="如：粤B·D5688" />
          </label>
          <label class="form-item">
            <span>准运证编号 *</span>
            <input v-model="form.permitNo" placeholder="如：粤环运准字2026-0117" />
          </label>
          <label class="form-item">
            <span>发证机关 *</span>
            <input v-model="form.issuer" placeholder="如：深圳市城市管理和综合执法局" />
          </label>
          <label class="form-item">
            <span>准运证到期日 *</span>
            <input v-model="form.expireDate" type="date" />
          </label>
          <label class="form-item">
            <span>备注</span>
            <input v-model="form.note" placeholder="选填" />
          </label>
          <div class="form-item form-wide verdict-preview" :class="preview ? badgeClass(preview.status) : ''">
            <template v-if="preview">
              准入结论（按到期日自动判定，不可手工勾选）：
              <strong>{{ preview.status }}</strong>
              <span v-if="preview.status === '有效'">，剩余 {{ preview.daysLeft }} 天</span>
              <span v-else-if="preview.status === '临期'">，距到期仅剩 {{ preview.daysLeft }} 天，先标临期</span>
              <span v-else>，该准运证已过期，记录不允许保存</span>
            </template>
            <span v-else class="muted">填齐承运单位、车牌、准运证编号、发证机关与到期日后自动给出结论</span>
          </div>
          <p v-if="formError" class="error-text form-wide">{{ formError }}</p>
          <div class="form-wide form-foot">
            <button class="btn primary" type="submit">{{ formMode === 'create' ? '保存登记' : '提交补录' }}</button>
            <button class="btn ghost" type="button" @click="closeForm">取消</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 历史台账导入弹窗 -->
    <div v-if="importOpen" class="modal-mask" @click.self="closeImport">
      <div class="modal modal-lg">
        <header class="modal-head">
          <h3>导入历史台账</h3>
          <button class="link" type="button" @click="closeImport">关闭</button>
        </header>
        <div class="modal-body">
          <p class="muted import-tip">
            每行一台车，逗号或制表符分隔：承运单位,车牌,准运证编号,发证机关,准运证到期日,登记日期(可空),备注(可空)。
            按各条当时登记的到期日对齐，重复导入不会多出一份；同一份文件里两台车同时补录同一张准运证，只保留先出现的那一台，后一条会写明被谁占了。历史台账中已过期的记录照单导入并自动标「已过期」。
          </p>
          <textarea v-model="importText" class="import-area" rows="9" placeholder="承运单位,车牌,准运证编号,发证机关,到期日,登记日期,备注&#10;洁城环卫运输有限公司,粤B·D5688,粤环运准字2026-0117,深圳市城市管理和综合执法局,2027-06-24,2026-01-10,主力线路"></textarea>
          <div class="form-foot">
            <button class="btn primary" type="button" @click="runImport">开始导入</button>
            <button class="btn ghost" type="button" @click="fillImportSample">填入示例</button>
          </div>
          <p v-if="importError" class="error-text">{{ importError }}</p>
          <div v-if="importReport" class="import-report">
            <h4>导入结果：共 {{ importReport.total }} 条，新增 {{ importReport.inserted }} 条，跳过 {{ importReport.skipped }} 条，拒收 {{ importReport.rejected }} 条</h4>
            <ul>
              <li v-for="detail in importReport.details" :key="detail.line" class="report-line" :class="detail.outcome">
                第{{ detail.line }}行 · {{ outcomeLabel(detail.outcome) }}：{{ detail.message }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadLedger,
  importHistory,
  ledgerStats,
  listLedger,
  registerEntry,
  removeEntry,
  resubmitPermit,
  type ImportedRow,
  type ImportReport,
} from '@/api/access-service'
import {
  ACCESS_EXPIRED,
  ACCESS_NEAR,
  ACCESS_VALID,
  judgeAccess,
  todayIso,
  type AccessEntry,
  type AccessInput,
  type AccessStatus,
} from '@/data/access-core'

const today = todayIso()
const rows = ref<AccessEntry[]>([])
const feedback = ref<{ ok: boolean; text: string } | null>(null)
const filters = ref({ carrier: '', plate: '', permitNo: '', status: '' })

const stats = computed(() => {
  const data = ledgerStats(today)
  return [
    { label: '准入车辆总数', value: data.total, cls: '' },
    { label: '有效', value: data.valid, cls: 'num-valid' },
    { label: '临期（不足十五天）', value: data.near, cls: 'num-near' },
    { label: '已过期', value: data.expired, cls: 'num-expired' },
  ]
})

const groups = computed(() => {
  const map = new Map<string, AccessEntry[]>()
  for (const entry of rows.value) {
    const list = map.get(entry.carrier) ?? []
    list.push(entry)
    map.set(entry.carrier, list)
  }
  return [...map.entries()]
    .map(([carrier, entries]) => ({
      carrier,
      entries: entries.sort((a, b) => a.plate.localeCompare(b.plate, 'zh-Hans-CN')),
    }))
    .sort((a, b) => a.carrier.localeCompare(b.carrier, 'zh-Hans-CN'))
})

function countBy(group: { entries: AccessEntry[] }, status: AccessStatus): number {
  return group.entries.filter((entry) => entry.status === status).length
}

function badgeClass(status: AccessStatus): string {
  if (status === ACCESS_VALID) {
    return 'badge-valid'
  }
  if (status === ACCESS_NEAR) {
    return 'badge-near'
  }
  return 'badge-expired'
}

function statusText(entry: AccessEntry): string {
  if (entry.status === ACCESS_EXPIRED) {
    return `已过期（${entry.expireDate} 到期）`
  }
  if (entry.status === ACCESS_NEAR) {
    return `临期（剩 ${entry.daysLeft} 天）`
  }
  return `有效（剩 ${entry.daysLeft} 天）`
}

function resetFilters() {
  filters.value = { carrier: '', plate: '', permitNo: '', status: '' }
  reload()
}

function exportRows() {
  downloadLedger(today)
}

function reload() {
  feedback.value = null
  rows.value = listLedger(filters.value, today)
}

onMounted(reload)

/* ------------------------------- 登记 / 补录 ------------------------------- */

const formOpen = ref(false)
const formMode = ref<'create' | 'resubmit'>('create')
const formError = ref('')
const form = ref<AccessInput>({ carrier: '', plate: '', permitNo: '', issuer: '', expireDate: '', note: '' })

const preview = computed(() => {
  if (!form.value.expireDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.value.expireDate)) {
    return null
  }
  return judgeAccess(form.value.expireDate, today)
})

function blankForm(): AccessInput {
  return { carrier: '', plate: '', permitNo: '', issuer: '', expireDate: '', note: '' }
}

function openCreate() {
  formMode.value = 'create'
  form.value = blankForm()
  formError.value = ''
  formOpen.value = true
}

function openResubmitBlank() {
  formMode.value = 'resubmit'
  form.value = blankForm()
  formError.value = ''
  formOpen.value = true
}

function openResubmit(entry: AccessEntry) {
  formMode.value = 'resubmit'
  form.value = {
    carrier: entry.carrier,
    plate: entry.plate,
    permitNo: entry.permitNo,
    issuer: entry.issuer,
    expireDate: entry.expireDate,
    note: entry.note,
  }
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function submitForm() {
  const result = formMode.value === 'create'
    ? registerEntry(form.value, today)
    : resubmitPermit(form.value, today)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  formOpen.value = false
  feedback.value = { ok: true, text: result.message }
  reload()
}

function remove(entry: AccessEntry) {
  const confirmed = window.confirm(`确认删除「${entry.carrier} / ${entry.plate}」的准入登记？删除后待核清单将同步变为查无准入。`)
  if (!confirmed) {
    return
  }
  const result = removeEntry(Number(entry.id), today)
  feedback.value = { ok: result.ok, text: result.message }
  reload()
}

/* -------------------------------- 历史导入 -------------------------------- */

const importOpen = ref(false)
const importText = ref('')
const importError = ref('')
const importReport = ref<ImportReport | null>(null)

function openImport() {
  importOpen.value = true
  importError.value = ''
  importReport.value = null
}

function closeImport() {
  importOpen.value = false
}

function fillImportSample() {
  importText.value = [
    '洁城环卫运输有限公司,粤B·D5690,粤环运准字2026-0063,深圳市城市管理和综合执法局,2026-10-15,2025-10-20,已在账-重复导入应跳过',
    '洁城环卫运输有限公司,粤B·D5710,粤环运准字2026-0288,深圳市城市管理和综合执法局,2027-03-01,2026-05-06,新增车辆',
    '顺通收运服务部,粤B·D7120,粤环运准字2025-0331,深圳市城市管理和综合执法局,2026-05-01,2025-05-02,历史过期证',
    '顺通收运服务部,粤B·D7121,粤环运准字2025-0331,深圳市城市管理和综合执法局,2027-05-01,2025-05-02,同一张证被上一条占了',
  ].join('\n')
}

function parseImportText(text: string): ImportedRow[] | { error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (!lines.length) {
    return { error: '导入内容为空，请先粘贴历史台账行' }
  }
  const rows: ImportedRow[] = []
  for (const line of lines) {
    const cols = line.split(/[,\t，]/).map((col) => col.trim())
    if (cols[0] === '承运单位') {
      continue
    }
    if (cols.length < 5) {
      return { error: `行列数不足（至少 5 列）：${line}` }
    }
    rows.push({
      carrier: cols[0],
      plate: cols[1],
      permitNo: cols[2],
      issuer: cols[3],
      expireDate: cols[4],
      registeredAt: cols[5] || today,
      note: cols[6] || '',
    })
  }
  if (!rows.length) {
    return { error: '未解析出有效数据行（表头行已自动跳过）' }
  }
  return rows
}

function runImport() {
  importError.value = ''
  importReport.value = null
  const parsed = parseImportText(importText.value)
  if ('error' in parsed) {
    importError.value = parsed.error
    return
  }
  importReport.value = importHistory(parsed, today)
  reload()
}

function outcomeLabel(outcome: ImportReport['details'][number]['outcome']): string {
  return { inserted: '新增', updated: '更新', skipped: '跳过', rejected: '拒收' }[outcome]
}
</script>
