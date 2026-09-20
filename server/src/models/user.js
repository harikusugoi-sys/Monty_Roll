import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true }, // phone number works fine
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'operator'], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// architecture.md §7: unique index on username — created by `unique: true` above

// Never let the hash leak out in JSON responses or logs.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash
    delete ret.__v
    return ret
  },
})

export const User = mongoose.model('User', userSchema)
