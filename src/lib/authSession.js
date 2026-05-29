import { supabase } from '../supabase'

let sessionPromise = null
/** Serializes authenticated work so parallel calls don't each trigger refresh_token. */
let opQueue = Promise.resolve()

function isSessionExpiringSoon(session, skewMs = 60_000) {
    if (!session?.expires_at) return true
    return session.expires_at * 1000 - Date.now() < skewMs
}

/**
 * Resolve session once per page load. Refreshes at most once here if the JWT is near expiry.
 * All later Supabase calls should go through runWithSession() so they reuse this token.
 */
export async function ensureSessionReady() {
    if (!sessionPromise) {
        sessionPromise = (async () => {
            const { data: { session }, error } = await supabase.auth.getSession()
            if (error) throw error
            if (!session) return null

            if (isSessionExpiringSoon(session)) {
                const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
                if (refreshError) throw refreshError
                return refreshed.session ?? session
            }

            return session
        })()
    }
    return sessionPromise
}

/** Back-compat alias used across the app. */
export function bootstrapSessionOnce() {
    return ensureSessionReady()
}

export function resetAuthBootstrap() {
    sessionPromise = null
    opQueue = Promise.resolve()
}

/**
 * Run a Supabase operation after session is ready, one at a time.
 * Prevents N parallel refresh_token calls before N REST requests.
 */
export function runWithSession(operation) {
    const run = opQueue.then(async () => {
        await ensureSessionReady()
        return operation()
    })
    opQueue = run.then(() => undefined, () => undefined)
    return run
}
