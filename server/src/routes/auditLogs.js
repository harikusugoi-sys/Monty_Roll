import { Router } from 'express'
import { AuditLog } from '../models/auditLog.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const auditLogsRouter = Router()

// Owner-only read access to immutable audit trails
auditLogsRouter.use('/audit-logs', requireAuth, requireRole('owner'))

auditLogsRouter.get('/audit-logs', async (req, res, next) => {
  try {
    const { entityType, entityId, limit = 50 } = req.query
    const filter = {}
    if (entityType) filter.entityType = entityType
    if (entityId) filter.entityId = entityId

    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(Math.min(Number(limit) || 50, 100))
      .populate('actor', 'name username role')

    res.json({ logs })
  } catch (err) {
    next(err)
  }
})
