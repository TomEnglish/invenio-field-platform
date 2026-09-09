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

export default function OfficeLayout() {
  const { user, activeProject, loading } = useAuthStore();

  useEffect(() => {
    if (!user) {
      router.replace('/');
    } else if (user.role === 'field_worker') {
      router.replace('/(field)/scan');
    }
  }, [user]);

  if (loading) return <LoadingScreen message="Checking access..." />;
  if (!user || user.role === 'field_worker') return null;
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
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="dashboard" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="materials"
          options={{
            title: 'Materials',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="cubes" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="exceptions"
          options={{
            title: 'Exceptions',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="exclamation-triangle" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="locations"
          options={{
            title: 'Locations',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="map-marker" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="camera" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="qr-codes"
          options={{
            title: 'QR Codes',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="qrcode" size={24} color={color} />
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
          name="reports"
          options={{
            title: 'Reports',
            tabBarIcon: ({ color }) => (
              <FontAwesome name="bar-chart" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="admin"
          options={{
            title: 'Data Browser',
            href: user.role === 'admin' ? undefined : null,
            tabBarIcon: ({ color }) => (
              <FontAwesome name="database" size={24} color={color} />
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
