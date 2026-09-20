import { Router } from 'express'
import { MenuItem } from '../models/menuItem.js'
import { User } from '../models/user.js'
import { writeAuditLog } from '../models/auditLog.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const menuItemsRouter = Router()

// Read: any authenticated user (the order-entry phone needs the menu).
menuItemsRouter.get('/menu-items', requireAuth, async (req, res, next) => {
  try {
    // Active items only by default (what operators need at the till);
    // owner can pass ?all=true to also see disabled items for editing.
    const filter = req.query.all === 'true' && req.auth.role === 'owner' ? {} : { isActive: true }
    const items = await MenuItem.find(filter)
      .sort({ name: 1 })
      .populate('priceHistory.changedBy', 'name username role')
    res.json({ items })
  } catch (err) {
    next(err)
  }
})

// Write: owner-only (phases.md step 3).
menuItemsRouter.post('/menu-items', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { name, price, category } = req.body || {}
    if (!name || price === undefined) {
      return res.status(400).json({ error: 'name and price are required' })
    }
    const priceNum = Number(price)
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' })
    }

    const item = await MenuItem.create({ name, price: priceNum, category })
    await writeAuditLog({
      entityType: 'menuItem',
      entityId: item._id,
      action: 'menu_edit',
      actor: req.auth.userId,
      meta: { created: true, name: item.name, price: item.price },
    })

    res.status(201).json({ item })
  } catch (err) {
    next(err)
  }
})

menuItemsRouter.patch('/menu-items/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const item = await MenuItem.findById(req.params.id)
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' })
    }

    const { name, price, isActive, category } = req.body || {}
    const priceChanged =
      price !== undefined && Number(price) !== item.price

    // --- price change → priceHistory + price_change audit entry (§4/§6) ---
    if (priceChanged) {
      const newPrice = Number(price)
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        return res.status(400).json({ error: 'price must be a non-negative number' })
      }
      item.priceHistory.push({
        oldPrice: item.price,
        newPrice,
        changedBy: req.auth.userId,
      })
      item.price = newPrice
    }

    // --- name / category / active state are plain menu edits ---
    let editedFields = []
    if (name !== undefined && name !== item.name) {
      item.name = String(name).trim()
      editedFields.push('name')
    }
    if (category !== undefined && category !== item.category) {
      item.category = category
      editedFields.push('category')
    }
    if (isActive !== undefined && isActive !== item.isActive) {
      item.isActive = Boolean(isActive)
      editedFields.push('isActive')
    }

    if (!priceChanged && editedFields.length === 0) {
      return res.json({ item, message: 'Nothing to update' })
    }

    await item.save() // updatedAt set automatically

    const actingUser = await User.findById(req.auth.userId).lean().catch(() => null)
    const actorName = actingUser?.name || 'Owner'
    const actorRole = req.auth.role || 'owner'

    if (priceChanged) {
      await writeAuditLog({
        entityType: 'menuItem',
        entityId: item._id,
        action: 'price_change',
        actor: req.auth.userId,
        meta: {
          oldPrice: item.priceHistory.at(-1).oldPrice,
          newPrice: item.price,
          actorName,
          actorRole,
        },
      })
    }
    if (editedFields.length > 0) {
      await writeAuditLog({
        entityType: 'menuItem',
        entityId: item._id,
        action: 'menu_edit',
        actor: req.auth.userId,
        meta: { fields: editedFields, actorName, actorRole },
      })
    }

    await item.populate('priceHistory.changedBy', 'name username role')
    res.json({ item })
  } catch (err) {
    next(err)
  }
})
