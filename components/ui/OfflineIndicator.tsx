import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { getQueueStats } from '@/lib/sync/offlineQueue';
import { colors, fontSize, fontWeight, space } from '@/lib/design/tokens';

export function OfflineIndicator() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [stats, setStats] = useState({ pending: 0, deadLetters: 0 });

  useFocusEffect(
    useCallback(() => {
      getQueueStats().then(setStats);
    }, [isOnline])
  );



  return (
    <View>
      <Link href="/sync" style={{ padding: 8, color: colors.brandPrimary }}>Sync &amp; recovery{stats.pending + stats.deadLetters > 0 ? ` (${stats.pending + stats.deadLetters})` : ''}</Link>
      {!isOnline && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.text}>
            You are offline —{' '}
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
