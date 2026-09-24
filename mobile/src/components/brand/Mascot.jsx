import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

// "Pal" - MyHealthPal's mascot and app icon: a cheerful heart with a face,
// carrying a small heartbeat badge. Drawn as vector art so it stays crisp at
// every size, from a 32px tab avatar to the full login hero.
//
// `mood="wink"` swaps the right eye for a wink (used on the login hero for a
// little personality); `badge={false}` drops the heartbeat badge for tiny
// renders where it would just be noise.
export default function Mascot({ size = 120, mood = 'happy', badge = true }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const body = `pal-body-${uid}`;
  const shine = `pal-shine-${uid}`;
  const badgeFill = `pal-badge-${uid}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" accessibilityRole="image" accessibilityLabel="MyHealthPal">
      <Defs>
        <LinearGradient id={body} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF7AB8" />
          <Stop offset="0.55" stopColor="#FF4F9A" />
          <Stop offset="1" stopColor="#B43CFF" />
        </LinearGradient>
        <RadialGradient id={shine} cx="0.3" cy="0.25" r="0.5">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.65" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={badgeFill} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1FD1C1" />
          <Stop offset="1" stopColor="#4F7BFF" />
        </LinearGradient>
      </Defs>

      {/* soft ground shadow */}
      <Ellipse cx="100" cy="186" rx="46" ry="6" fill="#2A1466" opacity="0.12" />

      {/* heart body */}
      <Path
        d="M100 176 C 42 138, 14 104, 14 68 C 14 38, 37 18, 64 18 C 81 18, 94 27, 100 40 C 106 27, 119 18, 136 18 C 163 18, 186 38, 186 68 C 186 104, 158 138, 100 176 Z"
        fill={`url(#${body})`}
      />
      <Path
        d="M100 176 C 42 138, 14 104, 14 68 C 14 38, 37 18, 64 18 C 81 18, 94 27, 100 40 C 106 27, 119 18, 136 18 C 163 18, 186 38, 186 68 C 186 104, 158 138, 100 176 Z"
        fill={`url(#${shine})`}
      />
      <Ellipse cx="54" cy="46" rx="15" ry="8" fill="#FFFFFF" opacity="0.55" transform="rotate(-30 54 46)" />

      {/* eyes */}
      <G>
        <Ellipse cx="74" cy="80" rx="12" ry="14" fill="#FFFFFF" />
        <Circle cx="76" cy="83" r="7.5" fill="#2A1466" />
        <Circle cx="79" cy="79" r="2.6" fill="#FFFFFF" />
        {mood === 'wink' ? (
          <Path d="M114 84 Q 126 72 138 84" stroke="#2A1466" strokeWidth="6" strokeLinecap="round" fill="none" />
        ) : (
          <>
            <Ellipse cx="126" cy="80" rx="12" ry="14" fill="#FFFFFF" />
            <Circle cx="128" cy="83" r="7.5" fill="#2A1466" />
            <Circle cx="131" cy="79" r="2.6" fill="#FFFFFF" />
          </>
        )}
      </G>

      {/* cheeks + smile */}
      <Ellipse cx="56" cy="106" rx="11" ry="7" fill="#FFB3D4" opacity="0.9" />
      <Ellipse cx="144" cy="106" rx="11" ry="7" fill="#FFB3D4" opacity="0.9" />
      <Path d="M84 108 Q 100 126 116 108" stroke="#2A1466" strokeWidth="6" strokeLinecap="round" fill="none" />

      {/* heartbeat badge */}
      {badge && (
        <G>
          <Circle cx="158" cy="148" r="30" fill="#FFFFFF" />
          <Circle cx="158" cy="148" r="25" fill={`url(#${badgeFill})`} />
          <Path
            d="M138 149 L 147 149 L 152 138 L 159 160 L 165 144 L 169 149 L 178 149"
            stroke="#FFFFFF"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      )}
    </Svg>
  );
}
