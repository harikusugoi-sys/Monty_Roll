import mongoose from 'mongoose'

const reconciliationSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
    appTotalRevenue: { type: Number, required: true },
    appCashExpected: { type: Number, required: true },
    upiActualSettled: { type: Number, required: true },
    cashActualCounted: { type: Number, required: true },
    discrepancy: { type: Number, required: true },
    notes: { type: String, default: '' },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

export const DailyReconciliation = mongoose.model('DailyReconciliation', reconciliationSchema)
