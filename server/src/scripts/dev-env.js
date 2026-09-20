/**
 * Dev-rig env defaults. Static imports evaluate in listing order, so this
 * module must be imported FIRST (before app/auth modules read env at load).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret'
// .env values must not win — this rig has exactly one known login
process.env.OWNER_USERNAME = '9999999999'
process.env.OWNER_PASSWORD = 'dev-test-pass'
process.env.OWNER_NAME = 'Dev Owner'
