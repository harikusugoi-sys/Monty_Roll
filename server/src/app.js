import express from 'express'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { menuItemsRouter } from './routes/menuItems.js'
import { ordersRouter } from './routes/orders.js'
import { reconciliationRouter } from './routes/reconciliation.js'
import { auditLogsRouter } from './routes/auditLogs.js'

export function createApp() {
  const app = express()

  app.use(express.json())

  app.use('/api', healthRouter)
  app.use('/api', authRouter)
  app.use('/api', usersRouter)
  app.use('/api', menuItemsRouter)
  app.use('/api', ordersRouter)
  app.use('/api', reconciliationRouter)
  app.use('/api', auditLogsRouter)

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Central error handler — keep the response shape consistent
  app.use((err, _req, res, _next) => {
    console.error('[error]', err.message)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })

  return app
}
