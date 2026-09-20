import mongoose from 'mongoose'

const priceHistorySchema = new mongoose.Schema(
  {
    oldPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, default: 'roll', trim: true },
    isActive: { type: Boolean, default: true },
    priceHistory: { type: [priceHistorySchema], default: [] },
  },
  { timestamps: true }, // createdAt + updatedAt
)

export const MenuItem = mongoose.model('MenuItem', menuItemSchema)
