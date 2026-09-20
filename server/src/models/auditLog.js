import mongoose from 'mongoose'

/**
 * Append-only audit trail. There is intentionally NO update or delete route
 * for this collection anywhere in the API (architecture.md §4/§7) — writes
 * happen only as a side effect of privileged actions (void, discount,
 * price_change, menu_edit), never from a client POST.
 */
const auditLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, enum: ['order', 'menuItem'], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: { type: String, enum: ['void', 'discount', 'price_change', 'menu_edit'], required: true },
    reason: { type: String, default: null }, // mandatory for void/discount (enforced at the call sites that write them)
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: false },
)

// architecture.md §4: quick per-entity history lookups
auditLogSchema.index({ entityId: 1, timestamp: -1 })

export const AuditLog = mongoose.model('AuditLog', auditLogSchema)

/** Internal helper — the ONLY way anything gets written to this collection. */
export function writeAuditLog({ entityType, entityId, action, actor, reason = null, meta = {} }) {
  return AuditLog.create({ entityType, entityId, action, actor, reason, meta })
}
