import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useAuth } from './AuthContext'

const RealtimeContext = createContext(null)

export const RealtimeProvider = ({ children }) => {
  const { user, player, refreshProfile } = useAuth()
  
  // Real-time states
  const [activeLobby, setActiveLobby] = useState(null)
  const [lobbyMessages, setLobbyMessages] = useState([])
  const [friends, setFriends] = useState([])
  const [friendRequests, setFriendRequests] = useState({ received: [], sent: [] })
  const [incomingInvite, setIncomingInvite] = useState(null)     // { lobbyId, joinCode, hostName, hostId }
  const [incomingJoinReq, setIncomingJoinReq] = useState(null)     // { lobbyId, playerName, playerId }
  
  // Cooldown mapping: key: player_id, value: timestamp of last action
  const [cooldowns, setCooldowns] = useState({})

  const inboxChannelRef = useRef(null)
  const lobbyChannelRef = useRef(null)
  const fetchDebounceRef = useRef(null)
  // Ref-based user snapshot so fetchSocialData can be called from realtime
  // callbacks without capturing a stale closure
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])

  // ─────────────────────────────────────────────────────────
  // SOCIAL & FRIENDSHIPS FETCH & TRIGGERS
  // ─────────────────────────────────────────────────────────
  const fetchSocialData = async () => {
    const currentUser = userRef.current
    if (!currentUser) return
    // Debug: log when social fetch runs (temporary)
    try { console.debug('[Realtime] fetchSocialData for', currentUser.id, new Date().toISOString()) } catch(e) {}
    try {
      // 1. Fetch friendships for current user only (avoid fetching entire table)
      const { data: friendshipsData, error: fError } = await supabase
        .from('player_friendships')
        .select('*')
        .or(`player_one_id.eq.${currentUser.id},player_two_id.eq.${currentUser.id}`)
      
      if (fError) throw fError

      // Fetch user profile rows for all friends
      const friendIds = friendshipsData.map(f =>
        f.player_one_id === currentUser.id ? f.player_two_id : f.player_one_id
      )
      
      if (friendIds.length > 0) {
        const { data: profiles, error: pError } = await supabase
          .from('players')
          .select('id, player_id, player_name, profile_url, banner_url, current_status, last_online')
          .in('id', friendIds)
        
        if (pError) throw pError
        setFriends(profiles)
      } else {
        setFriends([])
      }

      // 2. Fetch requests (received and sent) only for current user
      const { data: reqs, error: rError } = await supabase
        .from('player_friend_requests')
        .select('*')
        .or(`recipient_id.eq.${currentUser.id},requester_id.eq.${currentUser.id}`)
      
      if (rError) throw rError

      const receivedReqs = reqs.filter(r => r.recipient_id === currentUser.id)
      const sentReqs = reqs.filter(r => r.requester_id === currentUser.id)

      // Fetch profile details for received requests
      if (receivedReqs.length > 0) {
        const { data: recProfiles } = await supabase
          .from('players')
          .select('id, player_id, player_name, profile_url')
          .in('id', receivedReqs.map(r => r.requester_id))
        setFriendRequests(prev => ({ ...prev, received: recProfiles || [] }))
      } else {
        setFriendRequests(prev => ({ ...prev, received: [] }))
      }

      // Fetch profile details for sent requests
      if (sentReqs.length > 0) {
        const { data: sentProfiles } = await supabase
          .from('players')
          .select('id, player_id, player_name, profile_url')
          .in('id', sentReqs.map(r => r.recipient_id))
        setFriendRequests(prev => ({ ...prev, sent: sentProfiles || [] }))
      } else {
        setFriendRequests(prev => ({ ...prev, sent: [] }))
      }
    } catch (err) {
      console.error('Error fetching social data:', err.message)
    }
  }

  // Debounced wrapper — used by realtime callbacks to coalesce rapid-fire
  // DB change events into a single fetch (avoids double-fetching after writes)
  const debouncedFetchSocialData = () => {
    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current)
    fetchDebounceRef.current = setTimeout(() => fetchSocialData(), 400)
  }

  // Handle Send Friend Request
  const sendFriendRequest = async (searchTerm) => {
    if (!user) return { success: false, message: 'Not logged in' }
    try {
      // Find player by name or player_id (16 digits)
      const { data: foundPlayers, error } = await supabase
        .from('players')
        .select('id, player_id, player_name')
        .or(`player_name.eq."${searchTerm}",player_id.eq."${searchTerm}"`)
      
      if (error) throw error
      if (!foundPlayers || foundPlayers.length === 0) {
        return { success: false, message: 'Player not found.' }
      }
      
      const target = foundPlayers[0]
      if (target.id === user.id) {
        return { success: false, message: 'You cannot add yourself.' }
      }

      // Check if already friends
      const isAlreadyFriend = friends.some(f => f.id === target.id)
      if (isAlreadyFriend) {
        return { success: false, message: 'You are already friends.' }
      }

      // Insert request
      const { error: insError } = await supabase
        .from('player_friend_requests')
        .insert({ requester_id: user.id, recipient_id: target.id })
      
      if (insError) throw insError
      
      // Do NOT manually call fetchSocialData() here — the realtime postgres_changes
      // subscription will fire and call debouncedFetchSocialData() automatically.
      return { success: true, message: `Friend request sent to ${target.player_name}!` }
    } catch (err) {
      console.error(err)
      return { success: false, message: 'Request already exists or failed to send.' }
    }
  }

  // Accept Friend Request
  const acceptFriendRequest = async (requesterId) => {
    if (!user) return
    try {
      // Delete request first
      await supabase
        .from('player_friend_requests')
        .delete()
        .eq('requester_id', requesterId)
        .eq('recipient_id', user.id)

      // Insert friendship (ensuring player_one_id < player_two_id)
      const p1 = user.id.localeCompare(requesterId) < 0 ? user.id : requesterId
      const p2 = user.id.localeCompare(requesterId) < 0 ? requesterId : user.id

      const { error } = await supabase
        .from('player_friend_relationships' in supabase ? 'player_friendships' : 'player_friendships')
        .insert({ player_one_id: p1, player_two_id: p2 })

      if (error) throw error
      // Realtime subscription handles the refresh
    } catch (err) {
      console.error('Error accepting friend request:', err.message)
    }
  }

  // Reject Friend Request
  const rejectFriendRequest = async (requesterId) => {
    if (!user) return
    try {
      await supabase
        .from('player_friend_requests')
        .delete()
        .eq('requester_id', requesterId)
        .eq('recipient_id', user.id)
      
      // Realtime subscription handles the refresh
    } catch (err) {
      console.error('Error rejecting friend request:', err.message)
    }
  }

  // Remove Friend
  const removeFriend = async (friendId) => {
    if (!user) return
    try {
      const p1 = user.id.localeCompare(friendId) < 0 ? user.id : friendId
      const p2 = user.id.localeCompare(friendId) < 0 ? friendId : user.id

      await supabase
        .from('player_friendships')
        .delete()
        .eq('player_one_id', p1)
        .eq('player_two_id', p2)

      // Realtime subscription handles the refresh
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
            // Lobby deleted (host closed it)
            setActiveLobby(null)
            setLobbyMessages([])
            refreshProfile()
          } else {
            // Update active lobby state
            setActiveLobby(payload.new)
            
            // Lock/kick check: if we are no longer in the player list, we got kicked!
            if (payload.new.lobby_state?.Players) {
              const inside = Object.keys(payload.new.lobby_state.Players).includes(user?.id)
              if (!inside) {
                // We got kicked! Clean up
                setActiveLobby(null)
                setLobbyMessages([])
                refreshProfile()
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
          refreshProfile()
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
      const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase()
      const initialLobbyState = {
        isPrivate: false,
        password: null,
        SessionId: Math.random().toString(36).substring(2, 10),
        Players: {
          [user.id]: {
            id: player.player_id,
            name: player.player_name,
            profileUrl: player.profile_url,
            isHost: true
          }
        }
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
      refreshProfile()
      return lobbyData
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
      const { error } = await supabase.rpc('set_lobby_password', {
        p_lobby_id: activeLobby.id,
        p_password: password
      })
      if (error) throw error
    } catch (err) {
      console.error('Error locking lobby:', err.message)
    }
  }

  // Make Lobby Public (Remove password)
  const removeLobbyPassword = async () => {
    if (!activeLobby) return
    try {
      const { error } = await supabase.rpc('remove_lobby_password', {
        p_lobby_id: activeLobby.id
      })
      if (error) throw error
    } catch (err) {
      console.error('Error unlocking lobby:', err.message)
    }
  }

  // Join a Lobby
  const joinLobby = async (joinCode, password = '') => {
    if (!user || !player) return { success: false, message: 'Not logged in' }
    try {
      // Find lobby
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

      // Add to lobby_state
      const state = lobby.lobby_state || {}
      state.Players = state.Players || {}
      state.Players[user.id] = {
        id: player.player_id,
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

      setActiveLobby(lobby)
      setLobbyMessages([])
      subscribeToLobby(lobby.id)
      refreshProfile()
      return { success: true }
    } catch (err) {
      console.error('Error joining lobby:', err.message)
      return { success: false, message: err.message }
    }
  }

  // Leave Lobby
  const leaveLobby = async () => {
    if (!activeLobby || !user) return
    try {
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
      refreshProfile()
    } catch (err) {
      console.error('Error leaving lobby:', err.message)
    }
  }

  // Kick Player
  const kickPlayer = async (guestUuid) => {
    if (!activeLobby || activeLobby.host_id !== user?.id) return
    try {
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
      // Send broadcast on friend's inbox channel
      const targetInbox = supabase.channel(`temp_invite:${friendId}`)
      await targetInbox.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await targetInbox.send({
            type: 'broadcast',
            event: 'invite',
            payload: {
              lobbyId: activeLobby.id,
              joinCode: activeLobby.join_code,
              hostName: player.player_name,
              hostId: user.id
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
      // Send broadcast to friend's mailbox
      const targetInbox = supabase.channel(`temp_req:${friendId}`)
      await targetInbox.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await targetInbox.send({
            type: 'broadcast',
            event: 'join_request',
            payload: {
              lobbyId: friendLobbyId,
              playerName: player.player_name,
              playerId: user.id
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

  // Primary effect: runs when user logs in/out. Sets up social data + realtime subscriptions.
  // Does NOT depend on player so that refreshProfile() cannot trigger a re-run loop.
  useEffect(() => {
    if (user) {
      fetchSocialData()
      subscribeToPersonalInbox(user.id)
      lobbyReconnectedRef.current = false // reset reconnect flag on new login

      // Listen for general database table changes for friendships & friend requests
      // (no polling interval needed — realtime handles updates reactively)
      const friendshipsSub = supabase
        .channel('social_updates')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_friendships' },
          () => debouncedFetchSocialData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'player_friend_requests' },
          () => debouncedFetchSocialData()
        )
        .subscribe()

      return () => {
        supabase.removeChannel(friendshipsSub)
        if (inboxChannelRef.current) {
          supabase.removeChannel(inboxChannelRef.current)
        }
        if (lobbyChannelRef.current) {
          supabase.removeChannel(lobbyChannelRef.current)
        }
      }
    } else {
      setFriends([])
      setFriendRequests({ received: [], sent: [] })
      setActiveLobby(null)
      setLobbyMessages([])
      setIncomingInvite(null)
      setIncomingJoinReq(null)
    }
  }, [user])

  // Separate effect: reconnects to an active lobby once after login.
  // Guarded by a ref so it only fires once per session even if player updates.
  useEffect(() => {
    if (user && player?.current_lobby_id && !lobbyReconnectedRef.current && !activeLobby) {
      lobbyReconnectedRef.current = true
      supabase
        .from('lobbies')
        .select('*')
        .eq('id', player.current_lobby_id)
        .single()
        .then(({ data }) => {
          if (data) {
            setActiveLobby(data)
            subscribeToLobby(data.id)
          }
        })
    }
  }, [user, player?.current_lobby_id])

  return (
    <RealtimeContext.Provider
      value={{
        friends,
        friendRequests,
        activeLobby,
        lobbyMessages,
        incomingInvite,
        incomingJoinReq,
        cooldowns,
        setIncomingInvite,
        setIncomingJoinReq,
        fetchSocialData,
        sendFriendRequest,
        acceptFriendRequest,
        rejectFriendRequest,
        removeFriend,
        hostLobby,
        joinLobby,
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
