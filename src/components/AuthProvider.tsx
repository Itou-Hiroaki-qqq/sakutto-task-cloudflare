'use client';

import { createContext, useContext, ReactNode } from 'react';

interface AuthUser {
    userId: string | null;
    email: string | null;
    name: string | null;
}

const AuthContext = createContext<AuthUser>({ userId: null, email: null, name: null });

export function AuthProvider({
    user,
    children,
}: {
    user: AuthUser;
    children: ReactNode;
}) {
    return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthUser {
    return useContext(AuthContext);
}
