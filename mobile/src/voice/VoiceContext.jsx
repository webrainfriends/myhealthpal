import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as Speech from 'expo-speech';
import { useI18n } from '../i18n/I18nContext';
import { getSetting, setSetting } from '../utils/localSettings';

const ENABLED_KEY = 'myhealthpal.voice.enabled';
const RATE_KEY = 'myhealthpal.voice.rate';

// expo-speech's `rate` is a multiplier of the platform's default reading
// speed, not words-per-minute - these three presets are what
// VoiceAccessibilityScreen's Slow/Normal/Fast chips actually set.
export const RATE_VALUES = { slow: 0.75, normal: 1, fast: 1.25 };

const VoiceContext = createContext(null);

// A single sentinel for "the one thing on this screen that can talk" -
// SpeakButton call sites that don't pass their own `id` (most single-button
// screens) all share it, so only one can be "the thing currently speaking"
// at a time without every call site inventing its own id.
const DEFAULT_ID = '__default__';

// Wraps expo-speech (native TTS on iOS/Android, the Web Speech API on web -
// this app's main deployment target, see tokenStorage.js) behind Voice
// Mode: a device-local opt-in (see localSettings.js) that adds a 🔊 Listen
// button to lab results, insights, and recommendations app-wide, read back
// in whatever language I18nContext resolves from the user's
// preferred_language. Built for anyone who is blind, has low vision, or
// simply prefers listening over reading a screen full of numbers.
export function VoiceProvider({ children }) {
  const { speechLocale } = useI18n();
  const [enabled, setEnabledState] = useState(() => getSetting(ENABLED_KEY, false));
  const [rateKey, setRateKeyState] = useState(() => getSetting(RATE_KEY, 'normal'));
  const [speakingId, setSpeakingId] = useState(null);

  const setEnabled = useCallback((next) => {
    setEnabledState(next);
    setSetting(ENABLED_KEY, next);
    if (!next) Speech.stop();
  }, []);

  const setRate = useCallback((next) => {
    setRateKeyState(next);
    setSetting(RATE_KEY, next);
  }, []);

  const stop = useCallback(() => {
    Speech.stop();
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (text, { id } = {}) => {
      if (!text) return;
      const thisId = id || DEFAULT_ID;
      // Only one thing reads at a time - starting a new one always
      // interrupts whatever was already speaking, rather than queueing or
      // overlapping two voices.
      Speech.stop();
      setSpeakingId(thisId);
      // onDone/onStopped/onError only clear the id if it's still the one
      // that fired them - guards against a slow, already-superseded
      // utterance's callback clearing the *next* one's speaking indicator.
      const clearIfCurrent = () => setSpeakingId((current) => (current === thisId ? null : current));
      Speech.speak(text, {
        language: speechLocale,
        rate: RATE_VALUES[rateKey] ?? RATE_VALUES.normal,
        onDone: clearIfCurrent,
        onStopped: clearIfCurrent,
        onError: clearIfCurrent,
      });
    },
    [speechLocale, rateKey]
  );

  const isSpeaking = useCallback((id) => speakingId === (id || DEFAULT_ID), [speakingId]);

  const value = useMemo(
    () => ({ enabled, setEnabled, rateKey, setRate, speak, stop, isSpeaking }),
    [enabled, setEnabled, rateKey, setRate, speak, stop, isSpeaking]
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within a VoiceProvider');
  return ctx;
}
