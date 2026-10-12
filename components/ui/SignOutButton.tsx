import { Pressable, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { colors, space } from '@/lib/design/tokens';

export function SignOutButton() {
  const signOut = useAuthStore((s) => s.signOut);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <Pressable
      onPress={handleSignOut}
      style={{ marginRight: space[4] - 1, padding: space[2] }}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
    >
      {({ pressed }) => (
        <FontAwesome
          name="sign-out"
          size={22}
          color={colors.navMuted}
          style={{ opacity: pressed ? 0.5 : 1 }}
        />
      )}
    </Pressable>
  );
}
