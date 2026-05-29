import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

const AuthContext = createContext(null)

// Unique session ID generated per browser tab — stable for the lifetime of this tab
const tabSessionId = Math.random().toString(36).substring(2, 10)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [player, setPlayer] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isLockedOut, setIsLockedOut] = useState(false)

    // Refs so interval/event callbacks always see latest values WITHOUT triggering re-mounts
    const playerSubRef = useRef(null)
    const userRef = useRef(null)
    const isLockedOutRef = useRef(false)
    const lastHeartbeatRef = useRef(0)

    // Keep refs in sync with state (lightweight syncs, no effect re-run risks)
    useEffect(() => { userRef.current = user }, [user])
    useEffect(() => { isLockedOutRef.current = isLockedOut }, [isLockedOut])

    // ─── Profile Fetch ────────────────────────────────────────────────────────────
    const fetchPlayerProfile = async (userId) => {
        try {
            const { data, error } = await supabase
                .from('players')
                .select('*')
                .eq('id', userId)
                .single()
            if (error) throw error
            setPlayer(data)
            return data
        } catch (err) {
            console.error('Error fetching player profile:', err.message)
            return null
        }
    }

    // ─── Tab Session Init ─────────────────────────────────────────────────────────
    const initializeTabSession = async (userId) => {
        try {
            await supabase
                .from('players')
                .update({
                    session_id: tabSessionId,
                    active_session_id: tabSessionId,
                    current_status: 'Online',
                    last_online: new Date().toISOString(),
                    last_login: new Date().toISOString()
                })
                .eq('id', userId)
        } catch (err) {
            console.error('Error initializing tab session:', err.message)
        }
    }

    // ─── Realtime Row Subscription (session lock monitor) ────────────────────────
    const subscribeToPlayerRow = (userId) => {
        if (playerSubRef.current) {
            supabase.removeChannel(playerSubRef.current)
        }
        const channel = supabase
            .channel(`self_profile:${userId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players', filter: `id=eq.${userId}` },
                (payload) => {
                    setPlayer(payload.new)
                    // Lockout check: only fires when DB row changes, not on a timer
                    const locked = !!(payload.new.active_session_id && payload.new.active_session_id !== tabSessionId)
                    setIsLockedOut(locked)
                }
            )
            .subscribe()
        playerSubRef.current = channel
    }

    // ─── Session Steal ────────────────────────────────────────────────────────────
    const stealSession = async () => {
        const u = userRef.current
        if (!u) return
        try {
            await supabase
                .from('players')
                .update({
                    active_session_id: tabSessionId,
                    current_status: 'Online',
                    last_online: new Date().toISOString()
                })
                .eq('id', u.id)
            setIsLockedOut(false)
        } catch (err) {
            console.error('Error stealing session:', err.message)
        }
    }

    // ─── Account Deletion ─────────────────────────────────────────────────────────
    const deleteAccount = async () => {
        if (!userRef.current) return false
        try {
            const { error } = await supabase.rpc('delete_own_account')
            if (error) throw error
            await signOut()
            return true
        } catch (err) {
            console.error('Error deleting account:', err.message)
            alert('Failed to delete account: ' + err.message)
            return false
        }
    }

    // ─── Merge Check (runs once after Google OAuth redirect) ──────────────────────
    const checkAndMergeAccounts = async (currentUser) => {
        const mergeAnonId = localStorage.getItem('merge_anon_id')
        const mergeAnonToken = localStorage.getItem('merge_anon_token')
        if (!mergeAnonId || !mergeAnonToken) return

        const provider = currentUser.app_metadata?.provider || currentUser.identities?.[0]?.provider
        if (provider === 'google' || currentUser.email) {
            try {
                const { error } = await supabase.rpc('merge_anonymous_account', {
                    p_anon_id: mergeAnonId,
                    p_merge_token: mergeAnonToken
                })
                if (error) throw error
                console.log('Account merged successfully!')
            } catch (err) {
                console.error('Failed to merge accounts:', err.message)
            } finally {
                localStorage.removeItem('merge_anon_id')
                localStorage.removeItem('merge_anon_token')
            }
        }
    }

    // ─── Google Login ─────────────────────────────────────────────────────────────
    const initiateGoogleLogin = async () => {
        try {
            if (userRef.current && player?.is_anonymous) {
                const { data: token, error } = await supabase.rpc('generate_merge_token')
                if (error) throw error
                localStorage.setItem('merge_anon_id', userRef.current.id)
                localStorage.setItem('merge_anon_token', token)
            }
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin }
            })
            if (error) throw error
        } catch (err) {
            console.error('Google Sign-in error:', err.message)
            alert('Google login failed: ' + err.message)
        }
    }

    // ─── Anonymous Sign In ────────────────────────────────────────────────────────
    const signInAnonymously = async (displayName) => {
        try {
            setLoading(true)
            const { data, error } = await supabase.auth.signInAnonymously({
                options: {
                    data: {
                        is_anonymous: true,
                        player_name: displayName || ''
                    }
                }
            })
            if (error) throw error
            if (data.user && displayName) {
                await supabase
                    .from('players')
                    .update({ player_name: displayName })
                    .eq('id', data.user.id)
            }
            return data.user
        } catch (err) {
            console.error('Anonymous Sign-in error:', err.message)
            alert('Anonymous Login failed: ' + err.message)
            return null
        } finally {
            setLoading(false)
        }
    }

    // ─── Sign Out ─────────────────────────────────────────────────────────────────
    const signOut = async () => {
        const u = userRef.current
        try {
            if (u) {
                await supabase
                    .from('players')
                    .update({ current_status: 'Offline', last_online: new Date().toISOString() })
                    .eq('id', u.id)
            }
            if (playerSubRef.current) {
                supabase.removeChannel(playerSubRef.current)
                playerSubRef.current = null
            }
            await supabase.auth.signOut()
            setUser(null)
            setPlayer(null)
            setIsLockedOut(false)
            localStorage.removeItem('merge_anon_id')
            localStorage.removeItem('merge_anon_token')
        } catch (err) {
            console.error('Sign-out error:', err.message)
        }
    }

    // ─── Shared session setup ─────────────────────────────────────────────────────
    const setupSession = async (currentUser) => {
        userRef.current = currentUser
        setUser(currentUser)
        await checkAndMergeAccounts(currentUser)
        const profile = await fetchPlayerProfile(currentUser.id)
        if (profile) {
            await initializeTabSession(currentUser.id)
            // record the time we last updated `last_online` during session init
            lastHeartbeatRef.current = Date.now()
            subscribeToPlayerRow(currentUser.id)
        }
        setLoading(false)
    }

    // ─── MAIN EFFECT: runs exactly once on mount ──────────────────────────────────
    useEffect(() => {
        // onAuthStateChange emits INITIAL_SESSION immediately on mount, so we do NOT
        // need a separate getSession() call. That duplicate call was the primary spam source.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            const currentUser = session?.user || null

            if (event === 'INITIAL_SESSION') {
                if (currentUser) {
                    await setupSession(currentUser)
                } else {
                    setLoading(false)
                }
            } else if (event === 'SIGNED_IN') {
                await setupSession(currentUser)
            } else if (event === 'SIGNED_OUT') {
                userRef.current = null
                setUser(null)
                setPlayer(null)
                setIsLockedOut(false)
                setLoading(false)
                if (playerSubRef.current) {
                    supabase.removeChannel(playerSubRef.current)
                    playerSubRef.current = null
                }
            }
            // TOKEN_REFRESHED — intentionally ignored; the SDK handles it automatically.
        })

        // Heartbeat: throttle DB writes to at most once per minute
        const heartbeat = setInterval(() => {
            const u = userRef.current
            const now = Date.now()
            if (u && !isLockedOutRef.current) {
                // Only update if it's been more than 60s since last update
                if (now - (lastHeartbeatRef.current || 0) < 60000) return
                supabase
                    .from('players')
                    .update({ last_online: new Date().toISOString() })
                    .eq('id', u.id)
                    .then(() => { lastHeartbeatRef.current = Date.now(); try { console.debug('[Auth] heartbeat update for', u.id, new Date().toISOString()) } catch (e) { } })
            }
        }, 60000)

        return () => {
            subscription.unsubscribe()
            clearInterval(heartbeat)
            if (playerSubRef.current) {
                supabase.removeChannel(playerSubRef.current)
            }
        }
    }, []) // empty array — runs ONCE, never re-mounts

    return (
        <AuthContext.Provider
            value={{
                user,
                player,
                loading,
                isLockedOut,
                tabSessionId,
                signInAnonymously,
                signInWithGoogle: initiateGoogleLogin,
                signOut,
                stealSession,
                deleteAccount,
                refreshProfile: () => userRef.current ? fetchPlayerProfile(userRef.current.id) : null
            }}
        >
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) throw new Error('useAuth must be used within an AuthProvider')
    return context
}
