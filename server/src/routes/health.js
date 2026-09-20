import { Router } from 'express'
import { pingDB } from '../config/db.js'

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  try {
    await pingDB()
    res.json({ status: 'ok', db: 'connected' })
  } catch {
    res.status(503).json({ status: 'ok', db: 'unreachable' })
  }
})
