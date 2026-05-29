import React from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { RealtimeProvider } from './context/RealtimeContext'
import { AuthScreen } from './components/auth/AuthScreen'
import { Dashboard } from './components/home/Dashboard'
import { MessageSquare } from 'lucide-react'

const AppContent = () => {
    const { user, loading } = useAuth()

    // Elegant dark loading spinner matching Steam/Discord theme
    if (loading) {
        return (
            <div className="min-h-screen w-full bg-[#101216] flex flex-col items-center justify-center relative overflow-hidden">
                <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-[#3b82f6]/5 blur-[120px] pointer-events-none" />

                <div className="relative flex flex-col items-center animate-pulse">
                    <div className="w-12 h-12 rounded-xl bg-linear-to-tr from-[#1b2838] to-[#2a475e] border border-[#3b82f6] flex items-center justify-center shadow-lg shadow-[#3b82f6]/20 mb-4 animate-spin">
                        <MessageSquare className="w-6 h-6 text-[#3b82f6]" />
                    </div>
                    <span className="text-[10px] font-bold text-[#3b82f6] tracking-widest uppercase">
                        Connecting to Arena...
                    </span>
                </div>
            </div>
        )
    }

    // Switch views depending on authenticated state
    if (!user) {
        return <AuthScreen />
    }

    return <Dashboard />
}

function App() {
    return (
        <AuthProvider>
            <RealtimeProvider>
                <AppContent />
            </RealtimeProvider>
        </AuthProvider>
    )
}

export default App
