import { Router } from 'express'
import { Order } from '../models/order.js'
import { writeAuditLog } from '../models/auditLog.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const ordersRouter = Router()

// All order endpoints require authentication
ordersRouter.use('/orders', requireAuth)

// 1. Single order creation (idempotent upsert by clientId) — operator or owner
ordersRouter.post('/orders', async (req, res, next) => {
  try {
    const {
      clientId,
      orderNumber,
      date,
      items,
      totalAmount,
      paymentMethod = 'unsettled',
      status = 'active',
      void: voidData,
    } = req.body || {}

    if (!clientId || orderNumber === undefined || !date || !items || totalAmount === undefined) {
      return res.status(400).json({ error: 'clientId, orderNumber, date, items, and totalAmount are required' })
    }

    // Upsert so retrying a dropped connection never duplicates the order
    const order = await Order.findOneAndUpdate(
      { clientId },
      {
        $setOnInsert: {
          clientId,
          orderNumber: Number(orderNumber),
          date,
          createdBy: req.auth.userId,
          status,
          items,
          totalAmount: Number(totalAmount),
          paymentMethod,
          void: voidData || { voidedAt: null, reason: null, voidedBy: null },
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    res.status(201).json({ order })
  } catch (err) {
    next(err)
  }
})

// 2. Batch sync for offline write queue — operator or owner
ordersRouter.post('/orders/sync', async (req, res, next) => {
  try {
    const { orders = [] } = req.body || {}
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders array is required' })
    }

    const syncedClientIds = []
    for (const ord of orders) {
      if (!ord.clientId) continue
      await Order.findOneAndUpdate(
        { clientId: ord.clientId },
        {
          $setOnInsert: {
            clientId: ord.clientId,
            orderNumber: Number(ord.orderNumber),
            date: ord.date,
            createdBy: req.auth.userId,
            status: ord.status || 'active',
            items: ord.items,
            totalAmount: Number(ord.totalAmount),
            paymentMethod: ord.paymentMethod || 'unsettled',
            void: ord.void || { voidedAt: null, reason: null, voidedBy: null },
          },
        },
        { upsert: true },
      )
      syncedClientIds.push(ord.clientId)
    }

    res.json({ synced: syncedClientIds.length, syncedClientIds })
  } catch (err) {
    next(err)
  }
})

// 3. Query orders by date for reports and daily reconciliation — owner only
ordersRouter.get('/orders', requireRole('owner'), async (req, res, next) => {
  try {
    const { date } = req.query
    const filter = date ? { date } : {}
    const orders = await Order.find(filter).sort({ orderNumber: -1 })
    res.json({ orders })
  } catch (err) {
    next(err)
  }
})

// 4. Update payment method — operator or owner
ordersRouter.patch('/orders/:id/payment', async (req, res, next) => {
  try {
    const { paymentMethod } = req.body || {}
    if (!['cash', 'upi', 'unsettled'].includes(paymentMethod)) {
      return res.status(400).json({ error: "paymentMethod must be 'cash', 'upi', or 'unsettled'" })
    }

    // Match either Mongo _id or client-side UUID clientId
    const id = req.params.id
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id)
    const filter = isObjectId ? { $or: [{ _id: id }, { clientId: id }] } : { clientId: id }

    const order = await Order.findOneAndUpdate(
      filter,
      { paymentMethod },
      { returnDocument: 'after' },
    )
    if (!order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    res.json({ order })
  } catch (err) {
    next(err)
  }
})

// 5. Void order with mandatory reason — owner only (writes to immutable auditLogs)
ordersRouter.patch('/orders/:id/void', requireRole('owner'), async (req, res, next) => {
  try {
    const { reason } = req.body || {}
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A mandatory reason is required to void an order' })
    }

    const id = req.params.id
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id)
    const filter = isObjectId ? { $or: [{ _id: id }, { clientId: id }] } : { clientId: id }

    const order = await Order.findOne(filter)
    if (!order) {
      return res.status(404).json({ error: 'Order not found' })
    }
    if (order.status === 'voided') {
      return res.status(400).json({ error: 'Order is already voided' })
    }

    order.status = 'voided'
    order.void = {
      voidedAt: new Date(),
      reason: String(reason).trim(),
      voidedBy: req.auth.userId,
    }
    await order.save()

    // Write immutable audit log entry
    await writeAuditLog({
      entityType: 'order',
      entityId: order._id,
      action: 'void',
      actor: req.auth.userId,
      reason: order.void.reason,
      meta: {
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
      },
    })

    res.json({ order })
  } catch (err) {
    next(err)
  }
})
