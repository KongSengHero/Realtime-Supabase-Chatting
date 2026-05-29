import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { ensureSessionReady, resetAuthBootstrap, runWithSession } from '../lib/authSession'

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
    const playerRef = useRef(null)
    const isLockedOutRef = useRef(false)
    const lastProfileFetchRef = useRef(0)
    const sessionReadyForRef = useRef(null)
    const setupInProgressRef = useRef(false)

    const PLAYER_SYNC_FIELDS = [
        'current_lobby_id', 'current_status', 'player_name', 'profile_url',
        'banner_url', 'is_anonymous', 'active_session_id', 'session_id', 'player_id'
    ]

    // Keep refs in sync with state (lightweight syncs, no effect re-run risks)
    useEffect(() => { userRef.current = user }, [user])
    useEffect(() => { playerRef.current = player }, [player])
    useEffect(() => { isLockedOutRef.current = isLockedOut }, [isLockedOut])

    const patchPlayer = (partial) => {
        setPlayer(prev => (prev ? { ...prev, ...partial } : prev))
    }

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
    // Subscribe to updates on the player's row. Prefer subscribing by public `player_id`
    // when available to avoid exposing the DB primary key in network requests.
    const subscribeToPlayerRow = (userId, playerPublicId) => {
        if (playerSubRef.current) {
            supabase.removeChannel(playerSubRef.current)
        }
        const topicId = playerPublicId || userId
        const filter = playerPublicId ? `player_id=eq.${playerPublicId}` : `id=eq.${userId}`
        const channel = supabase
            .channel(`self_profile:${topicId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players', filter },
                (payload) => {
                    const next = payload.new
                    const locked = !!(next.active_session_id && next.active_session_id !== tabSessionId)
                    setIsLockedOut(locked)
                    // Ignore heartbeat-only updates (last_online) to avoid cascading re-renders
                    setPlayer(prev => {
                        if (!prev) return next
                        const meaningful = PLAYER_SYNC_FIELDS.some(k => prev[k] !== next[k])
                        return meaningful ? { ...prev, ...next } : prev
                    })
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
            resetAuthBootstrap()
            sessionReadyForRef.current = null
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
        if (!currentUser) return
        if (sessionReadyForRef.current === currentUser.id) return
        if (setupInProgressRef.current) return

        setupInProgressRef.current = true
        try {
            sessionReadyForRef.current = currentUser.id
            await runWithSession(async () => {
                userRef.current = currentUser
                setUser(currentUser)
                await checkAndMergeAccounts(currentUser)
                const profile = await fetchPlayerProfile(currentUser.id)
                if (profile) {
                    await initializeTabSession(currentUser.id)
                    lastProfileFetchRef.current = Date.now()
                    subscribeToPlayerRow(currentUser.id, profile.player_id)
                }
            })
        } finally {
            setupInProgressRef.current = false
            setLoading(false)
        }
    }

    const refreshProfile = async () => {
        const u = userRef.current
        if (!u) return null
        const now = Date.now()
        if (now - lastProfileFetchRef.current < 5000) return playerRef.current
        lastProfileFetchRef.current = now
        return fetchPlayerProfile(u.id)
    }

    // ─── MAIN EFFECT: one getSession on load, lightweight auth listener after ─────
    useEffect(() => {
        let cancelled = false

        const runBootstrap = async () => {
            try {
                const session = await ensureSessionReady()
                if (cancelled) return
                if (session?.user) {
                    await setupSession(session.user)
                } else {
                    setLoading(false)
                }
            } catch (err) {
                console.error('Auth bootstrap failed:', err.message)
                if (!cancelled) setLoading(false)
            }
        }

        runBootstrap()

        // Never await inside this callback — async work causes nested getSession/refresh loops.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return

            if (event === 'SIGNED_OUT') {
                userRef.current = null
                sessionReadyForRef.current = null
                resetAuthBootstrap()
                setUser(null)
                setPlayer(null)
                setIsLockedOut(false)
                setLoading(false)
                if (playerSubRef.current) {
                    supabase.removeChannel(playerSubRef.current)
                    playerSubRef.current = null
                }
                return
            }

            if (event === 'SIGNED_IN' && session?.user) {
                resetAuthBootstrap()
                queueMicrotask(() => {
                    if (!cancelled) {
                        ensureSessionReady()
                            .then(() => setupSession(session.user))
                            .catch((err) => console.error('Sign-in session setup failed:', err.message))
                    }
                })
            }
        })

        return () => {
            cancelled = true
            subscription.unsubscribe()
            if (playerSubRef.current) {
                supabase.removeChannel(playerSubRef.current)
            }
        }
    }, [])

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
                refreshProfile,
                patchPlayer
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
