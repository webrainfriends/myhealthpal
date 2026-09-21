import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadToken, saveToken, clearToken } from './tokenStorage';
import {
  fetchMe,
  setUnauthorizedHandler,
  signInGuest,
  signInGoogle as apiSignInGoogle,
  signInApple as apiSignInApple,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // Wired once so a 401 anywhere in the app (expired/invalid/revoked
  // session) drops back to the sign-in screen instead of quietly failing.
  useEffect(() => {
    setUnauthorizedHandler(signOut);
  }, [signOut]);

  // Resume an existing session on load rather than force a fresh sign-in
  // every time the page opens - a stale/invalid stored token is dropped
  // silently, the same as never having had one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = loadToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { user: me } = await fetchMe();
        if (!cancelled) setUser(me);
      } catch (err) {
        // Only an actual 401 means the session itself is invalid. A 500,
        // network blip, or timeout is transient and must not wipe a
        // perfectly good token - that would force a needless re-sign-in.
        if (err?.status === 401) clearToken();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function completeSignIn(request) {
    const { token, user: nextUser } = await request;
    saveToken(token);
    setUser(nextUser);
  }

  const signInAsGuest = useCallback(() => completeSignIn(signInGuest()), []);
  const signInWithGoogle = useCallback((idToken) => completeSignIn(apiSignInGoogle(idToken)), []);
  const signInWithApple = useCallback(
    (identityToken, fullName) => completeSignIn(apiSignInApple(identityToken, fullName)),
    []
  );

  return (
    <AuthContext.Provider value={{ user, loading, signInAsGuest, signInWithGoogle, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
