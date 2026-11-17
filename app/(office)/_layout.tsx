import { AccessPendingScreen } from '@/components/screens/AccessPendingScreen';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { NavMenu } from '@/components/ui/NavMenu';
import { OfflineIndicator } from '@/components/ui/OfflineIndicator';
import { ProjectSelector } from '@/components/ui/ProjectSelector';
import { SignOutButton } from '@/components/ui/SignOutButton';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs, router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/lib/design/tokens';

// The menu button, at the left of the header on the main screens. The screens
// a step opens (a receipt, a load, a crate) set their own header and get none.
const menu = () => <NavMenu />;

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
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          // Navy header carries the portal's sidebar identity on phones.
          headerStyle: { backgroundColor: colors.navBg },
          headerTintColor: colors.navInk,
          headerTitleStyle: { fontWeight: '600', color: colors.navInk },
          headerShadowVisible: false,
          // Title on the left, project + sign-out on the right, so the two
          // never overlap. OfflineIndicator above already covers the status
          // bar inset, so the header must not add it again.
          headerTitleAlign: 'left',
          headerStatusBarHeight: 0,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ProjectSelector />
              <SignOutButton />
            </View>
          ),
        }}
      >
        {/* The office home: first, so the Android back button returns to it.
            It and the other office screens are reached from the menu. */}
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dashboard',
            headerLeft: menu,
            href: null,
          }}
        />
        {/* The bottom panel: the same four field tools the crews have. */}
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            headerLeft: menu,
            tabBarIcon: ({ color }) => (
              <FontAwesome name="qrcode" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="count"
          options={{
            title: 'Count',
            headerLeft: menu,
            tabBarIcon: ({ color }) => (
              <FontAwesome name="clipboard" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="loads"
          options={{
            title: 'Loads',
            headerLeft: menu,
            tabBarIcon: ({ color }) => (
              <FontAwesome name="truck" size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="materials"
          options={{
            title: 'Inventory',
            headerLeft: menu,
            tabBarIcon: ({ color }) => (
              <FontAwesome name="cubes" size={24} color={color} />
            ),
          }}
        />
        {/* Reached from the menu. */}
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reports',
            headerLeft: menu,
            href: null,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: 'Activity',
            headerLeft: menu,
            href: null,
          }}
        />
        <Tabs.Screen
          name="locations"
          options={{
            title: 'Locations',
            headerLeft: menu,
            href: null,
          }}
        />
        <Tabs.Screen
          name="qr-codes"
          options={{
            title: 'QR Codes',
            headerLeft: menu,
            href: null,
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
        <Tabs.Screen
          name="count-item"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        {/* Loads: steps opened from a load. */}
        <Tabs.Screen
          name="load"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="load-edit"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="load-checkin"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="load-out"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="load-depart"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="load-unload"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        {/* Crates: opened from Scan. */}
        <Tabs.Screen
          name="crate"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="pack"
          options={{
            href: null,
            headerShown: false,
          }}
        />
        {/* Moving a crate, or correcting where an item is. */}
        <Tabs.Screen
          name="relocate"
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
