import { Platform } from 'react-native';

const SCRIPT_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

let scriptPromise = null;
function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.AppleID) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Sign in with Apple script.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Apple requires the page to be served over HTTPS (or localhost) and the
// exact origin to be pre-registered as a Return URL in the Apple Developer
// portal - neither is something app code can satisfy on its own, so the
// caller should hide the "Sign in with Apple" option entirely when this is
// false rather than show a button that can only ever fail.
export function isAppleSignInEligible() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
}

// Triggers Apple's popup sign-in flow. Unlike Google's SDK there is no
// separate "render a button" step - this is invoked directly on tap.
// Resolves with { identityToken, fullName } - fullName is only ever
// present on a person's very first authorization (Apple's own behavior,
// not something this app controls), so it must be captured and sent to
// the server that one time or it's lost for good.
export async function signInWithApple({ clientId }) {
  if (Platform.OS !== 'web') throw new Error('Sign in with Apple is only available on web in this app.');
  await loadScript();
  window.AppleID.auth.init({
    clientId,
    scope: 'name email',
    redirectURI: window.location.origin,
    usePopup: true,
  });
  const result = await window.AppleID.auth.signIn();
  const fullName = result.user?.name
    ? [result.user.name.firstName, result.user.name.lastName].filter(Boolean).join(' ')
    : null;
  return { identityToken: result.authorization.id_token, fullName };
}
