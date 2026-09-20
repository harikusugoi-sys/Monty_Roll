import mongoose from 'mongoose'

/**
 * Connect to MongoDB. Exits the process on failure so nodemon/scripts
 * surface the problem immediately instead of limping along unconnected.
 */
export async function connectDB(uri) {
  if (!uri) {
    console.error('[db] MONGODB_URI is not set. Copy server/.env.example to server/.env and fill it in.')
    process.exit(1)
  }

  mongoose.set('strictQuery', true)

  try {
    await mongoose.connect(uri)
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message)
    process.exit(1)
  }

  const { host, name } = mongoose.connection
  console.log(`[db] Connected to MongoDB — host: ${host}, db: ${name}`)
  return mongoose.connection
}

/** Real round-trip check used by the /api/health route. */
export async function pingDB() {
  await mongoose.connection.db.admin().command({ ping: 1 })
}
