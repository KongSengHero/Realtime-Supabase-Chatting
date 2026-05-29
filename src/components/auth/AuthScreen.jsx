import React, { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { User, LogIn, MessageSquare } from 'lucide-react'

export const AuthScreen = () => {
    const { signInAnonymously, signInWithGoogle } = useAuth()
    const [displayName, setDisplayName] = useState('')
    const [isLoading, setIsLoading] = useState(false)

    const handleAnonymousSubmit = async (e) => {
        e.preventDefault()
        setIsLoading(true)
        await signInAnonymously(displayName)
        setIsLoading(false)
    }

    return (
        <div className="min-h-screen w-full bg-[#101216] flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background glowing effects */}
            <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-[#3b82f6]/10 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-[#3b82f6]/5 blur-[120px] pointer-events-none" />

            {/* Main container */}
            <div className="w-full max-w-110 glass-panel glass-panel-glow rounded-2xl p-8 border border-[#2a475e]/60 animate-slide-in-up relative z-10">

                {/* Logo/Icon */}
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-[#1b2838] to-[#2a475e] border border-[#3b82f6] flex items-center justify-center shadow-lg shadow-[#3b82f6]/20 mb-4 animate-pulse-glow">
                        <MessageSquare className="w-8 h-8 text-[#3b82f6]" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-white m-0">
                        CONVAYTO <span className="text-[#3b82f6] text-sm font-semibold uppercase tracking-wider ml-1 bg-[#3b82f6]/15 px-2 py-0.5 rounded">Realtime</span>
                    </h1>
                    <p className="text-[#94a3b8] text-sm mt-1 text-center">
                        A premium real-time multiplayer chatting & lobby arena
                    </p>
                </div>

                {/* Input Name for Anonymous */}
                <form onSubmit={handleAnonymousSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-2">
                            Play Anonymously
                        </label>
                        <div className="relative">
                            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#64748b]" />
                            <input
                                type="text"
                                placeholder="Enter display name (optional)"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                maxLength={20}
                                className="w-full pl-11 pr-4 py-3 bg-[#0e141d] border border-[#2a475e] rounded-xl text-white placeholder-[#64748b] focus:outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]/40 transition-all text-sm font-medium"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-3 bg-linear-to-r from-[#1b2838] to-[#2a475e] hover:from-[#2a475e] hover:to-[#3b82f6] text-white font-semibold rounded-xl text-sm border border-[#3b82f6]/60 hover:border-[#3b82f6] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-[0.98] disabled:opacity-50"
                    >
                        <LogIn className="w-4 h-4" />
                        {isLoading ? 'Connecting...' : 'Quick Play'}
                    </button>
                </form>

                {/* Divider */}
                <div className="relative my-8">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-[#2a475e]/60"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-[#171a21] px-3 text-[#64748b] font-semibold tracking-wider">
                            Or Connect With
                        </span>
                    </div>
                </div>

                {/* Google sign-in */}
                <button
                    onClick={signInWithGoogle}
                    disabled={isLoading}
                    className="w-full py-3 bg-[#0e141d] hover:bg-[#1b2838] text-white border border-[#2a475e] rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-3 cursor-pointer hover:border-[#3b82f6] active:scale-[0.98]"
                >
                    {/* Custom Google SVG Icon */}
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                            fill="#EA4335"
                            d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.54 14.98 1 12 1 7.35 1 3.39 3.65 1.56 7.56l3.86 3C6.34 7.67 8.94 5.04 12 5.04z"
                        />
                        <path
                            fill="#4285F4"
                            d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.4 3.58l3.76 2.92c2.2-2.03 3.67-5.01 3.67-8.65z"
                        />
                        <path
                            fill="#FBBC05"
                            d="M5.42 14.56c-.24-.72-.38-1.49-.38-2.31 0-.82.14-1.59.38-2.31L1.56 6.94C.56 8.96 0 11.21 0 12.5s.56 3.54 1.56 5.56l3.86-3z"
                        />
                        <path
                            fill="#34A853"
                            d="M12 23c3.24 0 5.97-1.07 7.96-2.92l-3.76-2.92c-1.1.74-2.52 1.18-4.2 1.18-3.06 0-5.66-2.63-6.58-5.52L1.56 15.8C3.39 19.7 7.35 23 12 23z"
                        />
                    </svg>
                    Sign in with Google
                </button>

                {/* Footer info */}
                <div className="mt-8 text-center text-xs text-[#64748b]">
                    Secured with Supabase Row Level Security (RLS)
                </div>
            </div>
        </div>
    )
}
