import { useEffect, useMemo, useRef } from 'react';
import * as Speech from 'expo-speech';
import { createCoachThrottle } from '../engine/coachThrottle';

let Haptics = null;
try {
  // eslint-disable-next-line global-require
  Haptics = require('expo-haptics');
} catch (err) {
  Haptics = null;
}

// Spoken + haptic coaching, gated by the chosen level and rate-limited by
// the throttle so corrections don't repeat. Visual cues are rendered by the
// screen from the same events.
export default function useLiveCoach(level) {
  const throttle = useMemo(() => createCoachThrottle({ level }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const speaking = useRef(false);

  useEffect(() => {
    throttle.setLevel(level);
  }, [level, throttle]);

  useEffect(() => () => Speech.stop(), []);

  function say(text, { interrupt = false } = {}) {
    if (throttle.level === 'off') return;
    if (interrupt) Speech.stop();
    speaking.current = true;
    Speech.speak(text, { onDone: () => { speaking.current = false; }, onStopped: () => { speaking.current = false; } });
  }

  return {
    announceRep(number, classification, note) {
      if (!throttle.shouldAnnounceCount()) return;
      if (classification === 'valid') say(String(number), { interrupt: true });
      else if (throttle.level !== 'count') say(note || 'Rep not counted.', { interrupt: true });
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle?.Light).catch?.(() => {});
    },
    cue(code, severity, message) {
      if (throttle.shouldSpeakCue(code, severity, Date.now())) say(message);
    },
    announce(text) {
      say(text, { interrupt: true });
    },
    stop() {
      Speech.stop();
    },
  };
}
