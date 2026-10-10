import { useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { colors, radius, fontSize, fontWeight, touchTarget, ring } from '@/lib/design/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled || loading;
  const spinnerColor =
    variant === 'secondary' ? colors.textPrimary : variant === 'ghost' ? colors.brandPrimary : colors.textInverse;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles[`${variant}Pressed` as const],
        isDisabled && styles.disabled,
        focused && Platform.OS === 'web' && styles.focusRing,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text style={[styles.textBase, styles[`${variant}Text` as const]]}>{title}</Text>
      )}
    </Pressable>
  );
}

const webFocusRing: ViewStyle =
  Platform.OS === 'web'
    ? ({
        outlineStyle: 'solid',
        outlineColor: ring.color,
        outlineWidth: ring.width,
        outlineOffset: ring.offset,
      } as unknown as ViewStyle)
    : {};

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Primary
  primary: { backgroundColor: colors.brandPrimary },
  primaryPressed: { backgroundColor: colors.brandPrimaryHover },
  primaryText: { color: colors.textInverse } as TextStyle,
  // Secondary — portal outline: white surface, hairline border, ink text
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  secondaryPressed: { backgroundColor: colors.raised },
  secondaryText: { color: colors.textPrimary } as TextStyle,
  // Ghost
  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: colors.raised },
  ghostText: { color: colors.brandPrimary } as TextStyle,
  // Danger
  danger: { backgroundColor: colors.danger },
  dangerPressed: { backgroundColor: colors.dangerHover },
  dangerText: { color: colors.textInverse } as TextStyle,
  // States
  disabled: { opacity: 0.5 },
  focusRing: webFocusRing,
  textBase: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
});
