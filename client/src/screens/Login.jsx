import { useState } from 'react'
import { saveSession } from '../auth/session.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e?.preventDefault?.()
    if (!username || !password) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Login failed (${res.status})`)
        return
      }
      saveSession(body)
      onLogin(body)
    } catch {
      setError('Cannot reach POS server — check network or dev-server status')
    } finally {
      setBusy(false)
    }
  }

  function fillDevOwner() {
    setUsername('9999999999')
    setPassword('dev-test-pass')
    setError(null)
  }

  return (
    <main className="login-page-wrap">
      <div className="login-auth-card">
        <div className="login-brand-header">
          <img src="/logo.jpg" alt="Monti Roll POS" className="login-logo-img" />
          <h1 className="login-app-title">Monti Roll POS</h1>
          <p className="login-app-desc">Single sign-in per shift • Offline-ready order till</p>
        </div>

        {error && (
          <div className="login-alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form-fields">
          <div className="form-group">
            <label>Username / Phone Number</label>
            <input
              className="form-input"
              inputMode="numeric"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. 9999999999"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label>Shift Password</label>
              <button
                type="button"
                style={{ fontSize: 12, color: 'var(--brand-orange-light)' }}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-generate-token"
            disabled={busy || !username || !password}
            style={{ width: '100%', marginTop: 8 }}
          >
            {busy ? 'Verifying Session...' : 'Sign In to Shift'}
          </button>
        </form>

        <div className="demo-credentials-box">
          <span className="demo-title">Quick Test Login (Local Dev Rig)</span>
          <button type="button" className="demo-quick-btn" onClick={fillDevOwner}>
            👑 Dev Owner: 9999999999 / dev-test-pass
          </button>
        </div>
      </div>
    </main>
  )
}
