// Coaching levels and cue rate-limiting (issue #135 §7).
const LEVELS = ['off', 'count', 'minimal', 'full'];
const SEVERITY_RANK = { info: 0, minor: 1, significant: 2, reposition: 3 };

// Which form-cue severities a level may speak.
const MIN_SEVERITY = { off: Infinity, count: Infinity, minimal: SEVERITY_RANK.significant, full: SEVERITY_RANK.minor };

function createCoachThrottle({ level = 'full', globalGapMs = 4000, perCodeGapMs = 15000 } = {}) {
  let lastAny = -Infinity;
  const lastByCode = new Map();

  return {
    setLevel(next) { level = LEVELS.includes(next) ? next : level; },
    get level() { return level; },
    // Rep counts are announced at every level except 'off'.
    shouldAnnounceCount() { return level !== 'off'; },
    // A form cue is spoken only if the level allows its severity and it is
    // neither too soon after any cue nor a recent repeat of the same rule.
    shouldSpeakCue(code, severity, now) {
      if ((SEVERITY_RANK[severity] ?? 0) < MIN_SEVERITY[level]) return false;
      if (now - lastAny < globalGapMs) return false;
      if (now - (lastByCode.get(code) ?? -Infinity) < perCodeGapMs) return false;
      lastAny = now;
      lastByCode.set(code, now);
      return true;
    },
  };
}

module.exports = { createCoachThrottle, LEVELS };
