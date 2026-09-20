import { useState, useEffect } from 'react'
import Login from './screens/Login.jsx'
import OrderEntry from './screens/OrderEntry.jsx'
import OrdersView from './screens/OrdersView.jsx'
import MenuManager from './screens/MenuManager.jsx'
import DailySummary from './screens/DailySummary.jsx'
import Navbar from './components/Navbar.jsx'
import { getSession, clearSession } from './auth/session.js'
import { startBackgroundSync } from './db/sync.js'

export default function App() {
  const [session, setSession] = useState(getSession)
  const [currentTab, setCurrentTab] = useState('order') // 'order' | 'orders' | 'menu' | 'summary'

  // Background sync worker
  useEffect(() => {
    if (!session?.token) return
    const stopSync = startBackgroundSync(() => session?.token)
    return () => stopSync()
  }, [session?.token])

  if (!session) {
    return <Login onLogin={setSession} />
  }

  function handleLogout() {
    clearSession()
    setSession(null)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
      <Navbar
        session={session}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onLogout={handleLogout}
      />

      {currentTab === 'order' && <OrderEntry session={session} />}
      {currentTab === 'orders' && <OrdersView session={session} />}
      {currentTab === 'menu' && session.user.role === 'owner' && (
        <MenuManager session={session} />
      )}
      {currentTab === 'summary' && session.user.role === 'owner' && (
        <DailySummary session={session} />
      )}
    </div>
  )
}
