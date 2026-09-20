import { useState, useEffect } from 'react'
import { refreshMenuFromServer } from '../db/dexie.js'

function isVeg(name = '') {
  const lower = name.toLowerCase()
  return !(lower.includes('egg') || lower.includes('chicken') || lower.includes('mutton') || lower.includes('fish') || lower.includes('meat'))
}

export default function MenuManager({ session }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Add Item Modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newCategory, setNewCategory] = useState('roll')
  const [adding, setAdding] = useState(false)

  // Edit Price Modal
  const [editingItem, setEditingItem] = useState(null)
  const [editPriceVal, setEditPriceVal] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)

  // Price History Modal
  const [historyItem, setHistoryItem] = useState(null)

  async function fetchAllItems() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/menu-items?all=true', {
        headers: { authorization: `Bearer ${session.token}` },
      })
      if (!res.ok) throw new Error(`Failed to load items (${res.status})`)
      const data = await res.json()
      setItems(data.items || [])
      // Also update local Dexie cache
      await refreshMenuFromServer(session.token).catch(() => {})
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAllItems()
  }, [])

  async function handleAddItem(e) {
    e.preventDefault()
    if (!newName || !newPrice) return
    setAdding(true)
    try {
      const res = await fetch('/api/menu-items', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          name: newName.trim(),
          price: Number(newPrice),
          category: newCategory.trim() || 'roll',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to add item')
      }
      setShowAddModal(false)
      setNewName('')
      setNewPrice('')
      await fetchAllItems()
    } catch (err) {
      alert(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleUpdatePrice(e) {
    e.preventDefault()
    if (!editingItem || !editPriceVal) return
    setSavingPrice(true)
    try {
      const res = await fetch(`/api/menu-items/${editingItem._id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ price: Number(editPriceVal) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to update price')
      }
      setEditingItem(null)
      await fetchAllItems()
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingPrice(false)
    }
  }

  async function toggleActive(item) {
    try {
      const res = await fetch(`/api/menu-items/${item._id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ isActive: !item.isActive }),
      })
      if (!res.ok) throw new Error('Failed to toggle status')
      await fetchAllItems()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <main className="manager-screen">
      <div className="section-header-bar">
        <div className="section-title-group">
          <h2>Menu Catalog & Pricing</h2>
          <p>Manage items, adjust prices with immutable audit logs, and toggle availability</p>
        </div>

        <button className="btn-brand-accent" onClick={() => setShowAddModal(true)}>
          <span>+</span> Add Menu Item
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'var(--danger-bg)', color: '#fda4af', borderRadius: 8, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 30 }}>Loading menu items...</p>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: 18, marginBottom: 8 }}>No menu items in catalog</p>
          <p style={{ fontSize: 13, marginBottom: 14 }}>Add your shop's kathi rolls and drinks to get started</p>
          <button className="btn-brand-accent" onClick={() => setShowAddModal(true)}>
            + Add First Item
          </button>
        </div>
      ) : (
        <div className="menu-items-table-card">
          {items.map((item) => {
            const itemVeg = isVeg(item.name)
            const hasHistory = item.priceHistory && item.priceHistory.length > 0

            return (
              <div key={item._id} className="item-list-row">
                <div className="item-row-main">
                  <span className={`diet-marker ${itemVeg ? 'veg' : 'nonveg'}`} />
                  <div className="item-row-info">
                    <span className="item-row-name">{item.name}</span>
                    <div className="item-row-meta">
                      <span className="item-category-tag">{item.category || 'roll'}</span>
                    </div>
                  </div>
                </div>

                <div className="item-row-actions">
                  <button
                    className="btn-price-pill"
                    onClick={() => {
                      setEditingItem(item)
                      setEditPriceVal(item.price)
                    }}
                    title={hasHistory ? `Price: ₹${item.price} (${item.priceHistory.length} audit record${item.priceHistory.length > 1 ? 's' : ''}). Click to edit.` : 'Click to edit price (audited)'}
                  >
                    <span>₹{item.price}</span>
                    <span className="price-pill-pencil">✏️</span>
                    {hasHistory && (
                      <span
                        className="price-audit-indicator"
                        onClick={(e) => {
                          e.stopPropagation()
                          setHistoryItem(item)
                        }}
                        title={`View ${item.priceHistory.length} price change record${item.priceHistory.length > 1 ? 's' : ''}`}
                      >
                        <span style={{ fontSize: 10 }}>🕒</span>
                        <span>{item.priceHistory.length}</span>
                      </span>
                    )}
                  </button>

                  <button
                    className={`toggle-switch-btn ${item.isActive ? 'active' : 'inactive'}`}
                    onClick={() => toggleActive(item)}
                    title="Toggle In Stock / Out of Stock"
                  >
                    {item.isActive ? 'In Stock' : 'Disabled'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Menu Item</h3>
              <button onClick={() => setShowAddModal(false)} style={{ fontSize: 18, color: 'var(--text-muted)' }}>✕</button>
            </div>

            <form onSubmit={handleAddItem}>
              <div className="form-group">
                <label>Item Name</label>
                <input
                  className="form-input"
                  placeholder="e.g. Double Chicken Egg Roll"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label>Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  placeholder="e.g. 90"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <input
                  className="form-input"
                  placeholder="roll, beverage, side"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ padding: '8px 16px', color: 'var(--text-muted)', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-brand-accent"
                  disabled={adding || !newName || !newPrice}
                >
                  {adding ? 'Saving...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Price Modal */}
      {editingItem && (
        <div className="modal-backdrop" onClick={() => setEditingItem(null)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Price: {editingItem.name}</h3>
              <button onClick={() => setEditingItem(null)} style={{ fontSize: 18, color: 'var(--text-muted)' }}>✕</button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Current Price: <strong>₹{editingItem.price}</strong>. Price modifications are automatically appended to the immutable audit trail.
            </p>

            <form onSubmit={handleUpdatePrice}>
              <div className="form-group">
                <label>New Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  value={editPriceVal}
                  onChange={(e) => setEditPriceVal(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {editingItem.priceHistory && editingItem.priceHistory.length > 0 && (
                <div className="modal-audit-section">
                  <div className="modal-audit-header">
                    <span>Audit Trail ({editingItem.priceHistory.length} recorded {editingItem.priceHistory.length === 1 ? 'change' : 'changes'})</span>
                  </div>
                  <div className="modal-audit-list">
                    {editingItem.priceHistory.slice(-4).reverse().map((h, i) => (
                      <div key={i} className="modal-audit-item">
                        <div className="modal-audit-diff">
                          <span className="old-price">₹{h.oldPrice}</span>
                          <span className="diff-arrow">→</span>
                          <span className="new-price">₹{h.newPrice}</span>
                        </div>
                        <div className="modal-audit-meta">
                          <span>{new Date(h.changedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="actor-badge">by {typeof h.changedBy === 'object' && h.changedBy?.name ? h.changedBy.name : 'Owner'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  style={{ padding: '8px 16px', color: 'var(--text-muted)', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-brand-accent"
                  disabled={savingPrice || !editPriceVal}
                >
                  {savingPrice ? 'Updating...' : 'Confirm Price Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {historyItem && (
        <div className="modal-backdrop" onClick={() => setHistoryItem(null)}>
          <div className="modal-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Price History: {historyItem.name}</h3>
              <button onClick={() => setHistoryItem(null)} style={{ fontSize: 18, color: 'var(--text-muted)' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
              {historyItem.priceHistory.map((h, i) => (
                <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 4 }}>
                    <span style={{ color: '#fda4af', textDecoration: 'line-through' }}>₹{h.oldPrice}</span>
                    <span>→</span>
                    <span style={{ color: '#86efac' }}>₹{h.newPrice}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Changed on {new Date(h.changedAt).toLocaleString()} by {typeof h.changedBy === 'object' && h.changedBy?.name ? h.changedBy.name : 'Owner'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
