import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { User } from '../models/user.js'
import { signSession, requireAuth } from '../middleware/auth.js'

export const authRouter = Router()

// architecture.md §7: blunt brute-force attempts on login.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in a minute' },
})

authRouter.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' })
    }

    const user = await User.findOne({ username: String(username).trim() }).select('+passwordHash')
    // Same generic error for unknown user / wrong password / deactivated —
    // never reveal which one it was.
    const passwordOk = user && (await bcrypt.compare(password, user.passwordHash))
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (!user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    res.json({
      token: signSession(user),
      user: user.toJSON(), // passwordHash stripped by the model's toJSON transform
    })
  } catch (err) {
    next(err)
  }
})

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    // Fresh DB lookup (not just the JWT claims) so a deactivated account is
    // cut off immediately rather than living out its shift.
    const user = await User.findById(req.auth.userId)
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account is inactive' })
    }
    res.json({ user: user.toJSON() })
  } catch (err) {
    next(err)
  }
})
