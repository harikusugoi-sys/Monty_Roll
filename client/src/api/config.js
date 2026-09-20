/**
 * API configuration helper.
 * Reads VITE_API_URL if configured (e.g. https://monty-roll.onrender.com).
 * If empty (default in local dev), returns relative path so Vite proxy forwards to localhost:4000.
 */
export const API_BASE = (import.meta.env.SERVER_API_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export function apiUrl(path) {
  if (!API_BASE) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalizedPath}`
}
