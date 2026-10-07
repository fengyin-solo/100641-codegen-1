<template>
  <section class="page" data-module="weighbridge">
    <header class="page-head">
      <div>
        <h2>垃圾进厂计量管理</h2>
        <p class="page-desc">维护进厂计量单，围绕计量单号、进场车牌、垃圾来源、毛重做登记、筛选与状态流转；待过磅车辆的准入结论由收运车辆准入台账实时同步。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/access">前往准入台账</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出垃圾进厂计量清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="sub-head">进厂待核清单（准入结论实时同步自准入台账）</h3>
    <table class="data-table pending-table">
      <thead>
        <tr>
          <th>计量单号</th>
          <th>进场车牌</th>
          <th>垃圾来源</th>
          <th>到厂时间</th>
          <th>承运单位</th>
          <th>准运证编号</th>
          <th>准入结论</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pendingRows" :key="String(row.id)">
          <td>{{ row['计量单号'] }}</td>
          <td>{{ row['进场车牌'] }}</td>
          <td>{{ row['垃圾来源'] }}</td>
          <td>{{ row['过磅时间'] }}</td>
          <template v-if="cellsOf(row).status !== '未登记准入'">
            <td>{{ cellsOf(row).carrier }}</td>
            <td>{{ cellsOf(row).permit }}（{{ cellsOf(row).issuer }}）</td>
            <td>
              <span class="status-tag" :class="statusClass(cellsOf(row).status)">{{ cellsOf(row).status }}</span>
              <span class="days-hint">（剩余 {{ cellsOf(row).daysLeft }} 天，{{ cellsOf(row).source }} v{{ cellsOf(row).version }}）</span>
            </td>
          </template>
          <template v-else>
            <td colspan="2" class="error-text">准入台账查无此车，准入判定未同步</td>
            <td>
              <span class="status-tag tag-missing">{{ cellsOf(row).status }}</span>
            </td>
          </template>
        </tr>
        <tr v-if="!pendingRows.length">
          <td colspan="7" class="empty-state">当前没有待过磅车辆</td>
        </tr>
      </tbody>
    </table>
    <p class="status-legend">
      <span class="legend-item">待核 {{ pendingRows.length }} 台</span>
      <span v-for="item in accessSummary" :key="item.status" class="legend-item" :class="item.className">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item note">准入口径只有一份：临期阈值 15 天，状态随到期日自动重算，过期车辆不允许进厂过磅。</span>
    </p>

    <p class="status-legend all-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>准入结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="status-tag" :class="statusClass(accessOf(row).status)">{{ accessOf(row).status }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无垃圾进厂计量数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾进厂计量记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { resolvePlateAccess } from '@/api/access-service'
import type { AccessStatus } from '@/data/access-types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('weighbridge')
const columns = ["计量单号", "进场车牌", "垃圾来源", "毛重", "皮重", "净重", "过磅时间", "计量状态"]
const actions = ["提交过磅", "确认复核", "标记异常"]
const statuses = ["待过磅", "已过磅", "已复核", "数据异常"]
const stats = ref([
  { label: "待过磅车辆", value: 0 },
  { label: "已复核计量单", value: 0 },
  { label: "数据异常单", value: 0 },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const pendingRows = computed(() => rows.value.filter((row) => String(row.status) === '待过磅'))

type AccessView = ReturnType<typeof resolvePlateAccess>
function accessOf(row: EntryRow): AccessView {
  return resolvePlateAccess(String(row['进场车牌'] ?? ''))
}

// 模板用的扁平化视图：把「未登记准入」与有记录两种结果拉平，避免模板里做联合类型收窄
type PendingCell = {
  status: AccessStatus
  carrier: string
  issuer: string
  permit: string
  daysLeft: number | string
  source: string
  version: number | string
}
function cellsOf(row: EntryRow): PendingCell {
  const access = accessOf(row)
  if (access.status === '未登记准入') {
    return { status: '未登记准入', carrier: '', issuer: '', permit: '', daysLeft: '—', source: '', version: '—' }
  }
  return {
    status: access.status,
    carrier: access.record.carrierName,
    issuer: access.record.permitIssuer,
    permit: access.record.permitNo,
    daysLeft: access.daysLeft,
    source: access.record.source,
    version: access.record.version,
  }
}

function statusClass(status: AccessStatus): string {
  if (status === '准予运输') return 'tag-ok'
  if (status === '准运证临期') return 'tag-near'
  if (status === '准运证过期') return 'tag-expired'
  return 'tag-missing'
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const accessSummary = computed(() => {
  const counts: { status: AccessStatus; count: number; className: string }[] = [
    { status: '准予运输', count: 0, className: 'tag-ok-bg' },
    { status: '准运证临期', count: 0, className: 'tag-near-bg' },
    { status: '准运证过期', count: 0, className: 'tag-expired-bg' },
    { status: '未登记准入', count: 0, className: 'tag-missing-bg' },
  ]
  for (const row of pendingRows.value) {
    const item = counts.find((entry) => entry.status === accessOf(row).status)
    if (item) {
      item.count += 1
    }
  }
  return counts
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: '待过磅车辆', value: rows.value.filter((row) => String(row.status) === '待过磅').length },
      { label: '已复核计量单', value: rows.value.filter((row) => String(row.status) === '已复核').length },
      { label: '数据异常单', value: rows.value.filter((row) => String(row.status) === '数据异常').length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '垃圾进厂计量列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.sub-head {
  margin: 8px 0 8px;
  font-size: 15px;
}
.pending-table td,
.pending-table th {
  font-size: 13px;
}
.days-hint {
  color: var(--muted);
  font-size: 12px;
  margin-left: 4px;
}
.all-legend {
  margin-top: 10px;
}
.legend-item.note {
  background: #eef6ff;
  color: #355a86;
}
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
.tag-ok-bg { background: #e7f6ec; color: #1a7f37; }
.tag-near-bg { background: #fdf1d6; color: #9a6700; }
.tag-expired-bg { background: #fde7e5; color: #b42318; }
.tag-missing-bg { background: #e5e7eb; color: #475569; }
</style>
