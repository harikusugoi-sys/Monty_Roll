import { useEffect, useState, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, nextTokenNumber, rollbackTokenNumber, localDateString, refreshMenuFromServer } from '../db/dexie.js'
import { playTap, playRemove, playSuccess, playUndo } from '../utils/sound.js'
import { syncOrders } from '../db/sync.js'

function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms)
  } catch {}
}

function isVeg(name = '') {
  const lower = name.toLowerCase()
  if (lower.includes('egg') || lower.includes('chicken') || lower.includes('mutton') || lower.includes('fish') || lower.includes('meat')) {
    return false
  }
  return true
}

export default function OrderEntry({ session }) {
  const [cart, setCart] = useState({}) // { [remoteId]: qty }
  const [paymentMethod, setPaymentMethod] = useState('cash') // 'cash' | 'upi'
  const [lastTokenOrder, setLastTokenOrder] = useState(null)
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(10)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [menuNote, setMenuNote] = useState(null)

  const todayDate = localDateString()
  const todayOrders = useLiveQuery(
    () => db.orders.where('date').equals(todayDate).toArray(),
    [todayDate],
  )

  const kitchenRollsLast10M = useMemo(() => {
    if (!todayOrders) return 0
    const tenMinAgo = Date.now() - 10 * 60 * 1000
    return todayOrders
      .filter((o) => o.status === 'active' && new Date(o.createdAt).getTime() >= tenMinAgo)
      .reduce((sum, o) => sum + o.items.reduce((s, it) => s + it.quantity, 0), 0)
  }, [todayOrders])

  const undoIntervalRef = useRef(null)

  const menuItems = useLiveQuery(
    () => db.menuItems.where('isActive').equals(1).sortBy('name'),
    [],
  )

  // Opportunistic menu refresh on mount and auto-refresh on reconnect (D3)
  useEffect(() => {
    function tryRefresh() {
      refreshMenuFromServer(session.token)
        .then((n) => setMenuNote(n === 0 ? 'Menu is empty — owner needs to add items in Menu Manager' : null))
        .catch(() => setMenuNote('Offline mode — using cached menu'))
    }

    tryRefresh()
    window.addEventListener('online', tryRefresh)
    return () => window.removeEventListener('online', tryRefresh)
  }, [session.token])

  function addItem(item) {
    haptic(12)
    playTap()
    setCart((c) => ({ ...c, [item.remoteId]: (c[item.remoteId] || 0) + 1 }))
  }

  function removeOne(item) {
    haptic(8)
    playRemove()
    setCart((c) => {
      const next = { ...c }
      if (!next[item.remoteId]) return c
      if (next[item.remoteId] === 1) delete next[item.remoteId]
      else next[item.remoteId] -= 1
      return next
    })
  }

  function clearCart() {
    haptic([15, 20])
    playRemove()
    setCart({})
    setDrawerOpen(false)
  }

  const cartEntries = useMemo(() => {
    return (menuItems || [])
      .map((i) => ({ item: i, qty: cart[i.remoteId] || 0 }))
      .filter((e) => e.qty > 0)
  }, [menuItems, cart])

  const totalQty = cartEntries.reduce((s, e) => s + e.qty, 0)
  const totalAmount = cartEntries.reduce((s, e) => s + e.qty * e.item.price, 0)

  // Filtered menu items
  const filteredItems = useMemo(() => {
    if (!menuItems) return []
    return menuItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
      if (!matchesSearch) return false

      const itemIsVeg = isVeg(item.name)
      if (selectedCategory === 'veg') return itemIsVeg
      if (selectedCategory === 'nonveg') return !itemIsVeg
      if (selectedCategory === 'other') return item.category && item.category !== 'roll'
      return true
    })
  }, [menuItems, searchQuery, selectedCategory])

  // Generate Token (one-tap rush hour close)
  async function handleGenerateToken() {
    if (cartEntries.length === 0) return
    haptic(35)
    playSuccess()

    const items = cartEntries.map(({ item, qty }) => ({
      menuItemId: item.remoteId,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      quantity: qty,
      lineTotal: qty * item.price,
    }))

    const orderNumber = await nextTokenNumber()
    const order = {
      clientId: crypto.randomUUID(),
      orderNumber,
      date: localDateString(),
      createdAt: new Date().toISOString(),
      createdBy: session.user._id,
      status: 'active',
      items,
      totalAmount: items.reduce((s, l) => s + l.lineTotal, 0),
      paymentMethod,
      synced: 0,
    }

    await db.orders.add(order)
    setCart({})
    setDrawerOpen(false)
    setLastTokenOrder(order)
    setUndoSecondsLeft(10)

    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    const startTime = Date.now()
    undoIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = 10 - elapsed
      if (remaining <= 0) {
        clearInterval(undoIntervalRef.current)
        setLastTokenOrder(null)
        syncOrders(session.token).catch(() => {})
      } else {
        setUndoSecondsLeft(remaining)
      }
    }, 250)
  }

  // 10-Second Immediate Undo Handler
  async function handleUndo() {
    if (!lastTokenOrder) return
    haptic([30, 40, 30])
    playUndo()

    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)

    // Roll back token counter if this was the latest token issued
    await rollbackTokenNumber(lastTokenOrder.orderNumber)

    // Delete the uncommitted aborted order from local DB
    await db.orders.delete(lastTokenOrder.clientId)

    // Restore cart so operator can fix mistake immediately
    const restoredCart = {}
    lastTokenOrder.items.forEach((it) => {
      restoredCart[it.menuItemId] = it.quantity
    })
    setCart(restoredCart)
    setPaymentMethod(lastTokenOrder.paymentMethod)
    setLastTokenOrder(null)
  }

  useEffect(() => {
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    }
  }, [])

  return (
    <>
      {/* Category Pills & Search */}
      <div className="filter-bar-container">
        <div className="search-and-pace-row">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search rolls, paneer, egg..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>

          <span
            className={`kitchen-pace-chip ${kitchenRollsLast10M >= 20 ? 'rush' : kitchenRollsLast10M >= 12 ? 'busy' : 'normal'}`}
            title="Rolling kitchen throughput: rolls ordered in last 10 minutes vs ~20 cap"
          >
            {kitchenRollsLast10M >= 20 ? '🔥 ' : kitchenRollsLast10M >= 12 ? '⚡ ' : '🥬 '}
            {kitchenRollsLast10M} rolls/10m
          </span>
        </div>

        <div className="category-pills">
          <button
            className={`category-pill ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            🔥 All Rolls
          </button>
          <button
            className={`category-pill ${selectedCategory === 'veg' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('veg')}
          >
            <span className="diet-marker veg" style={{ width: 12, height: 12 }} /> Veg Rolls
          </button>
          <button
            className={`category-pill ${selectedCategory === 'nonveg' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('nonveg')}
          >
            <span className="diet-marker nonveg" style={{ width: 12, height: 12 }} /> Non-Veg Rolls
          </button>
          <button
            className={`category-pill ${selectedCategory === 'other' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('other')}
          >
            🥤 Drinks & Sides
          </button>
        </div>
      </div>

      {menuNote && (
        <div style={{ margin: '0 12px 6px', padding: '6px 12px', background: 'rgba(255, 107, 0, 0.1)', color: '#ffb066', borderRadius: 8, fontSize: 13 }}>
          ℹ️ {menuNote}
        </div>
      )}

      {/* 10-Second Undo Banner */}
      {lastTokenOrder && (
        <div className="undo-banner-wrap" role="status">
          <div className="undo-banner-card">
            <div className="undo-banner-content">
              <div className="token-big-badge">
                <span className="token-num-text">#{lastTokenOrder.orderNumber}</span>
                <div className="token-details-text">
                  <span className="token-details-title">Token Generated</span>
                  <span className="token-details-sub">
                    ₹{lastTokenOrder.totalAmount} · {lastTokenOrder.paymentMethod.toUpperCase()} · {undoSecondsLeft}s undo window
                  </span>
                </div>
              </div>

              <button className="btn-undo-action" onClick={handleUndo}>
                <span>↩</span> Undo
              </button>
            </div>

            <div className="undo-progress-track">
              <div className="undo-progress-fill" />
            </div>
          </div>
        </div>
      )}

      {/* Menu Grid */}
      <main className="grid-screen">
        {menuItems === undefined ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>Loading menu...</p>
        ) : filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>No items matched</p>
            <p style={{ fontSize: 13 }}>Try clearing your search or category filter</p>
          </div>
        ) : (
          <div className="menu-grid">
            {filteredItems.map((item) => {
              const qty = cart[item.remoteId] || 0
              const itemVeg = isVeg(item.name)

              return (
                <div
                  key={item.remoteId}
                  className={`menu-tile-card ${qty > 0 ? 'in-cart' : ''}`}
                >
                  <div className="tile-top-row">
                    <span className={`diet-marker ${itemVeg ? 'veg' : 'nonveg'}`} title={itemVeg ? 'Vegetarian' : 'Non-Vegetarian'} />
                    <span className="item-badge-category">{item.category || 'roll'}</span>
                  </div>

                  <h3 className="tile-name">{item.name}</h3>

                  <div className="tile-bottom-row">
                    <span className="tile-price">₹{item.price}</span>

                    {qty === 0 ? (
                      <button
                        className="initial-add-btn"
                        onClick={() => addItem(item)}
                        aria-label={`Add ${item.name}`}
                      >
                        + ADD
                      </button>
                    ) : (
                      <div className="tile-stepper">
                        <button
                          className="step-btn minus"
                          onClick={() => removeOne(item)}
                          aria-label={`Remove one ${item.name}`}
                        >
                          −
                        </button>
                        <span className="step-qty-val">{qty}</span>
                        <button
                          className="step-btn add"
                          onClick={() => addItem(item)}
                          aria-label={`Add one more ${item.name}`}
                        >
                          +
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

      {/* Cart Review Slide-Up Drawer */}
      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="cart-drawer-sheet">
            <div className="drawer-header">
              <h3 className="drawer-title">Current Order ({totalQty} items)</h3>
              <button className="btn-clear-cart" onClick={clearCart}>
                Clear All 🗑️
              </button>
            </div>

            <div className="drawer-items-list">
              {cartEntries.map(({ item, qty }) => (
                <div key={item.remoteId} className="drawer-item-row">
                  <div className="drawer-item-info">
                    <span className="drawer-item-title">{item.name}</span>
                    <span className="drawer-item-sub">₹{item.price} × {qty}</span>
                  </div>
                  <div className="drawer-item-actions">
                    <span style={{ fontWeight: 800, marginRight: 8 }}>₹{item.price * qty}</span>
                    <div className="tile-stepper">
                      <button className="step-btn minus" onClick={() => removeOne(item)}>−</button>
                      <span className="step-qty-val">{qty}</span>
                      <button className="step-btn add" onClick={() => addItem(item)}>+</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="drawer-footer">
              <div className="drawer-footer-row">
                <span>Total Amount</span>
                <span style={{ color: 'var(--brand-orange-light)', fontSize: 22 }}>₹{totalAmount}</span>
              </div>
              <button
                className="btn-generate-token"
                onClick={handleGenerateToken}
                style={{ width: '100%' }}
              >
                <span>⚡</span> Generate Token #{totalAmount > 0 ? '' : ''}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Sticky Bottom Cart Dock Bar */}
      <footer className="cart-dock-bar">
        <div className="cart-dock-inner">
          <div className="cart-dock-row">
            <div className="cart-left-summary" onClick={() => cartEntries.length > 0 && setDrawerOpen((v) => !v)}>
              <span className="cart-grand-total">₹{totalAmount}</span>
              <button className="cart-item-count-btn">
                <span>{totalQty} item{totalQty === 1 ? '' : 's'}</span>
                {totalQty > 0 && <span>▲</span>}
              </button>
            </div>

            {/* Quick Payment Method Selector */}
            <div className="payment-selector-strip">
              <button
                type="button"
                className={`payment-toggle-btn ${paymentMethod === 'cash' ? 'active cash' : ''}`}
                onClick={() => setPaymentMethod('cash')}
              >
                💵 Cash
              </button>
              <button
                type="button"
                className={`payment-toggle-btn ${paymentMethod === 'upi' ? 'active upi' : ''}`}
                onClick={() => setPaymentMethod('upi')}
              >
                📱 UPI
              </button>
            </div>

            {/* Primary Generate Token Button */}
            <button
              className="btn-generate-token"
              disabled={cartEntries.length === 0}
              onClick={handleGenerateToken}
            >
              <span>⚡</span> Token
            </button>
          </div>
        </div>
      </footer>
    </>
  )
}
