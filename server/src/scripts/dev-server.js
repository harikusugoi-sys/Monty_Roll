/**
 * DEV ONLY — local test rig: in-memory MongoDB + API on :4000 with a seeded
 * owner and sample menu, so the client can be exercised end-to-end without
 * Atlas. Never use in production (data vanishes when it stops).
 *
 * Run with: pnpm --filter server dev:mock
 * Login: username 9999999999 / password dev-test-pass
 */
import 'dotenv/config'
import './dev-env.js' // must precede app imports — see file comment
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import { createApp } from '../app.js'
import { seedOwner } from './seed.js'
import { MenuItem } from '../models/menuItem.js'


console.log('[dev] Starting in-memory MongoDB...')
const mongod = await MongoMemoryServer.create()
await connectDB(mongod.getUri('rollshop-dev'))
await seedOwner()

const sampleMenu = [
  { name: 'Veg Roll', price: 50 },
  { name: 'Paneer Roll', price: 70 },
  { name: 'Egg Roll', price: 60 },
  { name: 'Chicken Roll', price: 90 },
  { name: 'Double Paneer Roll', price: 110 },
  { name: 'Special Mutton Roll', price: 140 },
]
await MenuItem.insertMany(sampleMenu)
console.log(`[dev] Seeded ${sampleMenu.length} menu items`)

const app = createApp()
const PORT = Number(process.env.PORT) || 4000
app.listen(PORT, () => {
  console.log(`[dev] Mock API ready on http://localhost:${PORT} (login: 9999999999 / dev-test-pass)`)
})

process.on('SIGINT', async () => {
  await mongoose.disconnect()
  await mongod.stop()
  process.exit(0)
})
