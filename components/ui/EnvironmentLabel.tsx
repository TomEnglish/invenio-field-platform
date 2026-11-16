import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import { environmentLabel } from '@/lib/config';
import { colors, fontSize, fontWeight, radius, space } from '@/lib/design/tokens';

/**
 * On a build for a dev environment, says so: the environment's label ("Dev")
 * and that what it shows is sample data. It renders nothing in a production
 * build, so it can sit on any screen.
 *
 *   strip  a full-width bar, for the top of the signed-in screens
 *   pill   a small tag, for a screen's heading
 *
 * Its color is not used by the offline and sync banners, so it is never read
 * as one of them.
 */
export function EnvironmentLabel({ variant = 'strip' }: { variant?: 'strip' | 'pill' }) {
  if (!environmentLabel) return null;
  return (
    <View
      style={variant === 'strip' ? styles.strip : styles.pill}
      accessible
      accessibilityLabel={`${environmentLabel} environment. Sample data only.`}
    >
      <Text style={styles.text}>{environmentLabel} · Sample data only</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    alignItems: 'center',
    backgroundColor: colors.info,
  },
  pill: {
    alignSelf: 'center',
    marginTop: space[2],
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.textInverse,
  },
});
