import { db } from './dexie.js'

let isSyncing = false
const listeners = new Set()

export function subscribeSyncStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyListeners(status) {
  for (const fn of listeners) {
    try {
      fn(status)
    } catch {}
  }
}

/**
 * Pushes unsynced local orders to MongoDB via POST /api/orders/sync.
 * Idempotent via clientId — safe to retry repeatedly.
 */
export async function syncOrders(token) {
  if (!token || isSyncing || !navigator.onLine) {
    return { status: 'skipped' }
  }

  isSyncing = true
  notifyListeners({ syncing: true })

  try {
    const unsynced = await db.orders.where('synced').equals(0).toArray()
    if (unsynced.length === 0) {
      notifyListeners({ syncing: false, unsyncedCount: 0 })
      return { syncedCount: 0, pendingCount: 0 }
    }

    const payload = {
      orders: unsynced.map((o) => ({
        clientId: o.clientId,
        orderNumber: o.orderNumber,
        date: o.date,
        createdAt: o.createdAt,
        status: o.status,
        items: o.items,
        totalAmount: o.totalAmount,
        paymentMethod: o.paymentMethod,
        void: o.void,
      })),
    }

    const res = await fetch('/api/orders/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new Error(`Sync HTTP error ${res.status}`)
    }

    const { syncedClientIds = [] } = await res.json()

    // Mark successfully synced records in IndexedDB
    await db.transaction('rw', db.orders, async () => {
      for (const cid of syncedClientIds) {
        await db.orders.update(cid, { synced: 1 })
      }
    })

    const remaining = await db.orders.where('synced').equals(0).count()
    notifyListeners({ syncing: false, unsyncedCount: remaining })
    return { syncedCount: syncedClientIds.length, pendingCount: remaining }
  } catch (err) {
    console.warn('[sync] Offline push postponed:', err.message)
    const remaining = await db.orders.where('synced').equals(0).count().catch(() => 0)
    notifyListeners({ syncing: false, unsyncedCount: remaining, error: err.message })
    return { error: err.message }
  } finally {
    isSyncing = false
  }
}

/**
 * Start background sync daemon.
 * Automatically flushes whenever network recovers or every 20s.
 */
export function startBackgroundSync(getToken) {
  const run = () => {
    const t = getToken()
    if (t) syncOrders(t)
  }

  window.addEventListener('online', run)
  const interval = setInterval(run, 20000)

  // Initial sync attempt
  run()

  return () => {
    window.removeEventListener('online', run)
    clearInterval(interval)
  }
}
