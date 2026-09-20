import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { syncOrders } from '../db/sync.js'
import { isMuted, setMuted } from '../utils/sound.js'

export default function Navbar({ session, currentTab, onSelectTab, onLogout }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [soundMuted, setSoundMuted] = useState(isMuted)
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  )

  const unsyncedCount = useLiveQuery(
    () => db.orders.where('synced').equals(0).count(),
    [],
  )

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 10000)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(timer)
    }
  }, [])

  function toggleSound() {
    setSoundMuted((m) => {
      const next = !m
      setMuted(next)
      return next
    })
  }

  function handleManualSync() {
    if (session?.token) {
      syncOrders(session.token)
    }
  }

  const isOwner = session?.user?.role === 'owner'

  return (
    <header className="app-navbar">
      {/* Top Slim Row */}
      <div className="nav-top-row">
        <div className="brand-section" onClick={() => onSelectTab('order')}>
          <img src="/logo.jpg" alt="Monti Roll" className="brand-logo-img" />
          <div className="brand-info">
            <span className="brand-name">Monti Roll</span>
          </div>
        </div>

        <div className="nav-controls">
          {/* Unified Compact Status (Sync + Time + Online) */}
          <button
            className={`unified-status-chip ${unsyncedCount > 0 ? 'has-unsynced' : ''}`}
            onClick={handleManualSync}
            title={
              unsyncedCount > 0
                ? `${unsyncedCount} offline order(s) waiting to sync. Click to retry.`
                : 'All orders synced to cloud'
            }
          >
            <span className={`pulse-dot ${online ? '' : 'offline'}`} />
            <span className="status-time-text">{online ? currentTime : 'Offline'}</span>
            <span className="status-sync-icon">{unsyncedCount > 0 ? `⏳${unsyncedCount}` : '☁️'}</span>
          </button>

          {/* Role Indicator */}
          <div className="user-role-chip" title={`Logged in as ${session.user.name} (${session.user.role})`}>
            <span>{isOwner ? '👑' : '🧑‍🍳'}</span>
            <span className="role-label-text">{isOwner ? 'Owner' : 'Till'}</span>
          </div>

          {/* Sound Mute/Unmute */}
          <button
            className="icon-btn-compact"
            onClick={toggleSound}
            title={soundMuted ? 'Unmute sound' : 'Mute sound'}
            aria-label="Toggle sound"
          >
            {soundMuted ? '🔇' : '🔊'}
          </button>

          {/* Logout */}
          <button
            className="icon-btn-compact logout-btn"
            onClick={onLogout}
            title="Sign out of shift"
            aria-label="Sign out"
          >
            🚪
          </button>
        </div>
      </div>

      {/* Segmented Navigation Bar (Fits cleanly on mobile without wrapping) */}
      <nav className="segmented-nav-bar">
        <button
          className={`seg-tab-btn ${currentTab === 'order' ? 'active' : ''}`}
          onClick={() => onSelectTab('order')}
        >
          <span className="seg-tab-icon">⚡</span>
          <span className="seg-tab-label">Till</span>
        </button>

        <button
          className={`seg-tab-btn ${currentTab === 'orders' ? 'active' : ''}`}
          onClick={() => onSelectTab('orders')}
        >
          <span className="seg-tab-icon">📋</span>
          <span className="seg-tab-label">Tokens</span>
        </button>

        {isOwner && (
          <>
            <button
              className={`seg-tab-btn ${currentTab === 'menu' ? 'active' : ''}`}
              onClick={() => onSelectTab('menu')}
            >
              <span className="seg-tab-icon">🌯</span>
              <span className="seg-tab-label">Menu</span>
            </button>

            <button
              className={`seg-tab-btn ${currentTab === 'summary' ? 'active' : ''}`}
              onClick={() => onSelectTab('summary')}
            >
              <span className="seg-tab-icon">📊</span>
              <span className="seg-tab-label">Close</span>
            </button>
          </>
        )}
      </nav>
    </header>
  )
}
