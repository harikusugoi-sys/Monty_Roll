const KEY = 'pos_session'

/**
 * Login happens once per shift (architecture.md §3). After that the cached
 * session runs the whole order-entry flow offline — expiry prompts a
 * re-login only when sync or an owner-gated action needs it (steps 5+).
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const { token, user, savedAt } = JSON.parse(raw)
    return { token, user, savedAt }
  } catch {
    return null
  }
}

export function saveSession({ token, user }) {
  localStorage.setItem(KEY, JSON.stringify({ token, user, savedAt: Date.now() }))
}

export function clearSession() {
  localStorage.removeItem(KEY)
}
