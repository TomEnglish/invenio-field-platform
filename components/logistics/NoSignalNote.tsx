import { Text, Platform, AccessibilityInfo, StyleSheet } from 'react-native';
import { colors, fontSize } from '@/lib/design/tokens';

// A received item's page reads from the server, so offline it can't open. The note shows right under the row that
// was tapped: Android reads it out as a live region, and iOS (which has none) is told directly.
export const noSignalText = (tag: string) => `${tag}'s page needs signal. Try again when this phone is online.`;
export function sayNoSignal(tag: string) {
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(noSignalText(tag));
}
export function NoSignalNote({ tag }: { tag: string }) {
  return <Text style={styles.note} accessibilityRole="alert" accessibilityLiveRegion="polite">{noSignalText(tag)}</Text>;
}

const styles = StyleSheet.create({
  note: { fontSize: fontSize.body, color: colors.warnDeep, lineHeight: 20 },
});
