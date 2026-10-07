import type { AccessLedger } from './access-types'

// 本地持久化：准入台账与通用 EntryRow 分库存放，避免字段模型互相牵扯。
const STORAGE_KEY = 'waste-to-energy-plant:access-ledger'

// 示例数据按「今天 = 2026-10-07」铺设，覆盖 15 天边界、临期、过期（历史导入）与补录版本。
const SEED_LEDGER: AccessLedger = {
  seq: 5,
  records: [
    {
      id: 1,
      carrierName: '绿源运输有限公司',
      plate: '沪A·12345',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2026-0101',
      permitExpiry: '2027-03-31',
      registeredAt: '2026-09-12T09:20:00',
      source: '登记',
      version: 1,
    },
    {
      id: 2,
      carrierName: '绿源运输有限公司',
      plate: '沪B·23456',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2026-0102',
      permitExpiry: '2026-10-15',
      registeredAt: '2026-09-15T14:05:00',
      source: '登记',
      version: 1,
    },
    {
      id: 3,
      carrierName: '洁城环境服务有限公司',
      plate: '沪C·34567',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2026-0205',
      permitExpiry: '2026-10-22',
      registeredAt: '2026-09-28T10:40:00',
      source: '登记',
      version: 1,
    },
    {
      id: 4,
      carrierName: '洁城环境服务有限公司',
      plate: '沪D·45678',
      permitIssuer: '上海市绿化和市容管理局',
      permitNo: 'ZYZ-2025-0808',
      permitExpiry: '2026-05-31',
      // 历史台账：按当时登记日期（2025-11-20）对齐，那时并未过期
      registeredAt: '2025-11-20T09:00:00',
      source: '历史导入',
      version: 1,
    },
    {
      id: 5,
      carrierName: '环联物流有限公司',
      plate: '沪E·56789',
      permitIssuer: '浦东新区城管执法局',
      permitNo: 'PD-2026-0312',
      permitExpiry: '2026-10-18',
      // 准运证补录已递过两版，只留最后一版，version 留痕
      registeredAt: '2026-10-02T16:30:00',
      source: '补录',
      version: 2,
    },
  ],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): AccessLedger {
  const fallback = clone(SEED_LEDGER)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as AccessLedger
    if (!Array.isArray(parsed.records) || typeof parsed.seq !== 'number') {
      throw new Error('准入台账数据结构不完整')
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: AccessLedger | null = null

export function accessLedger(): AccessLedger {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveAccessLedger(ledger: AccessLedger): void {
  cache = ledger
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger))
  }
}

export function resetAccessLedger(): AccessLedger {
  const ledger = clone(SEED_LEDGER)
  saveAccessLedger(ledger)
  return ledger
}

export function accessStorageKey(): string {
  return STORAGE_KEY
}
