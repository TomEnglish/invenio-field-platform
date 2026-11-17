import { useState } from 'react';
import { Alert, Linking, Modal as RNModal, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { officeSitePage } from '@/lib/config';
import { isCurrent, menuFor, type MenuItem } from '@/lib/navigation/menu';
import { colors, fontSize, fontWeight, radius, space, touchTarget } from '@/lib/design/tokens';

type Glyph = React.ComponentProps<typeof FontAwesome>['name'];

/**
 * The ☰ button at the top left of the main screens, and the panel it opens: a
 * list of every screen this person can use, in the portal's navy. The bottom
 * panel holds only the four field tools; Dashboard, Reports, Activity and the
 * rest are reached from here (lib/navigation/menu.ts says what is listed).
 */
export function NavMenu() {
  const role = useAuthStore((s) => s.user?.role);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  if (!role) return null;
  const close = () => setOpen(false);
  const choose = (item: MenuItem) => {
    close();
    if (item.route) router.navigate(item.route as any);
    else if (item.url) Linking.openURL(item.url).catch(() => Alert.alert('Page not opened', `${item.label} could not be opened in this phone's browser.`));
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        hitSlop={space[1]}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        accessibilityState={{ expanded: open }}
      >
        {({ pressed }) => <FontAwesome name="bars" size={22} color={colors.navInk} style={{ opacity: pressed ? 0.5 : 1 }} />}
      </Pressable>

      <RNModal visible={open} transparent animationType="fade" onRequestClose={close} accessibilityViewIsModal>
        <View style={styles.row}>
          <View
            style={[styles.panel, { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[3] }]}
            accessibilityViewIsModal
            accessibilityLabel="Menu"
            onAccessibilityEscape={close}
          >
            <View style={styles.heading}>
              <Text style={styles.title} accessibilityRole="header">Menu</Text>
              <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close menu">
                <FontAwesome name="close" size={20} color={colors.navMuted} />
              </Pressable>
            </View>
            <ScrollView>
              {menuFor(role, officeSitePage).map((group) => (
                <View key={group.title} style={styles.group}>
                  <Text style={styles.groupTitle} accessibilityRole="header">{group.title}</Text>
                  {group.items.map((item) => {
                    const current = isCurrent(item, pathname);
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => choose(item)}
                        style={({ pressed }) => [styles.item, (current || pressed) && styles.itemCurrent]}
                        accessibilityRole={item.url ? 'link' : 'button'}
                        accessibilityLabel={item.url ? `${item.label}, opens the office site` : item.label}
                        accessibilityState={{ selected: current }}
                      >
                        <FontAwesome name={item.icon as Glyph} size={18} color={current ? colors.navAccent : colors.navMuted} style={styles.icon} />
                        <Text style={[styles.label, current && styles.labelCurrent]}>{item.label}</Text>
                        {item.url ? <FontAwesome name="external-link" size={14} color={colors.navMuted} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
          <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" />
        </View>
      </RNModal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    marginLeft: space[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flex: 1, flexDirection: 'row' },
  panel: {
    width: '78%',
    maxWidth: 320,
    backgroundColor: colors.navBg,
    borderRightWidth: 1,
    borderRightColor: colors.navBorder,
  },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space[5],
    paddingRight: space[2],
    paddingBottom: space[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.navBorder,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.navInk,
  },
  close: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  group: { paddingTop: space[4] },
  groupTitle: {
    paddingHorizontal: space[5],
    paddingBottom: space[1],
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold as TextStyle['fontWeight'],
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.navMuted,
  },
  item: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  itemCurrent: { backgroundColor: colors.navHover },
  icon: { width: space[8], textAlign: 'center', marginRight: space[2] },
  label: { flex: 1, fontSize: fontSize.md, color: colors.navInk },
  labelCurrent: { fontWeight: fontWeight.semibold as TextStyle['fontWeight'] },
});
