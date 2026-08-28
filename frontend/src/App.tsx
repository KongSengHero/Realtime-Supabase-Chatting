import { Suspense } from "react"
import { Route, Routes } from "react-router-dom"





function GuestRoute({ children } :  { children: React.ReactNode }) { 
    return children; 
}

function ProtectedRoute({ children } : { children: React.ReactNode }) { 
    return children; 
}

function Router() { 
    return ( 
        <>
            <div className="page-CONTAINER">
                <Suspense fallback={<>Loading</>}>
                    <Routes>
                        <Route path="/"         element={ <GuestRoute> Welcome </GuestRoute>} />
                        <Route path="/about"    element={ <GuestRoute> About </GuestRoute>} />
                        <Route path="/contact"  element={ <GuestRoute> Contact </GuestRoute>} />
                        <Route path="/login"    element={ <GuestRoute> Login </GuestRoute>} />
                        
                        <Route path="/home"     element={ <ProtectedRoute> Home </ProtectedRoute>} />
                        <Route path="/social"   element={ <ProtectedRoute> Social </ProtectedRoute>} />
                        <Route path="/profile"  element={ <ProtectedRoute> Profile </ProtectedRoute>} />
                    </Routes>
                </Suspense>
            </div>
        </>
    )
}

export default function App() { 
    return (
        <Router />
    )
}
