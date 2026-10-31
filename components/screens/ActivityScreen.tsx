import { fetchRecentActivity, type ActivityItem } from '@/lib/api/activity';
import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@/lib/design/tokens';

const ICONS: Record<string, { name: any; color: string; bg: string }> = {
  receiving: { name: 'download', color: colors.brandPrimary, bg: colors.brandPrimarySoft },
  transfer: { name: 'exchange', color: colors.warn, bg: colors.warnSoft },
  issue: { name: 'sign-out', color: colors.success, bg: colors.successSoft },
  count: { name: 'check-square-o', color: colors.brandPrimary, bg: colors.brandPrimarySoft },
  crate: { name: 'archive', color: colors.warn, bg: colors.warnSoft },
  load: { name: 'truck', color: colors.success, bg: colors.successSoft },
  other: { name: 'info-circle', color: colors.textMuted, bg: colors.raised },
};

const PAGE_SIZE = 30;

interface ActivityScreenProps {
  filterByCurrentUser: boolean;
}

export function ActivityScreenContent({ filterByCurrentUser }: ActivityScreenProps) {
  const user = useAuthStore((s) => s.user);
  const activeProject = useAuthStore((s) => s.activeProject);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // The oldest entry shown so far: the next page is older than it.
  const cursorRef = useRef<string | undefined>(undefined);

  const load = async () => {
    if (filterByCurrentUser && !user) return;
    setLoading(true);
    cursorRef.current = undefined;
    try {
      const result = await fetchRecentActivity(
        filterByCurrentUser ? user?.id : undefined,
        { limit: PAGE_SIZE }
      );
      setItems(result.data);
      setHasMore(result.hasMore);
      cursorRef.current = result.next;
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setLoading(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchRecentActivity(
        filterByCurrentUser ? user?.id : undefined,
        { before: cursorRef.current, limit: PAGE_SIZE }
      );
      setItems((prev) => [...prev, ...result.data]);
      setHasMore(result.hasMore);
      cursorRef.current = result.next ?? cursorRef.current;
    } catch { }
    setLoadingMore(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [user?.id, filterByCurrentUser, activeProject?.id])
  );

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const renderItem = ({ item }: { item: ActivityItem }) => {
    const icon = ICONS[item.type] ?? ICONS.receiving;
    return (
      <View style={styles.card}>
        <View style={[styles.iconCircle, { backgroundColor: icon.bg }]}>
          <FontAwesome name={icon.name} size={16} color={icon.color} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.description}</Text>
          <Text style={styles.cardDetail}>{item.detail}</Text>
        </View>
        <Text style={styles.time}>{formatTime(item.created_at)}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListFooterComponent={
          hasMore ? (
            <TouchableOpacity style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
              <Text style={styles.loadMoreText}>
                {loadingMore ? 'Loading...' : 'Load More'}
              </Text>
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="history" size={48} color={colors.borderStrong} />
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  list: { padding: 12, paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  cardDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: colors.textSubtle },
  loadMore: {
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.raised,
    marginTop: 4,
  },
  loadMoreText: { fontSize: 14, fontWeight: '500', color: colors.brandPrimary },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textSubtle, marginTop: 12 },
});
