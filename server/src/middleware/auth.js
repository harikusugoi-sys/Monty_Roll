import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
// architecture.md §3: token covers a full shift, not a short access token.
// Forcing re-login mid-rush would undermine the offline-first design.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '14h'

if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set — auth routes will fail until it is configured.')
}

export function signSession(user) {
  return jwt.sign({ userId: user._id.toString(), role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

function extractBearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

/** Verifies the JWT and attaches the session payload to req.auth. */
export function requireAuth(req, res, next) {
  const token = extractBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET) // { userId, role, iat, exp }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/** Role gate. Usage: router.post('/x', requireAuth, requireRole('owner'), handler) */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Forbidden — requires role: ' + roles.join(' or ') })
    }
    next()
  }
}
