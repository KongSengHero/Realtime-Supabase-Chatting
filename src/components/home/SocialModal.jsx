import React, { useState } from 'react'
import { useRealtime } from '../../context/RealtimeContext'
import { Users, UserMinus, UserCheck, UserX, X, Heart, Clock } from 'lucide-react'

export const SocialModal = ({ isOpen, onClose }) => {
  const { friends, friendRequests, acceptFriendRequest, rejectFriendRequest, removeFriend } = useRealtime()
  const [activeTab, setActiveTab] = useState('friends') // 'friends' | 'received' | 'sent'

  if (!isOpen) return null

  const tabs = [
    { id: 'friends', label: `Friends (${friends.length})`, icon: Users },
    { id: 'received', label: `Friend Requests (${friendRequests.received.length})`, icon: UserCheck },
    { id: 'sent', label: `Sent (${friendRequests.sent.length})`, icon: Clock }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101216]/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-[500px] bg-[#171a21] border border-[#2a475e] rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh] animate-slide-in-up">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white m-0 flex items-center gap-2">
            <Users className="w-5 h-5 text-[#3b82f6]" />
            Social Panel
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#2a475e]/50 rounded-lg text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs navigation */}
        <div className="flex border-b border-[#2a475e]/50 mb-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 text-xs font-semibold tracking-wider uppercase border-b-2 flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  activeTab === tab.id
                    ? 'border-[#3b82f6] text-[#3b82f6]'
                    : 'border-transparent text-[#94a3b8] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content (Scrollable list) */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 min-h-[250px]">
          
          {/* FRIENDS TAB */}
          {activeTab === 'friends' && (
            friends.length === 0 ? (
              <div className="text-center py-12 text-[#64748b]">
                <Heart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No friends added yet.</p>
                <p className="text-xs opacity-75 mt-1">Use Search to find and add players.</p>
              </div>
            ) : (
              friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between p-3.5 bg-[#0e141d]/60 hover:bg-[#0e141d] border border-[#2a475e]/30 hover:border-[#2a475e] rounded-xl transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {friend.profile_url ? (
                        <img src={friend.profile_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-[#2a475e]" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e] flex items-center justify-center text-sm font-bold text-[#3b82f6]">
                          {friend.player_name.substring(0, 2).toUpperCase()}
                        </div>
                      )}
                      {/* Status dot */}
                      <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#171a21] ${
                        friend.current_status === 'Online' ? 'bg-[#10b981]' :
                        friend.current_status === 'Lobby' ? 'bg-[#f59e0b]' : 'bg-gray-500'
                      }`} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white m-0 leading-tight">{friend.player_name}</h4>
                      <p className="text-xs text-[#64748b] mt-0.5 font-medium">ID: {friend.player_id}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => removeFriend(friend.id)}
                    title="Remove Friend"
                    className="p-2 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 text-[#94a3b8] hover:text-red-400 rounded-lg transition-all cursor-pointer"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              ))
            )
          )}

          {/* RECEIVED TAB */}
          {activeTab === 'received' && (
            friendRequests.received.length === 0 ? (
              <div className="text-center py-12 text-[#64748b]">
                <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No pending requests.</p>
              </div>
            ) : (
              friendRequests.received.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between p-3.5 bg-[#0e141d]/60 border border-[#2a475e]/30 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    {req.profile_url ? (
                      <img src={req.profile_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-[#2a475e]" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e] flex items-center justify-center text-sm font-bold text-[#3b82f6]">
                        {req.player_name.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-bold text-white m-0 leading-tight">{req.player_name}</h4>
                      <p className="text-xs text-[#64748b] mt-0.5">Wants to be friends</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptFriendRequest(req.id)}
                      className="p-2 bg-[#10b981]/10 border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981] hover:text-white rounded-lg transition-all cursor-pointer"
                    >
                      <UserCheck className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => rejectFriendRequest(req.id)}
                      className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-all cursor-pointer"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )
          )}

          {/* SENT TAB */}
          {activeTab === 'sent' && (
            friendRequests.sent.length === 0 ? (
              <div className="text-center py-12 text-[#64748b]">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No sent requests.</p>
              </div>
            ) : (
              friendRequests.sent.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between p-3.5 bg-[#0e141d]/60 border border-[#2a475e]/30 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    {req.profile_url ? (
                      <img src={req.profile_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-[#2a475e]" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1b2838] to-[#2a475e] border border-[#2a475e] flex items-center justify-center text-sm font-bold text-[#3b82f6]">
                        {req.player_name.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-bold text-white m-0 leading-tight">{req.player_name}</h4>
                      <p className="text-xs text-[#64748b] mt-0.5">Awaiting response</p>
                    </div>
                  </div>

                  <button
                    onClick={() => rejectFriendRequest(req.id)} // Canceling is equivalent to rejecting request from requester-side
                    title="Cancel Request"
                    className="p-2 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 text-[#94a3b8] hover:text-red-400 rounded-lg transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )
          )}

        </div>
      </div>
    </div>
  )
}
