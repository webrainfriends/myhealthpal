import { Platform } from 'react-native';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;
function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In script.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Renders Google's own button into the given DOM node and resolves with the
// ID token once the user completes sign-in. Web only - Google Identity
// Services is a browser SDK, and there is no native build of this app to
// wire native Google Sign-In into yet (see README).
export function renderGoogleButton({ clientId, container, onToken, onError }) {
  if (Platform.OS !== 'web' || !container) return;
  loadScript()
    .then(() => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => onToken(response.credential),
      });
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', width: 320 });
    })
    .catch((err) => onError?.(err));
}
