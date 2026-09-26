import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { gradients } from '../../theme/theme';

// Paints a diagonal multi-stop gradient behind its siblings. Rendered with
// react-native-svg (already a dependency, and identical on web/iOS/Android)
// rather than pulling in a native gradient module. Place it as the first
// child of a View with `overflow: 'hidden'` and it fills that View.
export default function GradientFill({ colors = gradients.brand, angle = 'diagonal', style }) {
  // useId() returns values like ":r3:", which aren't valid inside an SVG
  // url(#...) reference on every platform.
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const end = angle === 'vertical' ? { x2: '0', y2: '1' } : angle === 'horizontal' ? { x2: '1', y2: '0' } : { x2: '1', y2: '1' };
  return (
    <Svg style={[StyleSheet.absoluteFill, style]} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" {...end}>
          {colors.map((color, index) => (
            <Stop key={color + index} offset={colors.length === 1 ? 0 : index / (colors.length - 1)} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
