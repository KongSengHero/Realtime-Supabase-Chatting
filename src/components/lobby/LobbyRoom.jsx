import React, { useState, useEffect, useRef } from 'react'
import { useRealtime } from '../../context/RealtimeContext'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../supabase'
import {
    Send, Copy, Check, LogOut, Shield, Lock, Unlock,
    Trash2, AlertTriangle, MessageSquare, Users
} from 'lucide-react'

export const LobbyRoom = () => {
    const { user, player } = useAuth()
    const {
        activeLobby, lobbyMessages, leaveLobby, kickPlayer,
        setLobbyPassword, removeLobbyPassword, sendLobbyMessage,
        incomingInvite, incomingJoinReq, setIncomingInvite, setIncomingJoinReq, joinLobby
    } = useRealtime()

    const [message, setMessage] = useState('')
    const [copied, setCopied] = useState(false)
    const [isLocking, setIsLocking] = useState(false)
    const [passwordInput, setPasswordInput] = useState('')
    const messagesEndRef = useRef(null)

    const players = activeLobby?.lobby_state?.Players || {}
    const isHost = activeLobby?.host_id === user?.id
    const isLobbyPrivate = activeLobby?.is_private

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [lobbyMessages])

    useEffect(() => {
        if (incomingInvite) {
            const timer = setTimeout(() => {
                setIncomingInvite(null)
            }, 10000)
            return () => clearTimeout(timer)
        }
    }, [incomingInvite])

    useEffect(() => {
        if (incomingJoinReq) {
            const timer = setTimeout(() => {
                setIncomingJoinReq(null)
            }, 10000)
            return () => clearTimeout(timer)
        }
    }, [incomingJoinReq])

    const handleCopyCode = () => {
        if (!activeLobby?.join_code) return
        navigator.clipboard.writeText(activeLobby.join_code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleLockSubmit = (e) => {
        e.preventDefault()
        if (!passwordInput.trim()) return
        setLobbyPassword(passwordInput.trim())
        setPasswordInput('')
        setIsLocking(false)
    }

    const handleUnlock = () => {
        removeLobbyPassword()
    }

    const handleSendMessage = (e) => {
        e.preventDefault()
        if (!message.trim()) return
        sendLobbyMessage(message.trim())
        setMessage('')
    }

    const handleConfirmJoin = async () => {
        if (!incomingJoinReq || !activeLobby) return
        const guestId = incomingJoinReq.playerId
        const guestName = incomingJoinReq.playerName

        try {
            const state = activeLobby.lobby_state
            state.Players = state.Players || {}
            state.Players[guestId] = {
                id: Math.random().toString(36).substring(2, 10), 
                name: guestName,
                isHost: false
            }
            const lobbySnapshot = { ...activeLobby, lobby_state: state }

            await supabase
                .from('lobbies')
                .update({ lobby_state: state })
                .eq('id', activeLobby.id)

            const targetInbox = supabase.channel(`temp_confirm:${guestId}`)
            await targetInbox.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await targetInbox.send({
                        type: 'broadcast',
                        event: 'join_confirmed',
                        payload: {
                            lobbyJoinCode: activeLobby.join_code,
                            lobbySnapshot
                        }
                    })
                    supabase.removeChannel(targetInbox)
                }
            })

            await supabase
                .from('players')
                .update({ current_lobby_id: activeLobby.id, current_status: 'Lobby' })
                .eq('id', guestId)

        } catch (err) {
            console.error('Failed to confirm join request:', err.message)
        } finally {
            setIncomingJoinReq(null)
        }
    }

    const handleDeclineJoin = async () => {
        if (!incomingJoinReq) return
        try {
            const guestId = incomingJoinReq.playerId
            const targetInbox = supabase.channel(`temp_decline:${guestId}`)
            await targetInbox.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await targetInbox.send({
                        type: 'broadcast',
                        event: 'join_declined',
                        payload: {}
                    })
                    supabase.removeChannel(targetInbox)
                }
            })
        } catch (err) {
            console.error(err)
        } finally {
            setIncomingJoinReq(null)
        }
    }

    const handleAcceptInvite = async () => {
        if (!incomingInvite) return
        const res = await joinLobby(incomingInvite.joinCode)
        if (res.success) {
            setIncomingInvite(null)
        } else {
            alert(res.message)
        }
    }

    return (
        <div className="flex-1 bg-[#101216] flex flex-col h-full relative overflow-hidden">
            {incomingInvite && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-100 bg-[#171a21]/95 border border-[#3b82f6] rounded-xl p-4 shadow-xl shadow-[#3b82f6]/10 animate-slide-in-up backdrop-blur-md">
                    <div className="flex items-start gap-3">
                        <Users className="w-5 h-5 text-[#3b82f6] shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Lobby Invitation</h4>
                            <p className="text-xs text-[#94a3b8] mt-1 font-medium leading-relaxed">
                                **{incomingInvite.hostName}** has invited you to join a lobby room.
                            </p>
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={handleAcceptInvite}
                                    className="flex-1 py-1.5 bg-[#3b82f6] hover:bg-[#60a5fa] text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                >
                                    Accept
                                </button>
                                <button
                                    onClick={() => setIncomingInvite(null)}
                                    className="flex-1 py-1.5 bg-[#2a475e]/60 hover:bg-[#2a475e] text-[#94a3b8] hover:text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                >
                                    Decline
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {incomingJoinReq && isHost && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-100 bg-[#171a21]/95 border border-[#f59e0b] rounded-xl p-4 shadow-xl shadow-[#f59e0b]/10 animate-slide-in-up backdrop-blur-md">
                    <div className="flex items-start gap-3">
                        <Users className="w-5 h-5 text-[#f59e0b] shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Join Request</h4>
                            <p className="text-xs text-[#94a3b8] mt-1 font-medium leading-relaxed">
                                **{incomingJoinReq.playerName}** wants to join your lobby room.
                            </p>
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={handleConfirmJoin}
                                    className="flex-1 py-1.5 bg-[#f59e0b] hover:bg-[#fbbf24] text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                >
                                    Confirm
                                </button>
                                <button
                                    onClick={handleDeclineJoin}
                                    className="flex-1 py-1.5 bg-[#2a475e]/60 hover:bg-[#2a475e] text-[#94a3b8] hover:text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                >
                                    Decline
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="p-4 border-b border-[#2a475e]/60 flex items-center justify-between bg-[#171a21]/50 backdrop-blur-md relative z-10">
                <div className="flex items-center gap-4">
                    <div className="shrink-0 flex items-center gap-1.5 bg-[#3b82f6]/10 border border-[#3b82f6]/30 px-3 py-1.5 rounded-xl">
                        <span className="text-[10px] font-bold text-[#3b82f6] uppercase tracking-wider">Lobby Code</span>
                        <span className="text-sm font-black text-white select-all">{activeLobby?.join_code}</span>
                        <button
                            onClick={handleCopyCode}
                            title="Copy Join Code"
                            className="p-1 hover:bg-[#3b82f6]/20 rounded text-[#3b82f6] transition-colors cursor-pointer"
                        >
                            {copied ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                    {isLobbyPrivate ? (
                        <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Private
                        </span>
                    ) : (
                        <span className="text-[10px] font-bold text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/20 px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                            <Unlock className="w-3 h-3" /> Public
                        </span>
                    )}
                    <span className="text-[10px] font-bold text-[#94a3b8] bg-[#2a475e]/25 border border-[#2a475e]/40 px-2.5 py-1 rounded-full uppercase tracking-wider">
                        {activeLobby?.lobby_type}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    {isHost && activeLobby?.lobby_type !== 'Anonymous' && (
                        <div className="flex gap-2">
                            {isLobbyPrivate ? (
                                <button
                                    onClick={handleUnlock}
                                    className="py-1.5 px-3 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 rounded-xl text-xs font-semibold tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-md active:scale-95"
                                >
                                    <Unlock className="w-3.5 h-3.5" />
                                    Make Public
                                </button>
                            ) : (
                                <button
                                    onClick={() => setIsLocking(true)}
                                    className="py-1.5 px-3 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-semibold tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer shadow-md active:scale-95"
                                >
                                    <Lock className="w-3.5 h-3.5 text-[#3b82f6]" />
                                    Make Private
                                </button>
                            )}
                        </div>
                    )}
                    {activeLobby?.lobby_type === 'Anonymous' && (
                        <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full uppercase tracking-wider">
                            Solo Private Sandbox
                        </span>
                    )}
                    <button
                        onClick={leaveLobby}
                        className="py-1.5 px-3.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-colors flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        {isHost ? 'Close Lobby' : 'Leave'}
                    </button>
                </div>
            </div>

            {isLocking && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101216]/80 backdrop-blur-sm animate-fade-in">
                    <div className="w-full max-w-90 bg-[#171a21] border border-[#2a475e] rounded-2xl p-5 shadow-2xl animate-slide-in-up">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Lock className="w-4 h-4 text-[#3b82f6]" /> Set Lobby Password
                        </h3>
                        <p className="text-xs text-[#94a3b8] mb-4">
                            Enter a password. Players will need this password to join your lobby.
                        </p>
                        <form onSubmit={handleLockSubmit} className="space-y-4">
                            <input
                                type="password"
                                placeholder="Enter password..."
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                                className="w-full pl-3 pr-3 py-2 bg-[#0e141d] border border-[#2a475e] rounded-xl text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] text-xs font-medium"
                                required
                                autoFocus
                            />
                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="flex-1 py-1.5 bg-[#3b82f6] hover:bg-[#60a5fa] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                    Lock Room
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsLocking(false)
                                        setPasswordInput('')
                                    }}
                                    className="flex-1 py-1.5 bg-[#2a475e]/60 hover:bg-[#2a475e] text-[#94a3b8] text-xs font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col h-full bg-[#101216]">
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {lobbyMessages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-[#64748b] text-center max-w-70 mx-auto">
                                <MessageSquare className="w-8 h-8 mb-3 text-[#2a475e] animate-bounce" />
                                <p className="text-xs font-bold uppercase tracking-wider">Welcome to the lobby chat</p>
                                <p className="text-[10px] mt-1 opacity-75">Send a message to start communicating with the team!</p>
                            </div>
                        ) : (
                            lobbyMessages.map((msg, idx) => {
                                const isMe = msg.senderId === user?.id
                                return (
                                    <div
                                        key={idx}
                                        className={`flex items-start gap-2.5 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''} animate-fade-in`}
                                    >
                                        {msg.profileUrl ? (
                                            <img src={msg.profileUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-[#2a475e]/50" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-linear-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e]/50 flex items-center justify-center text-[10px] font-bold text-[#3b82f6]">
                                                {msg.senderName.substring(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                        <div>
                                            <div className={`flex items-center gap-1.5 mb-1 ${isMe ? 'justify-end' : ''}`}>
                                                <span className="text-[10px] font-bold text-white">{msg.senderName}</span>
                                                <span className="text-[8px] text-[#64748b]">
                                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div
                                                className={`p-3 rounded-2xl text-xs font-medium leading-snug wrap-break-word ${isMe
                                                        ? 'bg-[#3b82f6] text-white rounded-tr-none shadow shadow-[#3b82f6]/20'
                                                        : 'bg-[#171a21] text-[#e2e8f0] rounded-tl-none border border-[#2a475e]/30'
                                                    }`}
                                            >
                                                {msg.text}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {activeLobby?.lobby_type !== 'Anonymous' ? (
                        <form onSubmit={handleSendMessage} className="p-3 border-t border-[#2a475e]/60 bg-[#171a21]/50 backdrop-blur-md flex gap-2">
                            <input
                                type="text"
                                placeholder="Type a chat message..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                className="flex-1 pl-4 pr-4 py-2.5 bg-[#0e141d] border border-[#2a475e] rounded-xl text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] font-medium"
                            />
                            <button
                                type="submit"
                                disabled={!message.trim()}
                                className="py-2.5 px-4 bg-[#3b82f6] hover:bg-[#60a5fa] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40"
                            >
                                <Send className="w-3.5 h-3.5" />
                            </button>
                        </form>
                    ) : (
                        <div className="p-3 border-t border-[#2a475e]/60 bg-[#171a21]/30 text-center text-[10px] text-red-400 uppercase tracking-widest font-semibold">
                            Solo room. Chat is disabled.
                        </div>
                    )}
                </div>

                <div className="w-55 bg-[#171a21] border-l border-[#2a475e]/60 flex flex-col h-full shrink-0">
                    <div className="p-3 border-b border-[#2a475e]/60 bg-[#101216]/20 flex items-center gap-1.5 shrink-0">
                        <Users className="w-3.5 h-3.5 text-[#3b82f6]" />
                        <h4 className="text-[10px] font-bold text-white uppercase tracking-wider m-0">Players ({Object.keys(players).length})</h4>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {Object.entries(players).map(([uuid, p]) => {
                            const isPlayerHost = activeLobby?.host_id === uuid
                            return (
                                <div
                                    key={uuid}
                                    className="flex items-center justify-between p-2 bg-[#0e141d]/50 border border-[#2a475e]/15 rounded-lg"
                                >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        {p.profileUrl ? (
                                            <img src={p.profileUrl} alt="" className="w-7 h-7 rounded object-cover border border-[#2a475e]/30" />
                                        ) : (
                                            <div className="w-7 h-7 rounded bg-linear-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e]/30 flex items-center justify-center text-[10px] font-bold text-[#3b82f6]">
                                                {p.name.substring(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="overflow-hidden">
                                            <h5 className="text-[10px] font-bold text-white truncate m-0 leading-tight flex items-center gap-1">
                                                {p.name}
                                                {isPlayerHost && <Shield className="w-3 h-3 text-[#3b82f6] shrink-0" />}
                                            </h5>
                                            <span className="text-[8px] text-[#64748b] font-medium leading-none block mt-0.5">
                                                {isPlayerHost ? 'Host' : 'Guest'}
                                            </span>
                                        </div>
                                    </div>
                                    {isHost && !isPlayerHost && (
                                        <button
                                            onClick={() => kickPlayer(uuid)}
                                            title="Kick Player"
                                            className="p-1 hover:bg-red-500/15 border border-transparent hover:border-red-500/30 text-[#94a3b8] hover:text-red-400 rounded transition-all cursor-pointer"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
