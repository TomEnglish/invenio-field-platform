import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { useAuthStore } from '@/stores/authStore';
import { getQueueStats, subscribeQueue } from '@/lib/sync/offlineQueue';
import { colors, fontSize, fontWeight, space } from '@/lib/design/tokens';

export function OfflineIndicator() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const { user, activeProject, accessMode } = useAuthStore();
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ pending: 0, deadLetters: 0 });

  useFocusEffect(useCallback(() => {
    let current = true;
    setStats({ pending: 0, deadLetters: 0 });
    const refresh = () => getQueueStats().then(value => {
      if (current) { setStats(value); setError(''); }
    }).catch(() => { if (current) setError('Saved submissions could not be read. Open Sync & recovery.'); });
    void refresh();
    const unsubscribe = subscribeQueue(() => { void refresh(); });
    return () => { current = false; unsubscribe(); };
  }, [isOnline, user?.id, activeProject?.id]));

  return (
    <View>
      <Link href="/sync" style={{ padding: 8, color: colors.brandPrimary }}>Sync &amp; recovery{stats.pending + stats.deadLetters > 0 ? ` (${stats.pending + stats.deadLetters})` : ''}</Link>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.danger, padding: 8 }}>{error}</Text> : null}
      {(!isOnline || accessMode === 'offline') && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.text}>
            {isOnline ? 'Verifying online access — ' : 'You are offline — '}
            {stats.pending > 0 ? `${stats.pending} pending` : 'changes will sync when reconnected'}
          </Text>
        </View>
      )}
      {isOnline && stats.pending > 0 && (
        <View style={[styles.banner, styles.bannerInfo]}>
          <Text style={styles.text}>
            {stats.pending} queued action{stats.pending > 1 ? 's' : ''} waiting to sync
          </Text>
        </View>
      )}
      {stats.deadLetters > 0 && (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Text style={styles.text}>
            {stats.deadLetters} queued action{stats.deadLetters > 1 ? 's' : ''} failed after multiple retries
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: space[2] - 2,
    paddingHorizontal: space[3],
    alignItems: 'center',
  },
  bannerWarn: { backgroundColor: colors.warn },
  bannerInfo: { backgroundColor: colors.brandPrimary },
  bannerDanger: { backgroundColor: colors.danger },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.textInverse,
  },
});
