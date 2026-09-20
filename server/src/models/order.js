import mongoose from 'mongoose'

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    nameSnapshot: { type: String, required: true },
    priceSnapshot: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
)

const orderSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    orderNumber: { type: Number, required: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD local shop date
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['active', 'voided'], default: 'active', index: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'unsettled'],
      default: 'unsettled',
      index: true,
    },
    discount: {
      amount: { type: Number, default: 0 },
      reason: { type: String, default: null },
    },
    void: {
      voidedAt: { type: Date, default: null },
      reason: { type: String, default: null },
      voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
  },
  { timestamps: true },
)

// architecture.md §4: compound index for quick daily token queries
orderSchema.index({ date: 1, orderNumber: 1 })

export const Order = mongoose.model('Order', orderSchema)
