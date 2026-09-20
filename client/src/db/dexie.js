import Dexie from 'dexie'

/**
 * Offline source of truth (architecture.md §5/§6):
 *  - order entry NEVER waits on the network — it reads/writes here first
 *  - orders are keyed by clientId (uuid generated on the phone) so step 5's
 *    background sync can retry idempotently via POST /api/orders
 *  - token numbers come from a local daily-reset counter, not the server
 */
export const db = new Dexie('rollshop-pos')

db.version(1).stores({
  // menu cache — refreshed opportunistically after login; order-taking works offline from this
  menuItems: 'remoteId, name, isActive',
  // saved orders — `synced` flag drives the step-5 background sync
  orders: 'clientId, date, orderNumber, synced, status, paymentMethod',
  // daily-reset token sequence: { date: 'YYYY-MM-DD', lastNumber }
  counters: 'date',
})

export function localDateString(d = new Date()) {
  // shop-local day, not UTC — tokens reset at local midnight
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Next token number for today, safely incremented inside a transaction. */
export async function nextTokenNumber() {
  const today = localDateString()
  return db.transaction('readwrite', db.counters, async () => {
    const row = await db.counters.get(today)
    const next = (row?.lastNumber || 0) + 1
    await db.counters.put({ date: today, lastNumber: next })
    return next
  })
}

/** Roll back today's token counter if the undone order was the latest number issued. */
export async function rollbackTokenNumber(tokenNumber) {
  const today = localDateString()
  return db.transaction('readwrite', db.counters, async () => {
    const row = await db.counters.get(today)
    if (row && row.lastNumber === tokenNumber) {
      await db.counters.put({ date: today, lastNumber: Math.max(0, tokenNumber - 1) })
      return true
    }
    return false
  })
}

/** Best-effort menu refresh; failure is fine — the cached menu keeps working. */
export async function refreshMenuFromServer(token) {
  const res = await fetch('/api/menu-items', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Menu refresh failed (${res.status})`)
  const { items } = await res.json()
  await db.transaction('rw', db.menuItems, async () => {
    await db.menuItems.clear()
    await db.menuItems.bulkPut(
      items.map((i) => ({
        remoteId: i._id,
        name: i.name,
        price: i.price,
        category: i.category,
        // IndexedDB cannot index booleans — store 1/0 so isActive stays a usable index
        isActive: i.isActive ? 1 : 0,
      })),
    )
  })
  return items.length
}
