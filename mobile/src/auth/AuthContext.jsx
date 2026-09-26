import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadToken, saveToken, clearToken } from './tokenStorage';
import { getSetting, setSetting } from '../utils/localSettings';
import {
  fetchFamily,
  fetchMe,
  setActiveProfileId,
  setUnauthorizedHandler,
  signInGuest,
  signInGoogle as apiSignInGoogle,
  signInApple as apiSignInApple,
} from '../api/client';

const AuthContext = createContext(null);

// Remembered per account so reopening the app returns to the family
// member's profile the caregiver was last looking at.
function activeProfileKey(userId) {
  return `myhealthpal.activeProfile.${userId}`;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // The family member's profile being viewed ({ id, displayName, relation,
  // access, ... } from /api/family), or null for the account's own.
  const [activeProfile, setActiveProfile] = useState(null);

  const applyProfile = useCallback((accountId, profile) => {
    const next = profile && !profile.isSelf ? profile : null;
    setActiveProfileId(next ? next.id : null);
    setActiveProfile(next);
    if (accountId) setSetting(activeProfileKey(accountId), next ? next.id : null);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setActiveProfileId(null);
    setActiveProfile(null);
    setUser(null);
  }, []);

  // Switches every screen's data to a family member (or back to yourself
  // with null) - the navigator remounts on this, so each screen reloads.
  const switchProfile = useCallback((profile) => applyProfile(user?.id, profile), [applyProfile, user?.id]);

  // For a notification that names a profile by id (a caregiver's
  // reminder): looks it up so the switch carries its name and access.
  const switchProfileById = useCallback(
    async (profileId) => {
      if (!user) return;
      if (!profileId || profileId === user.id) {
        applyProfile(user.id, null);
        return;
      }
      try {
        const { profiles } = await fetchFamily();
        const profile = profiles.find((p) => p.id === profileId);
        if (profile) applyProfile(user.id, profile);
      } catch (err) {
        console.warn('Could not switch profile', err.message);
      }
    },
    [applyProfile, user]
  );

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
        // Restore the last-viewed family profile, but only if this account
        // still has access to it.
        const rememberedProfileId = getSetting(activeProfileKey(me.id), null);
        if (rememberedProfileId) {
          try {
            const { profiles } = await fetchFamily();
            const profile = profiles.find((p) => p.id === rememberedProfileId);
            if (!cancelled) applyProfile(me.id, profile || null);
          } catch {
            // Fall back to the account's own profile.
          }
        }
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
  }, [applyProfile]);

  async function completeSignIn(request) {
    const { token, user: nextUser } = await request;
    saveToken(token);
    setActiveProfileId(null);
    setActiveProfile(null);
    setUser(nextUser);
  }

  const signInAsGuest = useCallback(() => completeSignIn(signInGuest()), []);
  const signInWithGoogle = useCallback((idToken) => completeSignIn(apiSignInGoogle(idToken)), []);
  const signInWithApple = useCallback(
    (identityToken, fullName) => completeSignIn(apiSignInApple(identityToken, fullName)),
    []
  );
  // For a screen that already made its own API call to update the profile
  // (e.g. LanguagePreferenceScreen) and just needs the cached `user` object
  // to reflect it, without a full re-fetch.
  const updateUser = useCallback((nextUser) => setUser(nextUser), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInAsGuest,
        signInWithGoogle,
        signInWithApple,
        signOut,
        updateUser,
        activeProfile,
        switchProfile,
        switchProfileById,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
