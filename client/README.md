# client — React + Vite PWA (order entry)

Offline-first order-entry PWA (phases.md step 4). Order taking reads/writes
IndexedDB via Dexie (`src/db/dexie.js`) and never waits on the network.
The Express API is reached through the Vite dev proxy (`/api → :4000`).

```
pnpm --filter client dev      # http://localhost:5173 (needs server running for login/menu)
pnpm --filter client build    # PWA build (service worker via vite-plugin-pwa)
```

Key files: `src/db/dexie.js` (schema + token counter + menu cache),
`src/screens/OrderEntry.jsx` (grid, cart bar, Generate Token),
`src/auth/session.js` (once-per-shift login cache).
