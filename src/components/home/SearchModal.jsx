import React, { useState } from 'react'
import { useRealtime } from '../../context/RealtimeContext'
import { Search, UserPlus, X, AlertCircle, CheckCircle } from 'lucide-react'

export const SearchModal = ({ isOpen, onClose }) => {
  const { sendFriendRequest } = useRealtime()
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message: string }

  if (!isOpen) return null

  const handleSearchSubmit = async (e) => {
    e.preventDefault()
    if (!searchTerm.trim()) return

    setLoading(true)
    setFeedback(null)

    const result = await sendFriendRequest(searchTerm.trim())
    if (result.success) {
      setFeedback({ type: 'success', message: result.message })
      setSearchTerm('')
    } else {
      setFeedback({ type: 'error', message: result.message })
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101216]/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-[460px] bg-[#171a21] border border-[#2a475e] rounded-2xl p-6 shadow-2xl animate-slide-in-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white m-0 flex items-center gap-2">
            <Search className="w-5 h-5 text-[#3b82f6]" />
            Search Players
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#2a475e]/50 rounded-lg text-[#94a3b8] hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[#94a3b8] mb-4">
          Enter a friend's exact **Username** or their unique **16-digit Player ID** to send a request.
        </p>

        {/* Form */}
        <form onSubmit={handleSearchSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search username or 16-digit ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-4 pr-12 py-3 bg-[#0e141d] border border-[#2a475e] rounded-xl text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] text-sm font-medium"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !searchTerm.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#2a475e] hover:bg-[#3b82f6] text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-4 p-4 rounded-xl flex items-start gap-3 border text-sm animate-fade-in ${
              feedback.type === 'success'
                ? 'bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981]'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-semibold m-0 capitalize">{feedback.type}</p>
              <p className="m-0 mt-0.5 text-xs opacity-90">{feedback.message}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
