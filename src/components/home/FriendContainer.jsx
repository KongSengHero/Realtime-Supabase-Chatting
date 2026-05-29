import React, { useState, useEffect } from 'react'
import { useRealtime } from '../../context/RealtimeContext'
import { Search, Users, UserPlus, Play, Plus } from 'lucide-react'
import { SearchModal } from './SearchModal'
import { SocialModal } from './SocialModal'

export const FriendContainer = () => {
    const { friends, inviteFriend, sendJoinRequest, activeLobby, cooldowns, onlinePresence } = useRealtime()

    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [isSocialOpen, setIsSocialOpen] = useState(false)

    const [tick, setTick] = useState(0)

    useEffect(() => {
        const timer = setInterval(() => {
            setTick(t => t + 1)
        }, 1000)
        return () => clearInterval(timer)
    }, [])

    const formatLastSeen = (status, lastOnline) => {
        if (status === 'Online') return 'Online'
        if (status === 'Lobby') return 'In Lobby'
        if (!lastOnline) return 'Offline'

        const diffMs = Date.now() - new Date(lastOnline).getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Offline (just now)'
        if (diffMins < 60) return `Offline (${diffMins}m ago)`
        if (diffHours < 24) return `Offline (${diffHours}h ago)`
        return `Offline (${diffDays}d ago)`
    }

    const getEffectiveStatus = (friend) => {
        if (friend.current_status === 'Lobby') return 'Lobby'
        if (onlinePresence?.[friend.id]) return 'Online'
        return friend.current_status || 'Offline'
    }

    const getCooldownRemaining = (playerId) => {
        const lastAction = cooldowns[playerId]
        if (!lastAction) return 0
        const elapsed = Date.now() - lastAction
        const remaining = 10000 - elapsed
        return remaining > 0 ? Math.ceil(remaining / 1000) : 0
    }

    const handleInvite = async (friend) => {
        const res = await inviteFriend(friend.player_id)
        if (!res.success) {
            alert(res.message)
        }
    }

    const handleAskToJoin = async (friend) => {
        if (!friend.current_lobby_id) return
        const res = await sendJoinRequest(friend.player_id, friend.current_lobby_id)
        if (res.success) {
            alert('Join request sent to ' + friend.player_name)
        } else {
            alert(res.message)
        }
    }

    return (
        <div className="w-52 bg-[#171a21] border-r border-[#2a475e]/60 flex flex-col h-full relative z-10 shrink-0">
            <div className="p-4 border-b border-[#2a475e]/60 flex items-center justify-between bg-[#101216]/40">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2 m-0">
                    <Users className="w-4 h-4 text-[#3b82f6]" />
                    Friends Arena
                </h3>
                <span className="text-xs bg-[#3b82f6]/15 text-[#3b82f6] px-2 py-0.5 rounded-full font-semibold">
                    {friends.filter(f => getEffectiveStatus(f) !== 'Offline').length}/{friends.length}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {friends.length === 0 ? (
                    <div className="text-center py-12 text-[#64748b] px-4">
                        <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                        <p className="text-xs font-semibold m-0">Your friends list is empty.</p>
                        <p className="text-[10px] opacity-75 mt-1">Use the Search panel below to start building your crew.</p>
                    </div>
                ) : (
                    friends
                        .sort((a, b) => {
                            const statusWeight = { Online: 0, Lobby: 1, Offline: 2 }
                            return (statusWeight[a.current_status] || 2) - (statusWeight[b.current_status] || 2)
                        })
                        .map((friend) => {
                            const cooldown = getCooldownRemaining(friend.id)
                            const effectiveStatus = getEffectiveStatus(friend)
                            const isFriendInLobby = effectiveStatus === 'Lobby' && friend.current_lobby_id

                            return (
                                <div
                                    key={friend.id}
                                    className="flex items-center justify-between p-2.5 bg-[#0e141d]/40 hover:bg-[#0e141d]/80 border border-[#2a475e]/25 hover:border-[#2a475e]/50 rounded-xl transition-all group"
                                >
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div className="relative shrink-0">
                                            {friend.profile_url ? (
                                                <img
                                                    src={friend.profile_url}
                                                    alt=""
                                                    className="w-9 h-9 rounded-lg object-cover border border-[#2a475e]/50"
                                                />
                                            ) : (
                                                <div className="w-9 h-9 rounded-lg bg-linear-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e]/50 flex items-center justify-center text-xs font-bold text-[#3b82f6]">
                                                    {friend.player_name.substring(0, 2).toUpperCase()}
                                                </div>
                                            )}
                                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-[#171a21] ${effectiveStatus === 'Lobby' ? 'bg-[#f59e0b]' :
                                                    effectiveStatus === 'Online' ? 'bg-[#10b981]' : 'bg-gray-500'
                                                }`} />
                                        </div>

                                        <div className="overflow-hidden">
                                            <h4 className="text-xs font-bold text-white m-0 truncate group-hover:text-[#3b82f6] transition-colors leading-tight">
                                                {friend.player_name}
                                            </h4>
                                            <p className="text-[10px] text-[#94a3b8]/75 truncate mt-0.5">
                                                {formatLastSeen(effectiveStatus, friend.last_online)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="shrink-0 flex items-center">
                                        {activeLobby && effectiveStatus === 'Online' && (
                                            cooldown > 0 ? (
                                                <span className="text-[10px] font-bold text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/30 px-2 py-1 rounded-lg">
                                                    {cooldown}s
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handleInvite(friend)}
                                                    title="Invite to Lobby"
                                                    className="p-1.5 bg-[#3b82f6]/10 hover:bg-[#3b82f6] text-[#3b82f6] hover:text-white border border-[#3b82f6]/30 rounded-lg cursor-pointer transition-all"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            )
                                        )}
                                        {!activeLobby && isFriendInLobby && (
                                            cooldown > 0 ? (
                                                <span className="text-[10px] font-bold text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/30 px-2 py-1 rounded-lg">
                                                    {cooldown}s
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => handleAskToJoin(friend)}
                                                    title="Request to Join"
                                                    className="p-1.5 bg-[#f59e0b]/10 hover:bg-[#f59e0b] text-[#f59e0b] hover:text-white border border-[#f59e0b]/30 rounded-lg cursor-pointer transition-all"
                                                >
                                                    <Play className="w-3.5 h-3.5 rotate-0" />
                                                </button>
                                            )
                                        )}
                                    </div>
                                </div>
                            )
                        })
                )}
            </div>

            <div className="p-4 border-t border-[#2a475e]/60 bg-[#101216]/40 flex gap-2">
                <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex-1 py-2 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-semibold tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md active:scale-95"
                >
                    <Search className="w-3.5 h-3.5 text-[#3b82f6]" />
                    Search
                </button>
                <button
                    onClick={() => setIsSocialOpen(true)}
                    className="flex-1 py-2 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-semibold tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md active:scale-95"
                >
                    <UserPlus className="w-3.5 h-3.5 text-[#3b82f6]" />
                    Social
                </button>
            </div>

            <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
            <SocialModal isOpen={isSocialOpen} onClose={() => setIsSocialOpen(false)} />
        </div>
    )
}
