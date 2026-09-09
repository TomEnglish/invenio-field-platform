import { AccessPendingScreen } from '@/components/screens/AccessPendingScreen';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { OfflineIndicator } from '@/components/ui/OfflineIndicator';
import { ProjectSelector } from '@/components/ui/ProjectSelector';
import { SignOutButton } from '@/components/ui/SignOutButton';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/lib/design/tokens';

export default function FieldLayout() {
  const { user, activeProject, loading } = useAuthStore();

  useEffect(() => {
    if (!user) {
      router.replace('/');
    } else if (user.role === 'office_staff') {
      router.replace('/(office)/dashboard');
    }
  }, [user]);

  if (loading) return <LoadingScreen message="Checking access..." />;
  if (!user) return null;
  if (!activeProject) return <AccessPendingScreen />;
  return (
    <View style={styles.container}>
      <OfflineIndicator />
      <Tabs key={`${user.id}:${activeProject.id}`}
        screenOptions={{
          tabBarActiveTintColor: colors.brandPrimary,
          tabBarInactiveTintColor: colors.textSubtle,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontWeight: '600' },
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ProjectSelector />
              <SignOutButton />
            </View>
          ),
        }}
      >
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="qrcode" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="inventory"
          options={{
            title: 'Inventory',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="cubes" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="history" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="receiving"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="material-detail"
          options={{
            href: null,
            headerShown: false,
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
