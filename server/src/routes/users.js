import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { User } from '../models/user.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const usersRouter = Router()

// All user-management routes are owner-only, checked server-side (architecture.md §7).
usersRouter.use('/users', requireAuth, requireRole('owner'))

usersRouter.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 })
    res.json({ users: users.map((u) => u.toJSON()) })
  } catch (err) {
    next(err)
  }
})

usersRouter.post('/users', async (req, res, next) => {
  try {
    const { name, username, password, role } = req.body || {}
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'name, username and password are required' })
    }
    // The owner seeds owners; this endpoint exists for staff accounts.
    if (role && role !== 'operator') {
      return res.status(400).json({ error: 'This endpoint creates operator accounts only' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({
      name,
      username: String(username).trim(),
      passwordHash,
      role: 'operator',
    })

    res.status(201).json({ user: user.toJSON() })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Username already exists' })
    }
    next(err)
  }
})

usersRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const { isActive } = req.body || {}
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive (boolean) is required' })
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { returnDocument: 'after', runValidators: true },
    )
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({ user: user.toJSON() })
  } catch (err) {
    next(err)
  }
})
