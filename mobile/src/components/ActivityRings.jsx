import Svg, { Circle } from 'react-native-svg';

// One ring: a muted full-circle track plus a colored progress arc drawn with
// a dashed stroke whose dash length equals the circle's own circumference -
// the standard SVG trick for a circular progress indicator. Rotated -90deg
// so 0% starts at 12 o'clock and fills clockwise, matching Apple Health.
function Ring({ cx, cy, radius, strokeWidth, percent, fg, track }) {
  const circumference = 2 * Math.PI * radius;
  // Capped at 1 for the stroke itself - a goal exceeded still reads as "the
  // ring closed", the exact value/goal text next to it carries the rest.
  const clamped = Math.max(0, Math.min(1, percent));
  const dashoffset = circumference * (1 - clamped);

  return (
    <>
      <Circle cx={cx} cy={cy} r={radius} stroke={track} strokeWidth={strokeWidth} fill="none" />
      {clamped > 0 && (
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={fg}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${cx}, ${cy}`}
        />
      )}
    </>
  );
}

// Apple Health-style concentric rings. `rings` is outer-to-inner:
// [{ percent, fg, track }, ...] - percent is 0-1 (already computed goal
// progress, not a raw value), fg/track are this ring's two colors.
export default function ActivityRings({ rings, size = 140, strokeWidth = 14, gap = 4 }) {
  const cx = size / 2;
  const cy = size / 2;

  return (
    <Svg width={size} height={size}>
      {rings.map((ring, index) => (
        <Ring
          key={index}
          cx={cx}
          cy={cy}
          radius={cx - strokeWidth / 2 - index * (strokeWidth + gap)}
          strokeWidth={strokeWidth}
          percent={ring.percent}
          fg={ring.fg}
          track={ring.track}
        />
      ))}
    </Svg>
  );
}
