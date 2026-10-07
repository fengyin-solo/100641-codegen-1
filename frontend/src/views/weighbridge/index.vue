<template>
  <section class="page" data-module="weighbridge">
    <header class="page-head">
      <div>
        <h2>垃圾进厂计量管理</h2>
        <p class="page-desc">维护进厂计量单，围绕计量单号、进场车牌、垃圾来源、毛重做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记进厂计量单</button>
        <button class="btn" type="button" @click="exportRows">导出垃圾进厂计量清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无垃圾进厂计量数据，可先登记进厂计量单</td>
        </tr>
      </tbody>
    </table>

    <section class="pending-section">
      <header class="section-head">
        <div>
          <h3>进厂待核清单（准入状态同步）</h3>
          <p class="page-desc">承运单位换得勤时，门岗按车牌在准入台账里核对：准入结论由台账到期日自动算出后同步到这里，门岗不手工填。已复核的车自动离开本清单。</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" type="button" @click="openArrival">门岗登记到车</button>
          <button class="btn" type="button" @click="reloadPending">重新同步准入状态</button>
        </div>
      </header>

      <form class="filter-bar" @submit.prevent="reloadPending">
        <label class="filter-item">
          <span>车牌</span>
          <input v-model="pendingFilter.plate" placeholder="按车牌检索" />
        </label>
        <label class="filter-item">
          <span>承运单位</span>
          <input v-model="pendingFilter.carrier" placeholder="按承运单位检索" />
        </label>
        <label class="filter-item">
          <span>准入结论</span>
          <select v-model="pendingFilter.status">
            <option value="">全部</option>
            <option value="有效">有效</option>
            <option value="临期">临期</option>
            <option value="已过期">已过期</option>
            <option value="未登记">未登记</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>计量单号</th>
            <th>承运单位</th>
            <th>进场车牌</th>
            <th>准运证编号</th>
            <th>准入结论</th>
            <th>门岗处置</th>
            <th>到厂时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredPending" :key="String(item.weighId)">
            <td>{{ item.weighNo }}</td>
            <td>{{ item.carrier || '—' }}</td>
            <td>{{ item.plate }}</td>
            <td>
              {{ item.permitNo ? `${item.permitNo}（第${item.permitVersion}版）` : '—' }}
            </td>
            <td>
              <span class="badge" :class="pendingBadge(item.status)">{{ pendingStatusText(item) }}</span>
            </td>
            <td>
              <span class="gate-call" :class="gateCallClass(item.gateDecision)">{{ item.gateDecision }}</span>
            </td>
            <td>{{ item.arrivedAt }}</td>
          </tr>
          <tr v-if="!filteredPending.length">
            <td colspan="7" class="empty-state">待核清单暂无车辆：未复核的到厂车辆会自动出现在这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="arrivalOpen" class="modal-mask" @click.self="closeArrival">
      <div class="modal">
        <header class="modal-head">
          <h3>门岗登记到车</h3>
          <button class="link" type="button" @click="closeArrival">关闭</button>
        </header>
        <form class="modal-body form-grid" @submit.prevent="submitArrival">
          <label class="form-item">
            <span>计量单号 *</span>
            <input v-model="arrival.weighNo" placeholder="如：WEIG-0106" />
          </label>
          <label class="form-item">
            <span>承运单位 *</span>
            <input v-model="arrival.carrier" placeholder="按实际承运单位填写，用于和台账对齐" />
          </label>
          <label class="form-item">
            <span>进场车牌 *</span>
            <input v-model="arrival.plate" placeholder="如：粤B·D5688" />
          </label>
          <label class="form-item">
            <span>到厂时间</span>
            <input v-model="arrival.arrivedAt" type="date" />
          </label>
          <p class="muted form-wide">准入结论不由门岗填写：保存后系统按「承运单位＋车牌」到准入台账实时核对并同步结论。</p>
          <p v-if="arrivalError" class="error-text form-wide">{{ arrivalError }}</p>
          <div class="form-wide form-foot">
            <button class="btn primary" type="submit">进入待核清单</button>
            <button class="btn ghost" type="button" @click="closeArrival">取消</button>
          </div>
        </form>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾进厂计量记录 · 待核清单 {{ pendingRows.length }} 车</span>
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
import {
  listPendingCheck,
  recordArrival,
} from '@/api/access-service'
import { normalizePlate, todayIso } from '@/data/access-core'
import type { EntryRow } from '@/data/types'
import type { PendingCheckRow } from '@/api/access-service'
import type { AccessStatus } from '@/data/access-core'

const meta = moduleMeta('weighbridge')
const columns = ["计量单号", "进场车牌", "垃圾来源", "毛重", "皮重", "净重", "过磅时间", "计量状态"]
const actions = ["提交过磅", "确认复核", "标记异常"]
const statuses = ["待过磅", "已过磅", "已复核", "数据异常"]
const stats = [{"label": "待过磅车辆", "value": 0}, {"label": "已复核计量单", "value": 0}, {"label": "当日进厂量", "value": 0}]

const today = todayIso()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const pendingRows = ref<PendingCheckRow[]>([])
const pendingFilter = ref({ plate: '', carrier: '', status: '' })
const filteredPending = computed(() => {
  const plate = normalizePlate(pendingFilter.value.plate)
  const carrier = pendingFilter.value.carrier.trim()
  const status = pendingFilter.value.status
  return pendingRows.value.filter((item) => {
    if (plate && !normalizePlate(item.plate).includes(plate)) {
      return false
    }
    if (carrier && !item.carrier.includes(carrier)) {
      return false
    }
    if (status && item.status !== status) {
      return false
    }
    return true
  })
})

const arrivalOpen = ref(false)
const arrivalError = ref('')
const arrival = ref({ weighNo: '', carrier: '', plate: '', arrivedAt: today })

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '进厂计量单登记入口尚未接入审批流'
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

function pendingBadge(status: AccessStatus | '未登记'): string {
  if (status === '有效') {
    return 'badge-valid'
  }
  if (status === '临期') {
    return 'badge-near'
  }
  return 'badge-expired'
}

function pendingStatusText(item: PendingCheckRow): string {
  if (item.ambiguous) {
    return '同一车牌挂在多家承运单位'
  }
  if (item.status === '未登记') {
    return '未登记'
  }
  if (item.status === '有效') {
    return `有效（剩 ${item.daysLeft} 天）`
  }
  if (item.status === '临期') {
    return `临期（剩 ${item.daysLeft} 天）`
  }
  return '已过期'
}

function gateCallClass(decision: string): string {
  if (decision === '放行') {
    return 'gate-pass'
  }
  if (decision === '临期放行' || decision === '临期限期') {
    return 'gate-near'
  }
  return 'gate-block'
}

function openArrival() {
  arrival.value = { weighNo: '', carrier: '', plate: '', arrivedAt: today }
  arrivalError.value = ''
  arrivalOpen.value = true
}

function closeArrival() {
  arrivalOpen.value = false
}

function submitArrival() {
  const result = recordArrival(arrival.value, today)
  if (!result.ok) {
    arrivalError.value = result.message
    return
  }
  arrivalOpen.value = false
  errorMessage.value = ''
  reload()
}

function reloadPending() {
  pendingRows.value = listPendingCheck(today)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadPending()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '垃圾进厂计量列表读取失败'
  }
}

onMounted(reload)
</script>
