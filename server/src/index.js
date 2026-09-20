import 'dotenv/config'
import { connectDB } from './config/db.js'
import { createApp } from './app.js'
import { seedOwner } from './scripts/seed.js'

const PORT = process.env.PORT || 4000

await connectDB(process.env.MONGODB_URI)

if (process.env.OWNER_USERNAME && process.env.OWNER_PASSWORD) {
  try {
    await seedOwner()
  } catch (err) {
    console.warn('[seed] Auto-seed warning:', err.message)
  }
}

const app = createApp()
app.listen(PORT, () => {
  console.log(`[api] Roll Shop POS API listening on http://localhost:${PORT}`)
})
