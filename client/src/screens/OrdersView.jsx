import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, localDateString } from '../db/dexie.js'
import { syncOrders } from '../db/sync.js'

export default function OrdersView({ session }) {
  const [filter, setFilter] = useState('all') // 'all' | 'unsettled' | 'cash' | 'upi' | 'voided'

  const today = localDateString()
  const orders = useLiveQuery(
    () => db.orders.where('date').equals(today).reverse().sortBy('orderNumber'),
    [today],
  )

  const stats = useMemo(() => {
    if (!orders) return { activeOrders: 0, totalRevenue: 0, cashTotal: 0, upiTotal: 0, voidedCount: 0 }

    let totalRevenue = 0
    let cashTotal = 0
    let upiTotal = 0
    let voidedCount = 0
    let activeOrders = 0

    orders.forEach((o) => {
      if (o.status === 'voided') {
        voidedCount++
        return
      }
      activeOrders++
      totalRevenue += o.totalAmount || 0
      if (o.paymentMethod === 'cash') cashTotal += o.totalAmount || 0
      if (o.paymentMethod === 'upi') upiTotal += o.totalAmount || 0
    })

    return {
      activeOrders,
      totalRevenue,
      cashTotal,
      upiTotal,
      voidedCount,
    }
  }, [orders])

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => {
      if (filter === 'voided') return o.status === 'voided'
      if (o.status === 'voided') return false
      if (filter === 'unsettled') return o.paymentMethod === 'unsettled'
      if (filter === 'cash') return o.paymentMethod === 'cash'
      if (filter === 'upi') return o.paymentMethod === 'upi'
      return true
    })
  }, [orders, filter])

  async function updatePayment(clientId, newMethod) {
    await db.orders.update(clientId, { paymentMethod: newMethod, synced: 0 })
    try {
      const res = await fetch(`/api/orders/${clientId}/payment`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ paymentMethod: newMethod }),
      })
      if (res.ok) {
        await db.orders.update(clientId, { synced: 1 })
      }
    } catch {}
    syncOrders(session.token).catch(() => {})
  }

  async function handleVoid(clientId) {
    if (session.user.role !== 'owner') {
      alert('Voiding orders past the 10-second undo window requires an Owner account.')
      return
    }
    const reason = window.prompt('Owner Authorization: Enter mandatory reason for voiding order:')
    if (!reason || !reason.trim()) return

    const voidData = {
      voidedAt: new Date().toISOString(),
      reason: reason.trim(),
      voidedBy: session.user._id,
    }

    await db.orders.update(clientId, {
      status: 'voided',
      void: voidData,
      synced: 0,
    })

    try {
      const res = await fetch(`/api/orders/${clientId}/void`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (res.ok) {
        await db.orders.update(clientId, { synced: 1 })
      }
    } catch {}
    syncOrders(session.token).catch(() => {})
  }

  return (
    <main className="orders-screen">
      <div className="section-header-bar">
        <div className="section-title-group">
          <h2>Today's Tokens & Settlement</h2>
          <p>Real-time order queue, payment settlement, and live register totals</p>
        </div>
      </div>

      {/* Live Metric Cards */}
      <div className="stats-grid-row">
        <div className="stat-metric-card">
          <span className="stat-metric-label">Active Tokens</span>
          <span className="stat-metric-value">{stats.activeOrders}</span>
        </div>
        <div className="stat-metric-card">
          <span className="stat-metric-label">Total Revenue</span>
          <span className="stat-metric-value" style={{ color: 'var(--brand-orange-light)' }}>
            ₹{stats.totalRevenue}
          </span>
        </div>
        <div className="stat-metric-card">
          <span className="stat-metric-label">Cash Collected</span>
          <span className="stat-metric-value" style={{ color: 'var(--cash-color)' }}>
            ₹{stats.cashTotal}
          </span>
        </div>
        <div className="stat-metric-card">
          <span className="stat-metric-label">UPI Received</span>
          <span className="stat-metric-value" style={{ color: 'var(--upi-color)' }}>
            ₹{stats.upiTotal}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="category-pills" style={{ marginBottom: 14 }}>
        <button
          className={`category-pill ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All Active
        </button>
        <button
          className={`category-pill ${filter === 'unsettled' ? 'active' : ''}`}
          onClick={() => setFilter('unsettled')}
        >
          ⏳ Unsettled
        </button>
        <button
          className={`category-pill ${filter === 'cash' ? 'active' : ''}`}
          onClick={() => setFilter('cash')}
        >
          💵 Cash
        </button>
        <button
          className={`category-pill ${filter === 'upi' ? 'active' : ''}`}
          onClick={() => setFilter('upi')}
        >
          📱 UPI
        </button>
        <button
          className={`category-pill ${filter === 'voided' ? 'active' : ''}`}
          onClick={() => setFilter('voided')}
        >
          🚫 Voided ({stats.voidedCount})
        </button>
      </div>

      {/* Orders List */}
      {orders === undefined ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 30 }}>Loading orders...</p>
      ) : filteredOrders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: 18, marginBottom: 6 }}>No orders found for this filter</p>
          <p style={{ fontSize: 13 }}>Tokens generated from the Order Till will appear here live</p>
        </div>
      ) : (
        <div className="orders-list-col">
          {filteredOrders.map((order) => {
            const isVoided = order.status === 'voided'
            const formattedTime = new Date(order.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <div
                key={order.clientId}
                className="order-history-card"
                style={{ opacity: isVoided ? 0.6 : 1 }}
              >
                <div className="order-card-header">
                  <div className="order-card-token-pill">
                    <span>Token #{order.orderNumber}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                      • {formattedTime}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {isVoided ? (
                      <span style={{ padding: '3px 8px', background: 'var(--danger-bg)', color: '#fda4af', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                        VOIDED
                      </span>
                    ) : (
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          background: order.paymentMethod === 'cash' ? 'var(--cash-bg)' : order.paymentMethod === 'upi' ? 'var(--upi-bg)' : 'rgba(255, 255, 255, 0.08)',
                          color: order.paymentMethod === 'cash' ? 'var(--cash-color)' : order.paymentMethod === 'upi' ? 'var(--upi-color)' : 'var(--text-muted)',
                        }}
                      >
                        {order.paymentMethod.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="order-items-snippet">
                  {order.items.map((it, idx) => (
                    <span key={idx}>
                      {it.nameSnapshot} × {it.quantity} (₹{it.lineTotal})
                      {idx < order.items.length - 1 ? ' • ' : ''}
                    </span>
                  ))}
                </div>

                <div className="order-card-footer">
                  <span className="order-amount-display">₹{order.totalAmount}</span>

                  {!isVoided && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {order.paymentMethod !== 'cash' && (
                        <button
                          type="button"
                          className="toggle-switch-btn active"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => updatePayment(order.clientId, 'cash')}
                        >
                          Mark Cash
                        </button>
                      )}
                      {order.paymentMethod !== 'upi' && (
                        <button
                          type="button"
                          className="toggle-switch-btn active"
                          style={{ padding: '4px 8px', fontSize: 11, background: 'var(--upi-bg)', color: 'var(--upi-color)', borderColor: 'var(--upi-border)' }}
                          onClick={() => updatePayment(order.clientId, 'upi')}
                        >
                          Mark UPI
                        </button>
                      )}
                      <button
                        type="button"
                        style={{ color: 'var(--text-muted)', fontSize: 11, padding: '4px 6px' }}
                        onClick={() => handleVoid(order.clientId)}
                      >
                        Void
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
