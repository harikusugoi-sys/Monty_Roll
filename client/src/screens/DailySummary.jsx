import { useState, useEffect, useMemo } from 'react'
import { localDateString, db } from '../db/dexie.js'
import { apiUrl } from '../api/config.js'

export default function DailySummary({ session }) {
  const [selectedDate, setSelectedDate] = useState(() => localDateString())
  const [orders, setOrders] = useState([])
  const [reconciliation, setReconciliation] = useState(null)
  const [trendHistory, setTrendHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Reconciliation form inputs
  const [upiActual, setUpiActual] = useState('')
  const [cashActual, setCashActual] = useState('')
  const [notes, setNotes] = useState('')
  const [submittingRec, setSubmittingRec] = useState(false)
  const [recSuccess, setRecSuccess] = useState(false)

  async function loadData(date) {
    setLoading(true)
    setError(null)
    setRecSuccess(false)
    try {
      // 1. Fetch orders for the date from server (fallback to local Dexie if offline)
      let dayOrders = []
      try {
        const res = await fetch(apiUrl(`/api/orders?date=${date}`), {
          headers: { authorization: `Bearer ${session.token}` },
        })
        if (res.ok) {
          const data = await res.json()
          dayOrders = data.orders || []
        } else {
          throw new Error('Server query failed')
        }
      } catch {
        dayOrders = await db.orders.where('date').equals(date).toArray()
      }
      setOrders(dayOrders)

      // 2. Fetch existing daily reconciliation from server
      try {
        const recRes = await fetch(apiUrl(`/api/reconciliation?date=${date}`), {
          headers: { authorization: `Bearer ${session.token}` },
        })
        if (recRes.ok) {
          const recData = await recRes.json()
          const rec = recData.reconciliation
          setReconciliation(rec)
          if (rec) {
            setUpiActual(String(rec.upiActualSettled))
            setCashActual(String(rec.cashActualCounted))
            setNotes(rec.notes || '')
          } else {
            setUpiActual('')
            setCashActual('')
            setNotes('')
          }
        }
      } catch {}

      // 3. Fetch 7-day trend history
      try {
        const trendRes = await fetch(apiUrl('/api/reconciliation?days=7'), {
          headers: { authorization: `Bearer ${session.token}` },
        })
        if (trendRes.ok) {
          const trendData = await trendRes.json()
          setTrendHistory(trendData.history || [])
        }
      } catch {}
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(selectedDate)
  }, [selectedDate])

  // Aggregate metrics
  const { varietyCounts, grossRevenue, cashSales, upiSales, voidedOrders, totalRollsSold, hourlyVolume, delayedVoids, sequenceGaps } = useMemo(() => {
    const counts = {}
    let gross = 0
    let cash = 0
    let upi = 0
    const voids = []
    let rolls = 0
    const hourly = {}

    // Initialize business hours (e.g., 12 PM - 11 PM)
    for (let h = 12; h <= 23; h++) {
      hourly[h] = 0
    }

    orders.forEach((ord) => {
      const orderDate = new Date(ord.createdAt)
      const hour = orderDate.getHours()

      if (ord.status === 'voided') {
        voids.push(ord)
        return
      }
      gross += ord.totalAmount || 0
      if (ord.paymentMethod === 'cash') cash += ord.totalAmount || 0
      if (ord.paymentMethod === 'upi') upi += ord.totalAmount || 0

      ord.items.forEach((it) => {
        counts[it.nameSnapshot] = (counts[it.nameSnapshot] || 0) + it.quantity
        rolls += it.quantity
        hourly[hour] = (hourly[hour] || 0) + it.quantity
      })
    })

    // Phase 2.1: Delayed Voids (> 2 mins after creation, design doc §8)
    const delayed = voids.filter((vo) => {
      if (!vo.void?.voidedAt) return false
      const diffMs = new Date(vo.void.voidedAt).getTime() - new Date(vo.createdAt).getTime()
      return diffMs > 2 * 60 * 1000
    })

    // Phase 2.1: Order Sequence Gaps
    const sortedNums = [...orders].map((o) => o.orderNumber).sort((a, b) => a - b)
    const gaps = []
    for (let i = 0; i < sortedNums.length - 1; i++) {
      const diff = sortedNums[i + 1] - sortedNums[i]
      if (diff > 1) {
        for (let g = sortedNums[i] + 1; g < sortedNums[i + 1]; g++) {
          gaps.push(g)
        }
      }
    }

    return {
      varietyCounts: Object.entries(counts).sort((a, b) => b[1] - a[1]),
      grossRevenue: gross,
      cashSales: cash,
      upiSales: upi,
      voidedOrders: voids,
      totalRollsSold: rolls,
      hourlyVolume: Object.entries(hourly).map(([h, count]) => ({ hour: Number(h), count })),
      delayedVoids: delayed,
      sequenceGaps: gaps,
    }
  }, [orders])

  const maxHourVolume = useMemo(() => {
    return Math.max(...hourlyVolume.map((h) => h.count), 1)
  }, [hourlyVolume])

  // Live Discrepancy Calculation per design doc §2:
  // Expected Cash = Gross Revenue - Actual UPI Settled
  // Discrepancy = Actual Cash Counted - Expected Cash
  const liveCalculation = useMemo(() => {
    const upiNum = Number(upiActual) || 0
    const cashNum = Number(cashActual) || 0
    const expectedCash = grossRevenue - upiNum
    const discrepancy = cashNum - expectedCash
    return { expectedCash, discrepancy }
  }, [grossRevenue, upiActual, cashActual])

  async function handleCloseDay(e) {
    e.preventDefault()
    if (upiActual === '' || cashActual === '') return
    setSubmittingRec(true)
    try {
      const res = await fetch(apiUrl('/api/reconciliation'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          date: selectedDate,
          upiActualSettled: Number(upiActual),
          cashActualCounted: Number(cashActual),
          notes,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to submit reconciliation')
      }
      const data = await res.json()
      setReconciliation(data.reconciliation)
      setRecSuccess(true)
      loadData(selectedDate)
    } catch (err) {
      alert(err.message)
    } finally {
      setSubmittingRec(false)
    }
  }

  // Phase 2.5: EOD Export Ledger (CSV) — D4 Blob & BOM safe
  function exportCSV() {
    const headers = ['Token #', 'Date', 'Time', 'Status', 'Payment Method', 'Items', 'Total (INR)', 'Void Reason']
    const rows = orders.map((o) => {
      const time = new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const itemsStr = o.items.map((i) => `${i.nameSnapshot} x${i.quantity}`).join(' | ')
      return [
        o.orderNumber,
        o.date,
        `"${time.replace(/"/g, '""')}"`,
        o.status,
        o.paymentMethod,
        `"${itemsStr.replace(/"/g, '""')}"`,
        o.totalAmount,
        `"${(o.void?.reason || '').replace(/"/g, '""')}"`,
      ].join(',')
    })

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `monti-roll-ledger-${selectedDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function exportJSON() {
    const jsonStr = JSON.stringify({ date: selectedDate, reconciliation, orders }, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `monti-roll-data-${selectedDate}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function shiftDay(delta) {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setSelectedDate(`${y}-${m}-${day}`)
  }

  return (
    <main className="manager-screen">
      {/* Date Header */}
      <div className="section-header-bar">
        <div className="section-title-group">
          <h2>Daily Summary & Reconciliation</h2>
          <p>Sales rollups, rush-hour peak histograms, neutral anomaly flags, and cash audits</p>
        </div>

        <div className="date-nav-controls">
          <button className="icon-btn" onClick={() => shiftDay(-1)} title="Previous Day">◀</button>
          <input
            type="date"
            className="form-input date-picker-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button className="icon-btn" onClick={() => shiftDay(1)} title="Next Day">▶</button>
          <button
            className="toggle-switch-btn active"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => setSelectedDate(localDateString())}
          >
            Today
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>Loading day totals...</p>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="stats-grid-row">
            <div className="stat-metric-card">
              <span className="stat-metric-label">Total Rolls Sold</span>
              <span className="stat-metric-value">{totalRollsSold}</span>
            </div>
            <div className="stat-metric-card">
              <span className="stat-metric-label">Gross Revenue</span>
              <span className="stat-metric-value" style={{ color: 'var(--brand-orange-light)' }}>₹{grossRevenue}</span>
            </div>
            <div className="stat-metric-card">
              <span className="stat-metric-label">App Cash Sales</span>
              <span className="stat-metric-value" style={{ color: 'var(--cash-color)' }}>₹{cashSales}</span>
            </div>
            <div className="stat-metric-card">
              <span className="stat-metric-label">App UPI Sales</span>
              <span className="stat-metric-value" style={{ color: 'var(--upi-color)' }}>₹{upiSales}</span>
            </div>
          </div>

          {/* Phase 2.1: Evidence-Based Neutral Review Flags (Design Doc §8) */}
          <div className="review-flags-card">
            <div className="review-flags-header">
              <h3><span>🛡️</span> Daily Operations & Anomaly Review</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Factual Observations (Owner Eyes Only)</span>
            </div>

            <div className="review-flag-items">
              {delayedVoids.length > 0 ? (
                <div className="flag-item-row warning">
                  <span>⚠️</span>
                  <div>
                    <strong>{delayedVoids.length} void(s) occurred &gt;2 minutes after order creation</strong>
                    <div style={{ fontSize: 12, opacity: 0.9 }}>
                      {delayedVoids.map((v) => `Token #${v.orderNumber} (₹${v.totalAmount}, ${v.paymentMethod})`).join(', ')}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flag-item-row clean">
                  <span>✓</span>
                  <div>All voids (if any) occurred immediately within normal mis-tap window.</div>
                </div>
              )}

              {sequenceGaps.length > 0 ? (
                <div className="flag-item-row notice">
                  <span>ℹ️</span>
                  <div>
                    <strong>Token sequence non-consecutive:</strong> skipped Token #{sequenceGaps.join(', #')}
                  </div>
                </div>
              ) : (
                <div className="flag-item-row clean">
                  <span>✓</span>
                  <div>Token sequence is continuous from start to finish without gaps.</div>
                </div>
              )}

              <div className="flag-item-row clean">
                <span>✓</span>
                <div>Cash expectation is anchored to external UPI statement rather than operator claims.</div>
              </div>
            </div>
          </div>

          {/* Phase 2.3: Peak-Hour Rush Histogram */}
          <div className="histogram-chart-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>
                📊 Hourly Rush Distribution ({selectedDate})
              </h3>
              <span style={{ fontSize: 12, color: 'var(--brand-orange-light)', fontWeight: 700 }}>
                Peak: {maxHourVolume} rolls/hr
              </span>
            </div>

            <div className="histogram-bars-row">
              {hourlyVolume.map(({ hour, count }) => {
                const heightPct = count > 0 ? Math.max((count / maxHourVolume) * 100, 12) : 4
                const isPeak = count > 0 && count === maxHourVolume
                const formattedHour = hour > 12 ? `${hour - 12}p` : hour === 12 ? '12p' : `${hour}a`

                return (
                  <div key={hour} className="histogram-col" title={`${count} rolls ordered at ${formattedHour}`}>
                    {count > 0 && <span className="histogram-val-label">{count}</span>}
                    <div
                      className={`histogram-bar-fill ${isPeak ? 'peak' : ''}`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="histogram-time-label">{formattedHour}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Phase 2.2: 7-Day Cash Discrepancy Trend */}
          {trendHistory.length > 0 && (
            <div className="trend-chart-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>
                  📈 7-Day Cash Discrepancy Trend (Week-over-Week)
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Separates one-off noise from recurring shortfall patterns
                </span>
              </div>

              <div className="trend-bars-row">
                {trendHistory.map((rec) => {
                  const val = rec.discrepancy || 0
                  const isZero = val === 0
                  const isPos = val > 0
                  const absVal = Math.abs(val)
                  const heightPct = Math.min(Math.max((absVal / 100) * 100, 20), 100)

                  return (
                    <div key={rec.date} className="trend-col">
                      <span style={{ fontSize: 11, fontWeight: 800, color: isZero ? 'var(--veg-color)' : isPos ? '#60a5fa' : '#f87171' }}>
                        {isZero ? '₹0' : (isPos ? `+₹${val}` : `-₹${absVal}`)}
                      </span>
                      <div
                        className={`trend-bar-fill ${isZero ? 'balanced' : isPos ? 'surplus' : 'shortfall'}`}
                        style={{ height: `${isZero ? 15 : heightPct}%` }}
                      />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
                        {rec.date.slice(5)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="summary-two-col-grid">
            {/* Rolls Sold by Variety */}
            <div className="menu-items-table-card" style={{ padding: 16 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 14 }}>
                🌯 Rolls Sold by Variety
              </h3>
              {varietyCounts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No roll sales recorded for {selectedDate}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {varietyCounts.map(([name, qty]) => {
                    const pct = totalRollsSold > 0 ? Math.round((qty / totalRollsSold) * 100) : 0
                    return (
                      <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}>
                          <span>{name}</span>
                          <span style={{ color: 'var(--brand-orange-light)' }}>{qty} roll{qty === 1 ? '' : 's'} ({pct}%)</span>
                        </div>
                        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand-gradient)', borderRadius: 4 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Reconciliation Calculator & Submission Form */}
            <div className="menu-items-table-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>
                  🔐 Daily Cash Close & Audit
                </h3>
                {reconciliation && (
                  <span style={{ fontSize: 11, padding: '3px 8px', background: 'var(--veg-bg)', color: 'var(--veg-color)', borderRadius: 6, fontWeight: 700 }}>
                    LOCKED ✓
                  </span>
                )}
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                Anchor cash expected against actual UPI settlement from your UPI/bank app.
              </p>

              {recSuccess && (
                <div style={{ padding: 10, background: 'var(--veg-bg)', color: '#6ee7b7', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                  ✓ Daily reconciliation submitted and locked to MongoDB.
                </div>
              )}

              <form onSubmit={handleCloseDay} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>1. Actual UPI Received (from UPI App statement)</label>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    placeholder="Enter total UPI settled"
                    value={upiActual}
                    onChange={(e) => setUpiActual(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label>2. Actual Cash Counted (Physical till drawer)</label>
                  <input
                    type="number"
                    min="0"
                    className="form-input"
                    placeholder="Enter physical cash in drawer"
                    value={cashActual}
                    onChange={(e) => setCashActual(e.target.value)}
                    required
                  />
                </div>

                {/* Real-time Computed Discrepancy Card */}
                {upiActual !== '' && cashActual !== '' && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: liveCalculation.discrepancy === 0 ? 'rgba(16, 185, 129, 0.12)' : liveCalculation.discrepancy > 0 ? 'rgba(59, 130, 246, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid ' + (liveCalculation.discrepancy === 0 ? '#10b981' : liveCalculation.discrepancy > 0 ? '#3b82f6' : '#ef4444'),
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>Expected Cash in Till:</span>
                      <strong>₹{liveCalculation.expectedCash}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800 }}>
                      <span>Discrepancy:</span>
                      <span style={{ color: liveCalculation.discrepancy === 0 ? '#34d399' : liveCalculation.discrepancy > 0 ? '#60a5fa' : '#f87171' }}>
                        {liveCalculation.discrepancy === 0 ? '₹0 (Perfect Balance)' : liveCalculation.discrepancy > 0 ? `+₹${liveCalculation.discrepancy} (Surplus)` : `-₹${Math.abs(liveCalculation.discrepancy)} (Shortfall)`}
                      </span>
                    </div>
                  </div>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label>Notes / Explanations (optional)</label>
                  <input
                    className="form-input"
                    placeholder="e.g. ₹20 short change given on Token #5"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn-brand-accent"
                  disabled={submittingRec || upiActual === '' || cashActual === ''}
                  style={{ justifyContent: 'center', width: '100%', marginTop: 4 }}
                >
                  {submittingRec ? 'Saving...' : reconciliation ? 'Update Reconciliation' : 'Lock & Save Day Close'}
                </button>
              </form>
            </div>
          </div>

          {/* Phase 2.5: EOD Sales Ledger Export Actions */}
          <div className="menu-items-table-card" style={{ padding: 16, marginBottom: 20 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 8 }}>
              📥 Export Sales Ledger & Backup
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Download complete structured records for accounting and offline sales continuity.
            </p>

            <div className="eod-export-actions">
              <button className="btn-export-outline" onClick={exportCSV} disabled={orders.length === 0}>
                <span>📄</span> Export Sales Ledger (.CSV)
              </button>
              <button className="btn-export-outline" onClick={exportJSON} disabled={orders.length === 0}>
                <span>💾</span> Export Day Backup (.JSON)
              </button>
            </div>
          </div>

          {/* Voids & Audit Logs for the day */}
          <div className="menu-items-table-card" style={{ padding: 16 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, marginBottom: 12 }}>
              🛡️ Voids & Audited Exceptions ({voidedOrders.length})
            </h3>
            {voidedOrders.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No voided orders or exceptions logged for {selectedDate}.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {voidedOrders.map((vo) => (
                  <div key={vo.clientId || vo._id} style={{ padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <div>
                      <span style={{ fontWeight: 800, color: '#fda4af', marginRight: 8 }}>Token #{vo.orderNumber}</span>
                      <span style={{ fontSize: 13 }}>₹{vo.totalAmount} • Reason: <em>"{vo.void?.reason || 'No reason'}"</em></span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(vo.void?.voidedAt || vo.updatedAt || vo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  )
}
