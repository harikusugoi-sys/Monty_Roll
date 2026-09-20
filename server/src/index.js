import 'dotenv/config'
import { connectDB } from './config/db.js'
import { createApp } from './app.js'

const PORT = process.env.PORT || 4000

await connectDB(process.env.MONGODB_URI)

const app = createApp()
app.listen(PORT, () => {
  console.log(`[api] Roll Shop POS API listening on http://localhost:${PORT}`)
})
