import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useRealtime } from '../../context/RealtimeContext'
import { FriendContainer } from './FriendContainer'
import { LobbyRoom } from '../lobby/LobbyRoom'
import { supabase } from '../../supabase'
import { 
  LogOut, ShieldAlert, Sparkles, Trash2, Key, Play, Plus, 
  Gamepad2, AlertOctagon, HelpCircle, RefreshCw 
} from 'lucide-react'

export const Dashboard = () => {
  const { player, signOut, isLockedOut, stealSession, deleteAccount, signInWithGoogle } = useAuth()
  const { activeLobby, hostLobby, joinLobby } = useRealtime()

  // Host/Join states
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [joinPasswordInput, setJoinPasswordInput] = useState('')
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Listen for real-time join confirmations on personal inbox channel
  useEffect(() => {
    if (!player) return
    
    const confirmChannel = supabase
      .channel(`personal_redirect:${player.id}`)
      .on('broadcast', { event: 'join_confirmed' }, async (payload) => {
        setLoading(true)
        const code = payload.payload.lobbyJoinCode
        await joinLobby(code)
        setLoading(false)
      })
      .on('broadcast', { event: 'join_declined' }, () => {
        alert('Your request to join the lobby was declined by the host.')
      })
      .subscribe()

    return () => {
      supabase.removeChannel(confirmChannel)
    }
  }, [player])

  // Handle Host Lobby click
  const handleHost = async (type) => {
    setLoading(true)
    await hostLobby(type)
    setLoading(false)
  }

  // Handle Join Lobby submit
  const handleJoin = async (e) => {
    e.preventDefault()
    if (!joinCodeInput.trim()) return

    setLoading(true)
    const res = await joinLobby(joinCodeInput.trim(), joinPasswordInput.trim())
    setLoading(false)

    if (res.success) {
      setJoinCodeInput('')
      setJoinPasswordInput('')
      setShowPasswordPrompt(false)
    } else {
      if (res.message.includes('password')) {
        setShowPasswordPrompt(true)
      } else {
        alert(res.message)
      }
    }
  }

  // Handle Delete Account confirmed
  const handleDeleteAccount = async () => {
    const success = await deleteAccount()
    if (success) {
      setShowDeleteConfirm(false)
      alert('Your account has been deleted permanently.')
    }
  }

  return (
    <div className="flex h-screen w-screen bg-[#101216] overflow-hidden relative">
      
      {/* ─────────────────────────────────────────────────────────
          1. ACTIVE TAB LOCKOUT OVERLAY (FULL SCREEN BLUR GLASS)
          ───────────────────────────────────────────────────────── */}
      {isLockedOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#101216]/90 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-[480px] bg-[#171a21]/90 border border-red-500/30 rounded-2xl p-8 shadow-2xl shadow-red-500/5 text-center animate-slide-in-up">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/40 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-500/10">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            
            <h1 className="text-2xl font-bold text-white m-0 tracking-tight">
              Active Session Interrupted
            </h1>
            
            <p className="text-[#94a3b8] text-sm mt-3 leading-relaxed font-medium">
              Your account is currently open in another browser tab. To maintain real-time sync, you can only operate in one active tab at a time.
            </p>

            <div className="mt-8 space-y-3">
              <button
                onClick={stealSession}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-500/20 active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                Use Here Instead
              </button>
              
              <button
                onClick={signOut}
                className="w-full py-3 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e]/80 text-[#94a3b8] hover:text-white rounded-xl text-sm font-semibold transition-all cursor-pointer"
              >
                Log Out Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────
          2. DELETE ACCOUNT CONFIRMATION MODAL
          ───────────────────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101216]/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-[400px] bg-[#171a21] border border-red-500/30 rounded-2xl p-6 shadow-2xl animate-slide-in-up">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
              <AlertOctagon className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider m-0">Permanent Account Deletion</h3>
            <p className="text-xs text-[#94a3b8] mt-2 font-medium leading-relaxed">
              **WARNING**: This action is absolute. Your entire profile, custom display settings, friendships list, and sent/received requests will be cleared permanently from the database.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={handleDeleteAccount}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Delete Forever
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 bg-[#2a475e]/60 hover:bg-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left Navigation: FriendContainer Panel */}
      <FriendContainer />

      {/* Right Dashboard panel workspace */}
      <div className="flex-grow flex flex-col h-full overflow-hidden">
        
        {/* Header Dashboard Area */}
        <div className="p-4 border-b border-[#2a475e]/60 bg-[#171a21] flex items-center justify-between shrink-0 relative z-10">
          {/* Profile details */}
          <div className="flex items-center gap-3">
            {player?.profile_url ? (
              <img 
                src={player.profile_url} 
                alt="" 
                className="w-11 h-11 rounded-xl object-cover border border-[#2a475e] shadow-md shadow-[#3b82f6]/5" 
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e] flex items-center justify-center text-sm font-bold text-[#3b82f6]">
                {player?.player_name ? player.player_name.substring(0, 2).toUpperCase() : 'GP'}
              </div>
            )}

            <div>
              <h2 className="text-base font-bold text-white m-0 leading-tight flex items-center gap-1.5">
                {player?.player_name}
                {player?.is_anonymous ? (
                  <span className="text-[9px] font-semibold text-yellow-500 bg-yellow-500/10 border border-yellow-500/25 px-1.5 py-0.5 rounded uppercase">
                    Anonymous
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/25 px-1.5 py-0.5 rounded uppercase">
                    Google
                  </span>
                )}
              </h2>
              <p className="text-xs text-[#94a3b8] mt-1 font-semibold flex items-center gap-1 select-all">
                UID: {player?.player_id}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {/* Merging Account button triggered only for anonymous */}
            {player?.is_anonymous && (
              <button
                onClick={signInWithGoogle}
                className="py-1.5 px-3 bg-gradient-to-r from-[#1b2838] to-[#2a475e] hover:from-[#2a475e] hover:to-[#3b82f6] border border-[#3b82f6]/60 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-[#3b82f6]/5 animate-pulse-glow"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#3b82f6]" />
                Link Google Account
              </button>
            )}

            {/* Account Delete button */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete Account Permanently"
              className="p-2 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 text-[#94a3b8] hover:text-red-400 rounded-xl transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Logout button */}
            <button
              onClick={signOut}
              className="py-1.5 px-3.5 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-bold uppercase transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Workspace Display */}
        <div className="flex-1 min-h-0 bg-[#101216]">
          {activeLobby ? (
            <LobbyRoom />
          ) : (
            /* Standard Dashboard Welcome Cards */
            <div className="h-full flex items-center justify-center p-8 overflow-y-auto">
              
              <div className="w-full max-w-[680px] grid grid-cols-1 md:grid-cols-2 gap-6 animate-slide-in-up">
                
                {/* 1. Host Lobby Action Card */}
                <div className="glass-panel border-[#2a475e]/60 rounded-2xl p-6 flex flex-col justify-between hover:border-[#3b82f6]/60 transition-all group">
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                      <Gamepad2 className="w-6 h-6 text-[#3b82f6]" />
                    </div>
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider m-0 leading-tight">Host Lobby</h3>
                    <p className="text-xs text-[#94a3b8] mt-2 font-medium leading-relaxed leading-snug">
                      Host a game arena where you can invite friends, chat in real-time, configure passwords, and manage players.
                    </p>
                  </div>

                  <div className="mt-8 space-y-2">
                    <button
                      onClick={() => handleHost('Champion')}
                      disabled={loading}
                      className="w-full py-2.5 bg-gradient-to-r from-[#1b2838] to-[#2a475e] hover:from-[#2a475e] hover:to-[#3b82f6] text-white text-xs font-bold rounded-xl border border-[#3b82f6]/60 transition-all flex items-center justify-center gap-2 cursor-pointer shadow active:scale-98"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Host Champion Lobby
                    </button>
                    
                    <button
                      onClick={() => handleHost('Anonymous')}
                      disabled={loading}
                      title="An empty completely private lobby placeholder"
                      className="w-full py-2 bg-[#0e141d] hover:bg-[#1b2838] border border-[#2a475e] text-[#94a3b8] hover:text-white rounded-xl text-xs font-semibold tracking-wider uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      Host Anonymous Lobby
                    </button>
                  </div>
                </div>

                {/* 2. Join Lobby Action Card */}
                <div className="glass-panel border-[#2a475e]/60 rounded-2xl p-6 flex flex-col justify-between hover:border-[#3b82f6]/60 transition-all group">
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                      <Key className="w-6 h-6 text-[#3b82f6]" />
                    </div>
                    <h3 className="text-lg font-bold text-white uppercase tracking-wider m-0 leading-tight">Join Lobby</h3>
                    <p className="text-xs text-[#94a3b8] mt-2 font-medium leading-relaxed leading-snug">
                      Enter a 6-character room code. If the host configured a password lock, you'll need the password to enter.
                    </p>
                  </div>

                  <form onSubmit={handleJoin} className="mt-6 space-y-2">
                    <input
                      type="text"
                      placeholder="Lobby Code (e.g. Z3IJ0D)"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      maxLength={6}
                      className="w-full pl-3 pr-3 py-2 bg-[#0e141d] border border-[#2a475e] rounded-xl text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] font-semibold tracking-wider text-center"
                      required
                    />

                    {/* Password input shown if incorrect password trigger */}
                    {showPasswordPrompt && (
                      <input
                        type="password"
                        placeholder="Lobby Password"
                        value={joinPasswordInput}
                        onChange={(e) => setJoinPasswordInput(e.target.value)}
                        className="w-full pl-3 pr-3 py-2 bg-[#0e141d] border border-red-500/40 rounded-xl text-xs text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] text-center font-medium animate-fade-in"
                        required
                      />
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 bg-gradient-to-r from-[#1b2838] to-[#2a475e] hover:from-[#2a475e] hover:to-[#3b82f6] text-white text-xs font-bold rounded-xl border border-[#3b82f6]/60 transition-all flex items-center justify-center gap-2 cursor-pointer shadow active:scale-98"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Join Arena
                    </button>
                  </form>
                </div>

              </div>

            </div>
          )}
        </div>

      </div>

    </div>
  )
}
