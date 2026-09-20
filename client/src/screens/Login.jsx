import { useState } from 'react'
import { saveSession } from '../auth/session.js'
import { apiUrl } from '../api/config.js'

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
      const res = await fetch(apiUrl('/api/auth/login'), {
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
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username or phone"
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
      </div>
    </main>
  )
}
