/**
 * Local smoke test — runs the full step 1-2 flow against an in-memory MongoDB
 * so everything except the Atlas network path is verified before handover:
 *   Step 1: connect, boot, /api/health, seed (created + idempotent), bcrypt hash
 *   Step 2: login, /auth/me, role gates, operator create/deactivate
 *
 * Run with: pnpm --filter server smoke
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

// Must be set BEFORE importing app modules (auth config is read at module load).
process.env.JWT_SECRET = 'smoke-test-secret-not-for-production'
process.env.OWNER_NAME = 'Smoke Owner'
process.env.OWNER_USERNAME = '9999999999'
process.env.OWNER_PASSWORD = 'smoke-test-pass'

const { connectDB } = await import('../config/db.js')
const { createApp } = await import('../app.js')
const { seedOwner } = await import('./seed.js')
const { User } = await import('../models/user.js')
const { MenuItem } = await import('../models/menuItem.js')
const { AuditLog } = await import('../models/auditLog.js')
const { Order } = await import('../models/order.js')
const { DailyReconciliation } = await import('../models/reconciliation.js')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function post(port, path, body, token) {
  const res = await fetch(`http://localhost:${port}/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json() }
}
async function get(port, path, token) {
  const res = await fetch(`http://localhost:${port}/api${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return { status: res.status, json: await res.json() }
}
async function patch(port, path, body, token) {
  const res = await fetch(`http://localhost:${port}/api${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

console.log('[smoke] Starting in-memory MongoDB...')
const mongod = await MongoMemoryServer.create()
process.env.MONGODB_URI = mongod.getUri('rollshop-smoke')

try {
  // ---------- Step 1 ----------
  await connectDB(process.env.MONGODB_URI)
  const app = createApp()
  const server = app.listen(0)
  const port = server.address().port

  const health = await get(port, '/health')
  check('GET /api/health → 200, db connected', health.status === 200 && health.json.db === 'connected', JSON.stringify(health.json))

  check('unknown /api route → 404', (await get(port, '/nope')).status === 404)

  const first = await seedOwner()
  check('seed creates owner', first.created === true)
  const second = await seedOwner()
  check('seed re-run is idempotent', second.created === false)

  const owner = await User.findOne({ username: '9999999999' }).select('+passwordHash')
  check('exactly one owner, bcrypt hash, not plaintext',
    (await User.countDocuments({ username: '9999999999' })) === 1 &&
    owner.role === 'owner' &&
    owner.passwordHash.startsWith('$2') &&
    !owner.passwordHash.includes('smoke-test-pass'))

  // ---------- Step 2: login ----------
  const badPw = await post(port, '/auth/login', { username: '9999999999', password: 'wrong' })
  check('wrong password → 401', badPw.status === 401)

  const noUser = await post(port, '/auth/login', { username: 'nobody', password: 'x' })
  check('unknown user → same generic 401', noUser.status === 401 && noUser.json.error === badPw.json.error)

  const login = await post(port, '/auth/login', { username: '9999999999', password: 'smoke-test-pass' })
  check('owner login → 200 with token + role owner',
    login.status === 200 && typeof login.json.token === 'string' && login.json.user?.role === 'owner')
  check('login response leaks no passwordHash', !JSON.stringify(login.json).includes('passwordHash') && !JSON.stringify(login.json).includes('smoke-test-pass'))
  const ownerToken = login.json.token

  // ---------- Step 2: session ----------
  check('/auth/me without token → 401', (await get(port, '/auth/me')).status === 401)
  check('/auth/me with garbage token → 401', (await get(port, '/auth/me', 'garbage.token.here')).status === 401)
  const me = await get(port, '/auth/me', ownerToken)
  check('/auth/me with owner token → 200', me.status === 200 && me.json.user?.username === '9999999999')

  // ---------- Step 2: operator management ----------
  const createNoAuth = await post(port, '/users', { name: 'X', username: 'op1', password: 'op-pass-123' })
  check('POST /api/users without token → 401', createNoAuth.status === 401)

  const created = await post(port, '/users', { name: 'Op One', username: 'op1', password: 'op-pass-123' }, ownerToken)
  check('owner creates operator → 201, role operator',
    created.status === 201 && created.json.user?.role === 'operator')
  check('created operator leaks no passwordHash', !JSON.stringify(created.json).includes('passwordHash'))

  const listUsers = await get(port, '/users', ownerToken)
  check('owner can list users → 200 array', listUsers.status === 200 && Array.isArray(listUsers.json.users) && listUsers.json.users.length >= 2)

  const dup = await post(port, '/users', { name: 'Dup', username: 'op1', password: 'whatever1' }, ownerToken)
  check('duplicate username → 409', dup.status === 409)

  const opLogin = await post(port, '/auth/login', { username: 'op1', password: 'op-pass-123' })
  const opToken = opLogin.json.token
  check('operator can log in', opLogin.status === 200 && opLogin.json.user?.role === 'operator')

  const opCreates = await post(port, '/users', { name: 'Nope', username: 'op2', password: 'op-pass-456' }, opToken)
  check('operator POST /api/users → 403', opCreates.status === 403)

  // ---------- Step 2: deactivation cuts access immediately ----------
  const opId = created.json.user?._id
  const deact = await patch(port, `/users/${opId}`, { isActive: false }, ownerToken)
  check('owner deactivates operator → 200', deact.status === 200 && deact.json.user?.isActive === false)

  const opMe = await get(port, '/auth/me', opToken)
  check("deactivated operator's existing token rejected on /auth/me → 401", opMe.status === 401)

  const opReLogin = await post(port, '/auth/login', { username: 'op1', password: 'op-pass-123' })
  check('deactivated operator cannot log in → 401', opReLogin.status === 401)

  const reactivate = await patch(port, `/users/${opId}`, { isActive: true }, ownerToken)
  const opLogin2 = await post(port, '/auth/login', { username: 'op1', password: 'op-pass-123' })
  check('reactivated operator can log in again', reactivate.status === 200 && opLogin2.status === 200)

  // ---------- Step 3: menu management ----------
  const menuNoAuth = await get(port, '/menu-items')
  check('GET /menu-items without token → 401', menuNoAuth.status === 401)

  const opCreateItem = await post(port, '/menu-items', { name: 'X', price: 1 }, opToken)
  check('operator POST /menu-items → 403', opCreateItem.status === 403)

  const createItem = await post(port, '/menu-items', { name: 'Paneer Roll', price: 70 }, ownerToken)
  check('owner creates menu item → 201, default category roll',
    createItem.status === 201 && createItem.json.item?.category === 'roll' && createItem.json.item?.isActive === true)
  const itemId = createItem.json.item?._id

  await post(port, '/menu-items', { name: 'Veg Roll', price: 50 }, ownerToken)
  const opMenu = await get(port, '/menu-items', opToken)
  check('operator can read menu (2 active items)', opMenu.status === 200 && opMenu.json.items?.length === 2)

  const badPrice = await post(port, '/menu-items', { name: 'Bad', price: -5 }, ownerToken)
  check('negative price → 400', badPrice.status === 400)

  // --- price edit → priceHistory + price_change audit log ---
  const priceEdit = await patch(port, `/menu-items/${itemId}`, { price: 80 }, ownerToken)
  check('owner price edit → 200, price updated', priceEdit.status === 200 && priceEdit.json.item?.price === 80)

  const afterEdit = await MenuItem.findById(itemId)
  check('priceHistory captured (old 70 → new 80, actor attached)',
    afterEdit.priceHistory.length === 1 &&
    afterEdit.priceHistory[0].oldPrice === 70 &&
    afterEdit.priceHistory[0].newPrice === 80 &&
    String(afterEdit.priceHistory[0].changedBy) === String(owner._id))

  const priceAudit = await AuditLog.findOne({ entityId: itemId, action: 'price_change' })
  check('price_change written to auditLogs with old/new price in meta',
    !!priceAudit && priceAudit.meta?.oldPrice === 70 && priceAudit.meta?.newPrice === 80)

  // --- name edit → menu_edit audit log, no new priceHistory ---
  const nameEdit = await patch(port, `/menu-items/${itemId}`, { name: 'Paneer Tikka Roll' }, ownerToken)
  check('owner name edit → 200', nameEdit.status === 200 && nameEdit.json.item?.name === 'Paneer Tikka Roll')
  const menuAudit = await AuditLog.findOne({ entityId: itemId, action: 'menu_edit' })
  check('menu_edit written to auditLogs', !!menuAudit)
  check('name edit did not touch priceHistory', (await MenuItem.findById(itemId)).priceHistory.length === 1)

  // --- combined price + name edit → both entries, single history push ---
  await patch(port, `/menu-items/${itemId}`, { name: 'Paneer Roll', price: 90 }, ownerToken)
  const combined = await MenuItem.findById(itemId)
  // 5 = create(menu_edit) + price edit(price_change) + name edit(menu_edit) + combined(price_change + menu_edit)
  check('combined edit: priceHistory grew to 2, all 5 audit entries exist',
    combined.priceHistory.length === 2 &&
    (await AuditLog.countDocuments({ entityId: itemId })) === 5)

  // --- no-op patch ---
  const noOp = await patch(port, `/menu-items/${itemId}`, { price: 90 }, ownerToken)
  check('no-op patch reported, no extra history',
    noOp.status === 200 && (await MenuItem.findById(itemId)).priceHistory.length === 2)

  // --- enable/disable ---
  const disable = await patch(port, `/menu-items/${itemId}`, { isActive: false }, ownerToken)
  const opMenu2 = await get(port, '/menu-items', opToken)
  check('disabled item hidden from default menu read',
    disable.status === 200 && opMenu2.json.items?.every((i) => i._id !== itemId))
  const ownerMenuAll = await get(port, '/menu-items?all=true', ownerToken)
  check('owner ?all=true sees disabled item too',
    ownerMenuAll.status === 200 && ownerMenuAll.json.items?.some((i) => i._id === itemId))

  // --- audit log immutability: no update/delete routes exist ---
  const auditDelete = await fetch(`http://localhost:${port}/api/audit-logs/whatever`, { method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` } })
  check('no DELETE route for auditLogs → 404 (immutability at API layer)', auditDelete.status === 404)
  const auditPost = await post(port, '/audit-logs', { action: 'void', reason: 'forged' }, ownerToken)
  check('no client POST route for auditLogs → 404', auditPost.status === 404)

  // ---------- Step 5: Orders & Idempotent Sync ----------
  const sampleOrder = {
    clientId: 'test-uuid-001',
    orderNumber: 1,
    date: '2026-09-20',
    totalAmount: 140,
    paymentMethod: 'unsettled',
    items: [
      { menuItemId: itemId, nameSnapshot: 'Paneer Roll', priceSnapshot: 70, quantity: 2, lineTotal: 140 },
    ],
  }
  const createOrder = await post(port, '/orders', sampleOrder, opToken)
  check('operator creates order → 201', createOrder.status === 201 && createOrder.json.order?.clientId === 'test-uuid-001')

  // Idempotency: retry with same clientId must not create duplicate
  const retryOrder = await post(port, '/orders', sampleOrder, opToken)
  check('idempotent retry with same clientId → 201 without duplicate',
    retryOrder.status === 201 && (await Order.countDocuments({ clientId: 'test-uuid-001' })) === 1)

  // Batch sync
  const batchSync = await post(port, '/orders/sync', {
    orders: [
      {
        clientId: 'test-uuid-002',
        orderNumber: 2,
        date: '2026-09-20',
        totalAmount: 70,
        paymentMethod: 'cash',
        items: [{ menuItemId: itemId, nameSnapshot: 'Paneer Roll', priceSnapshot: 70, quantity: 1, lineTotal: 70 }],
      },
      {
        clientId: 'test-uuid-003',
        orderNumber: 3,
        date: '2026-09-20',
        totalAmount: 70,
        paymentMethod: 'upi',
        items: [{ menuItemId: itemId, nameSnapshot: 'Paneer Roll', priceSnapshot: 70, quantity: 1, lineTotal: 70 }],
      },
    ],
  }, opToken)
  check('batch sync → 200 with 2 synced orders', batchSync.status === 200 && batchSync.json.synced === 2)

  // ---------- Step 6: Payment Update ----------
  const updatePay = await patch(port, '/orders/test-uuid-001/payment', { paymentMethod: 'cash' }, opToken)
  check('update payment method → 200 cash', updatePay.status === 200 && updatePay.json.order?.paymentMethod === 'cash')

  // ---------- Step 8: Void Flow (Owner Gated with Reason & Audit Log) ----------
  const opVoidAttempt = await patch(port, '/orders/test-uuid-001/void', { reason: 'mistake' }, opToken)
  check('operator void attempt → 403', opVoidAttempt.status === 403)

  const ownerNoReasonVoid = await patch(port, '/orders/test-uuid-001/void', { reason: '' }, ownerToken)
  check('owner void without reason → 400', ownerNoReasonVoid.status === 400)

  const ownerVoid = await patch(port, '/orders/test-uuid-001/void', { reason: 'Customer changed mind' }, ownerToken)
  check('owner void with reason → 200 voided', ownerVoid.status === 200 && ownerVoid.json.order?.status === 'voided')

  const voidAudit = await AuditLog.findOne({ entityType: 'order', action: 'void' })
  check('order void written to auditLogs with reason and actor',
    !!voidAudit && voidAudit.reason === 'Customer changed mind' && String(voidAudit.actor) === String(owner._id))

  // ---------- Step 9: Daily Orders Query & Audit Log Inspection ----------
  const ownerOrders = await get(port, '/orders?date=2026-09-20', ownerToken)
  check('owner queries orders by date → 200 list', ownerOrders.status === 200 && ownerOrders.json.orders?.length >= 3)

  const auditList = await get(port, '/audit-logs', ownerToken)
  check('owner inspects audit logs → 200 list', auditList.status === 200 && Array.isArray(auditList.json.logs) && auditList.json.logs.length > 0)

  // ---------- Step 10: Daily Reconciliation ----------
  // Active orders for 2026-09-20:
  // uuid-002: cash ₹70
  // uuid-003: upi ₹70
  // total revenue = 140, cash expected = 70
  // owner reports: upiActualSettled = 70, cashActualCounted = 65 (₹5 discrepancy short)
  const recSubmit = await post(port, '/reconciliation', {
    date: '2026-09-20',
    upiActualSettled: 70,
    cashActualCounted: 65,
    notes: '₹5 short change error',
  }, ownerToken)
  check('owner submits reconciliation → 201 with computed discrepancy',
    recSubmit.status === 201 &&
    recSubmit.json.reconciliation?.appTotalRevenue === 140 &&
    recSubmit.json.reconciliation?.discrepancy === -5)

  const recGet = await get(port, '/reconciliation?date=2026-09-20', ownerToken)
  check('owner retrieves daily reconciliation → 200',
    recGet.status === 200 && recGet.json.reconciliation?.discrepancy === -5)

  const recTrend = await get(port, '/reconciliation?days=7', ownerToken)
  check('owner retrieves 7-day trend history → 200 array',
    recTrend.status === 200 && Array.isArray(recTrend.json.history) && recTrend.json.history.length >= 1)

  server.close()
  await mongoose.disconnect()
} finally {
  await mongod.stop()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n[smoke] ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exitCode = 1
