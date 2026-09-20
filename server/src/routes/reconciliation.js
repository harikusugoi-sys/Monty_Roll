import { Router } from 'express'
import { DailyReconciliation } from '../models/reconciliation.js'
import { Order } from '../models/order.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const reconciliationRouter = Router()

// All reconciliation routes are owner-only
reconciliationRouter.use('/reconciliation', requireAuth, requireRole('owner'))

reconciliationRouter.get('/reconciliation', async (req, res, next) => {
  try {
    const { date, days } = req.query
    if (date) {
      const rec = await DailyReconciliation.findOne({ date })
      return res.json({ reconciliation: rec })
    }
    const limit = Math.min(Number(days) || 7, 60)
    const raw = await DailyReconciliation.find().sort({ date: -1 }).limit(limit)
    const history = raw.reverse() // oldest to newest for trend visualization
    res.json({ history })
  } catch (err) {
    next(err)
  }
})

reconciliationRouter.post('/reconciliation', async (req, res, next) => {
  try {
    const { date, upiActualSettled, cashActualCounted, notes = '' } = req.body || {}
    if (!date || upiActualSettled === undefined || cashActualCounted === undefined) {
      return res.status(400).json({ error: 'date, upiActualSettled, and cashActualCounted are required' })
    }

    const upiSettled = Number(upiActualSettled)
    const cashCounted = Number(cashActualCounted)
    if (!Number.isFinite(upiSettled) || !Number.isFinite(cashCounted)) {
      return res.status(400).json({ error: 'Amounts must be valid numbers' })
    }

    // Compute expected figures from actual orders in MongoDB for that date
    const activeOrders = await Order.find({ date, status: 'active' })
    const appTotalRevenue = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    const appCashExpected = activeOrders
      .filter((o) => o.paymentMethod === 'cash')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0)

    // Formula per design doc §2:
    // Expected Cash = Total Revenue - UPI Settled (anchored to external UPI statement)
    // Discrepancy = Actual Cash Counted - Expected Cash
    const expectedCash = appTotalRevenue - upiSettled
    const discrepancy = cashCounted - expectedCash

    const reconciliation = await DailyReconciliation.findOneAndUpdate(
      { date },
      {
        date,
        appTotalRevenue,
        appCashExpected,
        upiActualSettled: upiSettled,
        cashActualCounted: cashCounted,
        discrepancy,
        notes: String(notes || '').trim(),
        closedBy: req.auth.userId,
      },
      { upsert: true, returnDocument: 'after' },
    )

    res.status(201).json({ reconciliation })
  } catch (err) {
    next(err)
  }
})
