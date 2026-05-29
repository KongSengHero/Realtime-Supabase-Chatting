import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { ensureSessionReady, runWithSession } from '../lib/authSession'
import { useAuth } from './AuthContext'

const RealtimeContext = createContext(null)

export const RealtimeProvider = ({ children }) => {
    const { user, player, patchPlayer } = useAuth()

    // Real-time states
    const [activeLobby, setActiveLobby] = useState(null)
    const [lobbyMessages, setLobbyMessages] = useState([])
    const [friends, setFriends] = useState([])
    const [friendRequests, setFriendRequests] = useState({ received: [], sent: [] })
    const [onlinePresence, setOnlinePresence] = useState({})
    const [incomingInvite, setIncomingInvite] = useState(null)     // { lobbyId, joinCode, hostName, hostId }
    const [incomingJoinReq, setIncomingJoinReq] = useState(null)     // { lobbyId, playerName, playerId }

    // Cooldown mapping: key: player_id, value: timestamp of last action
    const [cooldowns, setCooldowns] = useState({})

    const inboxChannelRef = useRef(null)
    const lobbyChannelRef = useRef(null)
    const socialChannelRef = useRef(null)
    const friendStatusChannelRef = useRef(null)
    const lastSocialFetchRef = useRef(0)
    const socialFetchInFlightRef = useRef(false)
    const presenceChannelRef = useRef(null)
    const SOCIAL_FETCH_MIN_MS = 8000
    const FRIEND_PLAYER_FIELDS = 'id, player_id, player_name, profile_url, current_status, current_lobby_id, last_online'
    const makeHexId = () => Math.random().toString(16).substring(2, 10).toUpperCase()
    // Ref-based user snapshot so handlers can be called from realtime without stale closures
    const userRef = useRef(user)
    useEffect(() => { userRef.current = user }, [user])

    // ─────────────────────────────────────────────────────────
    // SOCIAL & FRIENDSHIPS FETCH & TRIGGERS
    // ─────────────────────────────────────────────────────────
    const fetchSocialData = async ({ force = false } = {}) => {
        const currentUser = userRef.current
        if (!currentUser) return

        const now = Date.now()
        if (!force && lastSocialFetchRef.current && now - lastSocialFetchRef.current < SOCIAL_FETCH_MIN_MS) {
            return
        }
        if (socialFetchInFlightRef.current) return

        return runWithSession(async () => {
            socialFetchInFlightRef.current = true
            lastSocialFetchRef.current = now
            try {
                const { data: snapshot, error: rpcError } = await supabase.rpc('get_social_snapshot')
                if (rpcError) throw rpcError
                setFriends(snapshot?.friends || [])
                setFriendRequests({
                    received: snapshot?.received || [],
                    sent: snapshot?.sent || []
                })
            } catch (err) {
                console.error('Error fetching social data:', err.message)
            } finally {
                socialFetchInFlightRef.current = false
            }
        })
    }

    const fetchPlayerSocialProfile = async (playerUuid) => {
        const { data, error } = await supabase
            .from('players')
            .select(FRIEND_PLAYER_FIELDS)
            .eq('id', playerUuid)
            .single()
        if (error) {
            console.error('Error fetching player profile:', error.message)
            return null
        }
        return data
    }

    const handleSocialPostgresChange = (payload) => {
        const uid = userRef.current?.id
        if (!uid) return

        const { eventType, table } = payload
        const row = payload.new || payload.old
        if (!row) return

        if (table === 'player_friendships') {
            const otherId = row.player_one_id === uid ? row.player_two_id : row.player_one_id
            if (eventType === 'INSERT') {
                runWithSession(async () => {
                    const profile = await fetchPlayerSocialProfile(otherId)
                    if (!profile) return
                    setFriends(prev => (prev.some(f => f.id === otherId) ? prev : [...prev, profile]))
                }).catch((err) => console.error('Friendship insert sync failed:', err.message))
            } else if (eventType === 'DELETE') {
                setFriends(prev => prev.filter(f => f.id !== otherId))
            }
            return
        }

        if (table === 'player_friend_requests') {
            if (eventType === 'INSERT') {
                const isReceived = row.recipient_id === uid
                const otherId = isReceived ? row.requester_id : row.recipient_id
                runWithSession(async () => {
                    const profile = await fetchPlayerSocialProfile(otherId)
                    if (!profile) return
                    const listKey = isReceived ? 'received' : 'sent'
                    setFriendRequests(prev => {
                        if (prev[listKey].some(r => r.id === otherId)) return prev
                        return { ...prev, [listKey]: [...prev[listKey], profile] }
                    })
                }).catch((err) => console.error('Friend request insert sync failed:', err.message))
            } else if (eventType === 'DELETE') {
                setFriendRequests(prev => {
                    let next = prev
                    if (row.requester_id === uid) {
                        next = { ...next, sent: next.sent.filter(r => r.id !== row.recipient_id) }
                    }
                    if (row.recipient_id === uid) {
                        next = { ...next, received: next.received.filter(r => r.id !== row.requester_id) }
                    }
                    return next
                })
            }
        }
        // Ensure eventual consistency by refreshing the social snapshot (throttled).
        try {
            fetchSocialData()
        } catch (err) {
            console.error('Error triggering social snapshot refresh:', err?.message || err)
        }
    }

    // Handle Send Friend Request
    const sendFriendRequest = async (searchTerm) => {
        if (!user) return { success: false, message: 'Not logged in' }
        try {
            return await runWithSession(async () => {
                const { data: foundPlayers, error } = await supabase
                    .from('players')
                    .select('id, player_id, player_name')
                    .or(`player_name.eq."${searchTerm}",player_id.eq."${searchTerm}"`)

                if (error) throw error
                if (!foundPlayers?.length) {
                    return { success: false, message: 'Player not found.' }
                }

                const target = foundPlayers[0]
                if (target.id === user.id) {
                    return { success: false, message: 'You cannot add yourself.' }
                }
                if (friends.some(f => f.id === target.id)) {
                    return { success: false, message: 'You are already friends.' }
                }

                const { error: insError } = await supabase
                    .from('player_friend_requests')
                    .insert({ requester_id: user.id, recipient_id: target.id })

                if (insError) throw insError

                setFriendRequests(prev => (
                    prev.sent.some(r => r.id === target.id)
                        ? prev
                        : { ...prev, sent: [...prev.sent, target] }
                ))
                return { success: true, message: `Friend request sent to ${target.player_name}!` }
            })
        } catch (err) {
            console.error(err)
            return { success: false, message: 'Request already exists or failed to send.' }
        }
    }

    const acceptFriendRequest = async (requesterId) => {
        if (!user) return
        const acceptedProfile = friendRequests.received.find(r => r.id === requesterId)
        try {
            await runWithSession(async () => {
                await supabase
                    .from('player_friend_requests')
                    .delete()
                    .eq('requester_id', requesterId)
                    .eq('recipient_id', user.id)

                const p1 = user.id.localeCompare(requesterId) < 0 ? user.id : requesterId
                const p2 = user.id.localeCompare(requesterId) < 0 ? requesterId : user.id

                const { error } = await supabase
                    .from('player_friendships')
                    .insert({ player_one_id: p1, player_two_id: p2 })

                if (error) throw error
            })

            setFriendRequests(prev => ({
                ...prev,
                received: prev.received.filter(r => r.id !== requesterId)
            }))
            if (acceptedProfile) {
                setFriends(prev => (prev.some(f => f.id === requesterId) ? prev : [...prev, acceptedProfile]))
            }
        } catch (err) {
            console.error('Error accepting friend request:', err.message)
        }
    }

    const rejectFriendRequest = async (requesterId) => {
        if (!user) return
        try {
            await runWithSession(async () => {
                await supabase
                    .from('player_friend_requests')
                    .delete()
                    .eq('requester_id', requesterId)
                    .eq('recipient_id', user.id)
            })
            setFriendRequests(prev => ({
                ...prev,
                received: prev.received.filter(r => r.id !== requesterId)
            }))
        } catch (err) {
            console.error('Error rejecting friend request:', err.message)
        }
    }

    const cancelSentFriendRequest = async (recipientId) => {
        if (!user) return
        try {
            await runWithSession(async () => {
                await supabase
                    .from('player_friend_requests')
                    .delete()
                    .eq('requester_id', user.id)
                    .eq('recipient_id', recipientId)
            })
            setFriendRequests(prev => ({
                ...prev,
                sent: prev.sent.filter(r => r.id !== recipientId)
            }))
        } catch (err) {
            console.error('Error cancelling friend request:', err.message)
        }
    }

    const removeFriend = async (friendId) => {
        if (!user) return
        try {
            await runWithSession(async () => {
                const p1 = user.id.localeCompare(friendId) < 0 ? user.id : friendId
                const p2 = user.id.localeCompare(friendId) < 0 ? friendId : user.id

                await supabase
                    .from('player_friendships')
                    .delete()
                    .eq('player_one_id', p1)
                    .eq('player_two_id', p2)
            })
            setFriends(prev => prev.filter(f => f.id !== friendId))
        } catch (err) {
            console.error('Error removing friend:', err.message)
        }
    }

    // ─────────────────────────────────────────────────────────
    // LOBBY REAL-TIME WORKFLOW
    // ─────────────────────────────────────────────────────────

    // Set up real-time subscription for lobby row
    const subscribeToLobby = (lobbyId) => {
        if (lobbyChannelRef.current) {
            supabase.removeChannel(lobbyChannelRef.current)
        }

        const channel = supabase
            .channel(`lobby_sync:${lobbyId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'lobbies',
                    filter: `id=eq.${lobbyId}`
                },
                (payload) => {
                    if (payload.eventType === 'DELETE') {
                        setActiveLobby(null)
                        setLobbyMessages([])
                        patchPlayer({ current_lobby_id: null, current_status: 'Online' })
                    } else {
                        setActiveLobby(payload.new)

                        if (payload.new.lobby_state?.Players) {
                            const inside = Object.keys(payload.new.lobby_state.Players).includes(user?.id)
                            if (!inside) {
                                setActiveLobby(null)
                                setLobbyMessages([])
                                patchPlayer({ current_lobby_id: null, current_status: 'Online' })
                                alert('You have been kicked from the lobby.')
                            }
                        }
                    }
                }
            )
            // Listen for chat messages and transient signals via lobby broadcast channel
            .on('broadcast', { event: 'chat' }, (payload) => {
                setLobbyMessages(prev => [...prev, payload.payload])
            })
            .on('broadcast', { event: 'kick' }, (payload) => {
                if (payload.payload.kickedPlayerId === user?.id) {
                    setActiveLobby(null)
                    setLobbyMessages([])
                    patchPlayer({ current_lobby_id: null, current_status: 'Online' })
                    alert('You have been kicked by the host.')
                }
            })
            .subscribe()

        lobbyChannelRef.current = channel
    }

    // Host a Lobby
    const hostLobby = async (lobbyType) => {
        if (!user || !player) return null
        try {
            return await runWithSession(async () => {
            const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase()
            const initialLobbyState = {
                SessionId: Math.random().toString(36).substring(2, 10),
                Players: {}
            }

            // 1. Create the lobby
            const { data: lobbyData, error } = await supabase
                .from('lobbies')
                .insert({
                    join_code: joinCode,
                    host_id: user.id,
                    lobby_type: lobbyType, // 'Champion' or 'Anonymous'
                    lobby_state: initialLobbyState,
                    is_private: false
                })
                .select()
                .single()

            if (error) throw error

            // 2. Update player row
            await supabase
                .from('players')
                .update({
                    current_lobby_id: lobbyData.id,
                    current_status: 'Lobby'
                })
                .eq('id', user.id)

            setActiveLobby(lobbyData)
            setLobbyMessages([])
            subscribeToLobby(lobbyData.id)
            patchPlayer({ current_lobby_id: lobbyData.id, current_status: 'Lobby' })
            return lobbyData
            })
        } catch (err) {
            console.error('Error hosting lobby:', err.message)
            alert('Failed to host lobby: ' + err.message)
            return null
        }
    }

    // Make Lobby Private (Password protection)
    const setLobbyPassword = async (password) => {
        if (!activeLobby) return
        try {
            await runWithSession(async () => {
            const { error } = await supabase.rpc('set_lobby_password', {
                p_lobby_id: activeLobby.id,
                p_password: password
            })
            if (error) throw error
            })
        } catch (err) {
            console.error('Error locking lobby:', err.message)
        }
    }

    // Make Lobby Public (Remove password)
    const removeLobbyPassword = async () => {
        if (!activeLobby) return
        try {
            await runWithSession(async () => {
            const { error } = await supabase.rpc('remove_lobby_password', {
                p_lobby_id: activeLobby.id
            })
            if (error) throw error
            })
        } catch (err) {
            console.error('Error unlocking lobby:', err.message)
        }
    }

    // Join a Lobby
    const joinLobby = async (joinCode, password = '') => {
        if (!user || !player) return { success: false, message: 'Not logged in' }
        try {
            return await runWithSession(async () => {
            const { data: lobby, error } = await supabase
                .from('lobbies')
                .select('*')
                .eq('join_code', joinCode.toUpperCase())
                .single()

            if (error || !lobby) {
                return { success: false, message: 'Lobby not found. Check the code.' }
            }

            if (lobby.lobby_type === 'Anonymous') {
                return { success: false, message: 'Anonymous lobbies are strictly private.' }
            }

            // Check password if private
            if (lobby.is_private) {
                const { data: isValid, error: pCheckErr } = await supabase.rpc('verify_lobby_password', {
                    p_lobby_id: lobby.id,
                    p_password: password
                })

                if (pCheckErr || !isValid) {
                    return { success: false, message: 'Incorrect password.' }
                }
            }

            // Add to lobby_state (guests only). Assign an 8-char hex ID for the player.
            const state = lobby.lobby_state || {}
            state.Players = state.Players || {}
            state.Players[user.id] = {
                id: makeHexId(),
                name: player.player_name,
                profileUrl: player.profile_url,
                isHost: false
            }

            // Update lobby row
            const { error: updErr } = await supabase
                .from('lobbies')
                .update({ lobby_state: state })
                .eq('id', lobby.id)

            if (updErr) throw updErr

            // Update player profile
            await supabase
                .from('players')
                .update({
                    current_lobby_id: lobby.id,
                    current_status: 'Lobby'
                })
                .eq('id', user.id)

            setActiveLobby({ ...lobby, lobby_state: state })
            setLobbyMessages([])
            subscribeToLobby(lobby.id)
            patchPlayer({ current_lobby_id: lobby.id, current_status: 'Lobby' })
            return { success: true }
            })
        } catch (err) {
            console.error('Error joining lobby:', err.message)
            return { success: false, message: err.message }
        }
    }

    // Hydrate lobby from host broadcast confirmation to avoid an extra REST join flow.
    const hydrateLobbyFromInvite = (payload) => {
        if (!payload?.lobbySnapshot?.id) return { success: false, message: 'Invalid invite payload.' }
        const lobby = payload.lobbySnapshot
        setActiveLobby(lobby)
        setLobbyMessages([])
        subscribeToLobby(lobby.id)
        patchPlayer({ current_lobby_id: lobby.id, current_status: 'Lobby' })
        return { success: true }
    }

    // Leave Lobby
    const leaveLobby = async () => {
        if (!activeLobby || !user) return
        try {
            await runWithSession(async () => {
            const isHost = activeLobby.host_id === user.id

            if (isHost) {
                // Host leaving -> Clear lobby rows and other players' lobby ID
                // Get all guests currently in the lobby to notify/clear their state
                const guestIds = Object.keys(activeLobby.lobby_state?.Players || {}).filter(id => id !== user.id)

                if (guestIds.length > 0) {
                    await supabase
                        .from('players')
                        .update({ current_lobby_id: null, current_status: 'Online' })
                        .in('id', guestIds)
                }

                // Delete the lobby
                await supabase
                    .from('lobbies')
                    .delete()
                    .eq('id', activeLobby.id)
            } else {
                // Guest leaving -> Remove self from Players
                const state = activeLobby.lobby_state
                if (state?.Players) {
                    delete state.Players[user.id]
                }

                await supabase
                    .from('lobbies')
                    .update({ lobby_state: state })
                    .eq('id', activeLobby.id)
            }

            // Set self player row to online and clear lobby ID
            await supabase
                .from('players')
                .update({ current_lobby_id: null, current_status: 'Online' })
                .eq('id', user.id)

            if (lobbyChannelRef.current) {
                supabase.removeChannel(lobbyChannelRef.current)
                lobbyChannelRef.current = null
            }

            setActiveLobby(null)
            setLobbyMessages([])
            patchPlayer({ current_lobby_id: null, current_status: 'Online' })
            })
        } catch (err) {
            console.error('Error leaving lobby:', err.message)
        }
    }

    // Kick Player
    const kickPlayer = async (guestUuid) => {
        if (!activeLobby || activeLobby.host_id !== user?.id) return
        try {
            await runWithSession(async () => {
            // Remove guest from Players state
            const state = activeLobby.lobby_state
            if (state?.Players) {
                delete state.Players[guestUuid]
            }

            // Send transient broadcast kick event to sync guest screen instantly
            if (lobbyChannelRef.current) {
                await lobbyChannelRef.current.send({
                    type: 'broadcast',
                    event: 'kick',
                    payload: { kickedPlayerId: guestUuid }
                })
            }

            // Remove lobby ID from guest player profile
            await supabase
                .from('players')
                .update({ current_lobby_id: null, current_status: 'Online' })
                .eq('id', guestUuid)

            // Update lobby row
            await supabase
                .from('lobbies')
                .update({ lobby_state: state })
                .eq('id', activeLobby.id)
            })
        } catch (err) {
            console.error('Error kicking guest:', err.message)
        }
    }

    // Send Lobby Chat Message
    const sendLobbyMessage = async (messageText) => {
        if (!activeLobby || !user || !player) return
        try {
            const chatMsg = {
                senderId: user.id,
                senderName: player.player_name,
                profileUrl: player.profile_url,
                text: messageText,
                timestamp: new Date().toISOString()
            }

            if (lobbyChannelRef.current) {
                await lobbyChannelRef.current.send({
                    type: 'broadcast',
                    event: 'chat',
                    payload: chatMsg
                })
            }

            // Optimistically append to local state
            setLobbyMessages(prev => [...prev, chatMsg])
        } catch (err) {
            console.error('Error sending message:', err.message)
        }
    }

    // ─────────────────────────────────────────────────────────
    // BROADCAST FLOW: INVITES & JOIN REQUESTS (COOLDOWN CHECKED)
    // ─────────────────────────────────────────────────────────

    // Set up personal broadcast mailbox for invites/join requests
    // Subscribe to the personal inbox channel using the public `player_id`.
    // `userId` here is expected to be the public `player_id` (string) when available.
    const subscribeToPersonalInbox = (userId) => {
        if (inboxChannelRef.current) {
            supabase.removeChannel(inboxChannelRef.current)
        }

        const channel = supabase
            .channel(`user_inbox:${userId}`)
            .on('broadcast', { event: 'invite' }, (payload) => {
                // Received lobby invite
                setIncomingInvite(payload.payload)
            })
            .on('broadcast', { event: 'join_request' }, (payload) => {
                // Host received guest join request
                setIncomingJoinReq(payload.payload)
            })
            .subscribe()

        inboxChannelRef.current = channel
    }

    // Send Invite to Friend (10s Cooldown enforced)
    // `friendId` should be the friend's public `player_id` (not the DB PK)
    const inviteFriend = async (friendId) => {
        if (!activeLobby || !user || !player) return { success: false, message: 'No active lobby' }

        // Check cooldown
        const now = Date.now()
        if (cooldowns[friendId] && now - cooldowns[friendId] < 10000) {
            const remaining = Math.round((10000 - (now - cooldowns[friendId])) / 1000)
            return { success: false, message: `Please wait ${remaining}s to invite again.` }
        }

        // Set cooldown
        setCooldowns(prev => ({ ...prev, [friendId]: now }))

        try {
            // Send broadcast on friend's inbox channel (uses public player_id)
            const targetInbox = supabase.channel(`user_inbox:${friendId}`)
            await targetInbox.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await targetInbox.send({
                        type: 'broadcast',
                        event: 'invite',
                        payload: {
                            lobbyId: activeLobby.id,
                            joinCode: activeLobby.join_code,
                            hostName: player.player_name,
                            hostId: player.player_id
                        }
                    })
                    supabase.removeChannel(targetInbox)
                }
            })
            return { success: true, message: 'Invitation sent!' }
        } catch (err) {
            console.error(err)
            return { success: false, message: 'Failed to send invite.' }
        }
    }

    // Send Join Request to Friend inside a lobby (10s Cooldown enforced)
    // `friendId` should be the friend's public `player_id` (not the DB PK)
    const sendJoinRequest = async (friendId, friendLobbyId) => {
        if (!user || !player) return { success: false, message: 'Not logged in' }

        // Check cooldown
        const now = Date.now()
        if (cooldowns[friendId] && now - cooldowns[friendId] < 10000) {
            const remaining = Math.round((10000 - (now - cooldowns[friendId])) / 1000)
            return { success: false, message: `Please wait ${remaining}s to request again.` }
        }

        // Set cooldown
        setCooldowns(prev => ({ ...prev, [friendId]: now }))

        try {
            // Send broadcast to friend's mailbox (uses public player_id)
            const targetInbox = supabase.channel(`user_inbox:${friendId}`)
            await targetInbox.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await targetInbox.send({
                        type: 'broadcast',
                        event: 'join_request',
                        payload: {
                            lobbyId: friendLobbyId,
                            playerName: player.player_name,
                            playerId: player.player_id
                        }
                    })
                    supabase.removeChannel(targetInbox)
                }
            })
            return { success: true, message: 'Join request sent to host!' }
        } catch (err) {
            console.error(err)
            return { success: false, message: 'Failed to request join.' }
        }
    }

    // ─────────────────────────────────────────────────────────
    // LIFE CYCLES & EFFECT MONITORS
    // ─────────────────────────────────────────────────────────

    // Track whether we've already reconnected to a lobby for the current login session
    const lobbyReconnectedRef = useRef(false)

    // Social + presence: bootstrap snapshot once per login; patch state from realtime payloads
    useEffect(() => {
        if (!user?.id) {
            setFriends([])
            setFriendRequests({ received: [], sent: [] })
            setActiveLobby(null)
            setLobbyMessages([])
            setIncomingInvite(null)
            setIncomingJoinReq(null)
            setOnlinePresence({})
            return
        }

        const uid = user.id
        let cancelled = false
        lobbyReconnectedRef.current = false

        const startSocialAndPresence = async () => {
            await ensureSessionReady()
            if (cancelled) return

            fetchSocialData({ force: true })

            const socialChannel = supabase
                .channel(`social:${uid}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'player_friendships', filter: `player_one_id=eq.${uid}` },
                    handleSocialPostgresChange
                )
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'player_friendships', filter: `player_two_id=eq.${uid}` },
                    handleSocialPostgresChange
                )
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'player_friend_requests', filter: `requester_id=eq.${uid}` },
                    handleSocialPostgresChange
                )
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'player_friend_requests', filter: `recipient_id=eq.${uid}` },
                    handleSocialPostgresChange
                )
                .subscribe()

            socialChannelRef.current = socialChannel

            const presenceChannel = supabase.channel('global_presence', {
                config: { presence: { key: uid } }
            })

            presenceChannel
                .on('presence', { event: 'sync' }, () => {
                    const state = presenceChannel.presenceState()
                    const next = Object.keys(state).reduce((acc, id) => {
                        acc[id] = true
                        return acc
                    }, {})
                    setOnlinePresence(next)
                })
                .subscribe(async (status) => {
                    if (status === 'SUBSCRIBED' && !cancelled) {
                        await presenceChannel.track({
                            user_id: uid,
                            at: new Date().toISOString()
                        })
                    }
                })

            presenceChannelRef.current = presenceChannel
        }

        startSocialAndPresence()

        return () => {
            cancelled = true
            if (socialChannelRef.current) {
                supabase.removeChannel(socialChannelRef.current)
                socialChannelRef.current = null
            }
            if (presenceChannelRef.current) {
                supabase.removeChannel(presenceChannelRef.current)
                presenceChannelRef.current = null
            }
            if (lobbyChannelRef.current) {
                supabase.removeChannel(lobbyChannelRef.current)
                lobbyChannelRef.current = null
            }
        }
    }, [user?.id])

    // Personal inbox: attach when public player_id is available (does not restart social subscriptions)
    useEffect(() => {
        if (!user?.id || !player?.player_id) return

        let cancelled = false
        const inboxPlayerId = player.player_id

        const attachInbox = async () => {
            await ensureSessionReady()
            if (!cancelled) subscribeToPersonalInbox(inboxPlayerId)
        }

        attachInbox()

        return () => {
            cancelled = true
            if (inboxChannelRef.current) {
                supabase.removeChannel(inboxChannelRef.current)
                inboxChannelRef.current = null
            }
        }
    }, [user?.id, player?.player_id])

    // Friend lobby/status fields: one filtered listener per friend (no full snapshot refetch)
    const friendIdsKey = friends.map((f) => f.id).join(',')
    useEffect(() => {
        if (!user?.id || !friendIdsKey) {
            if (friendStatusChannelRef.current) {
                supabase.removeChannel(friendStatusChannelRef.current)
                friendStatusChannelRef.current = null
            }
            return
        }

        const friendIds = friendIdsKey.split(',')
        const channel = supabase.channel(`friend_status:${user.id}`)

        friendIds.forEach((friendId) => {
            channel.on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'players', filter: `id=eq.${friendId}` },
                (payload) => {
                    const next = payload.new
                    if (!next?.id) return
                    setFriends((prev) =>
                        prev.map((f) =>
                            f.id === next.id
                                ? {
                                    ...f,
                                    player_name: next.player_name ?? f.player_name,
                                    profile_url: next.profile_url ?? f.profile_url,
                                    current_status: next.current_status,
                                    current_lobby_id: next.current_lobby_id,
                                    last_online: next.last_online
                                }
                                : f
                        )
                    )
                }
            )
        })

        channel.subscribe()
        friendStatusChannelRef.current = channel

        return () => {
            supabase.removeChannel(channel)
            if (friendStatusChannelRef.current === channel) {
                friendStatusChannelRef.current = null
            }
        }
    }, [user?.id, friendIdsKey])

    // Separate effect: reconnects to an active lobby once after login.
    // Guarded by a ref so it only fires once per session even if player updates.
    useEffect(() => {
        if (user && player?.current_lobby_id && !lobbyReconnectedRef.current && !activeLobby) {
            lobbyReconnectedRef.current = true
            runWithSession(async () => {
                const { data } = await supabase
                    .from('lobbies')
                    .select('*')
                    .eq('id', player.current_lobby_id)
                    .single()
                if (data) {
                    setActiveLobby(data)
                    subscribeToLobby(data.id)
                }
            }).catch((err) => console.error('Lobby reconnect failed:', err.message))
        }
    }, [user?.id, player?.current_lobby_id])

    return (
        <RealtimeContext.Provider
            value={{
                friends,
                friendRequests,
                activeLobby,
                lobbyMessages,
                incomingInvite,
                incomingJoinReq,
                onlinePresence,
                cooldowns,
                setIncomingInvite,
                setIncomingJoinReq,
                fetchSocialData,
                sendFriendRequest,
                acceptFriendRequest,
                rejectFriendRequest,
                cancelSentFriendRequest,
                removeFriend,
                hostLobby,
                joinLobby,
                hydrateLobbyFromInvite,
                leaveLobby,
                kickPlayer,
                setLobbyPassword,
                removeLobbyPassword,
                sendLobbyMessage,
                inviteFriend,
                sendJoinRequest
            }}
        >
            {children}
        </RealtimeContext.Provider>
    )
}

export const useRealtime = () => {
    const context = useContext(RealtimeContext)
    if (!context) throw new Error('useRealtime must be used within a RealtimeProvider')
    return context
}
