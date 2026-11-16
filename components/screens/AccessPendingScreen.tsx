import { View, Text, Linking } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { colors } from '@/lib/design/tokens';
import { officeSitePage } from '@/lib/config';
import { EnvironmentLabel } from '@/components/ui/EnvironmentLabel';
export function AccessPendingScreen() {
  const { user, loadSession, signOut } = useAuthStore();
  // Projects and people are managed on this environment's office site.
  const manage = officeSitePage('projects.html');
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.canvas }}>
    <EnvironmentLabel variant="pill" />
    <Text style={{ fontSize: 24, color: colors.textPrimary }}>Project access pending</Text>
    <Text style={{ color: colors.textMuted }}>Your account has no available project. Ask an administrator to assign you to a project.</Text>
    <Button title="Check access again" onPress={loadSession} />
    {user?.role === 'admin' && manage && <Button title="Manage projects and users" onPress={() => Linking.openURL(manage)} />}
    <Button title="Sign out" variant="secondary" onPress={signOut} />
  </View>;
}
