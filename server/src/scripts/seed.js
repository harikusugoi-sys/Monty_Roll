import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import { User } from '../models/user.js'

/**
 * Seeds the owner account from env vars (see .env.example).
 * Idempotent: if the username already exists, nothing is changed and the
 * script exits cleanly — safe to re-run at any time.
 *
 * Exported so the smoke test can drive it against an in-memory database;
 * when run directly (`pnpm --filter server seed`) it connects, seeds, and exits.
 */
export async function seedOwner() {
  const { OWNER_NAME, OWNER_USERNAME, OWNER_PASSWORD } = process.env

  if (!OWNER_USERNAME || !OWNER_PASSWORD) {
    throw new Error('OWNER_USERNAME and OWNER_PASSWORD must be set in server/.env')
  }

  const existing = await User.findOne({ username: OWNER_USERNAME })
  if (existing) {
    console.log(`[seed] Owner "${OWNER_USERNAME}" already exists — nothing to do.`)
    return { created: false }
  }

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 12)
  await User.create({
    name: OWNER_NAME || 'Shop Owner',
    username: OWNER_USERNAME,
    passwordHash,
    role: 'owner',
  })

  console.log(`[seed] Owner account created: ${OWNER_USERNAME} (${OWNER_NAME || 'Shop Owner'})`)
  return { created: true }
}

async function main() {
  await connectDB(process.env.MONGODB_URI)
  try {
    await seedOwner()
  } finally {
    await mongoose.disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((err) => {
    console.error('[seed] Failed:', err.message)
    process.exitCode = 1
  })
}
