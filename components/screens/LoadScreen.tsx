import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { groupRoute } from '@/components/logistics/routes';
import { canUnload, COMPANY_ROLES, licenceOnFile, LOAD_STATUS_LABELS, loadLabel, STOP_KINDS } from '@/lib/logistics/loads';

// One load: its route, truck, driver and companies, what is on it, and the
// steps open to the field at its stage. The office closes or cancels loads.
export function LoadScreenContent() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const { loads, pending, refused, loading, data, reload } = useLoadReference({ refresh: true });
  const [pulling, setPulling] = useState(false);
  const load = loads.loads.get(id);
  const stops = loads.stops.get(id) ?? [];
  const companies = (loads.companies.get(id) ?? []).sort((a, b) => a.position - b.position);
  const forLoad = (item: any) => (item.action.payload?.op?.loadId ?? item.action.payload?.loadId) === id;
  const waiting = pending.filter(forLoad).length, turnedDown = refused.filter(forLoad).length;
  const go = (name: Parameters<typeof groupRoute>[0], params: Record<string, string> = {}) => router.push({ pathname: groupRoute(name) as any, params: { id, ...params } });

  if (!load) return <ScrollView style={styles.container} contentContainerStyle={styles.content}>
    <Stack.Screen options={{ headerShown: true, title: 'Load' }} />
    <Text style={styles.text}>{loading && !data.savedAt ? 'Looking for this load…' : 'This load isn’t on this device. Pull to refresh when online.'}</Text>
  </ScrollView>;

  const before = load.status === 'planning' || load.status === 'loading';
  const pickups = load.status === 'in_transit' ? stops.filter(stop => stop.kind !== 'dropoff' && stop.status !== 'done') : [];
  const licence = licenceOnFile(load) ? 'Licence on file' : load.licence_waiting ? 'Licence saved on this device; it uploads when online'
    : load.licence_override_at ? 'Left without a licence (the office gave a reason)'
    : load.licence_recorded_at ? 'Licence incomplete: the number or the photo of it is missing' : 'No licence recorded yet';
  return <ScrollView
    style={styles.container}
    contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await reload(true); setPulling(false); }} />}
  >
    <Stack.Screen options={{ headerShown: true, title: loadLabel(load) }} />
    <View style={styles.titleRow}>
      <Text style={styles.title} accessibilityRole="header">{loadLabel(load)}</Text>
      <Text style={[styles.badge, load.status === 'in_transit' ? styles.good : null]}>{LOAD_STATUS_LABELS[load.status]}</Text>
    </View>
    {!load.load_number ? <Text style={styles.muted}>Made on this device. It gets its number when it uploads.</Text> : null}
    {turnedDown ? <View style={styles.refused}>
      <Text style={styles.warning} accessibilityRole="alert">The server refused {turnedDown === 1 ? 'a change' : `${turnedDown} changes`} to this load, so {turnedDown === 1 ? 'it isn’t' : 'they aren’t'} shown here. Sync has the reason.</Text>
      <Button title="View Sync" variant="ghost" onPress={() => router.push('/sync')} />
    </View> : null}
    {waiting ? <View style={styles.note}><Text style={styles.text}>{waiting} change{waiting === 1 ? '' : 's'} to this load {waiting === 1 ? 'is' : 'are'} waiting to upload, and already show here.</Text></View> : null}

    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">Pieces</Text>
      <Text style={styles.text}>{load.planned_count} planned · {load.on_board_count} on board · {load.delivered_count} delivered{load.missing_count ? ` · ${load.missing_count} missing` : ''}{load.written_off_count ? ` · ${load.written_off_count} written off` : ''}{load.flagged_count ? ` · ${load.flagged_count} flagged` : ''}</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">Route</Text>
      <Text style={styles.text}>From {load.origin_name ?? 'origin not set'}{load.planned_date ? ` · ${load.planned_date}` : ''}</Text>
      {stops.length === 0 ? <Text style={styles.muted}>No stops yet.</Text> : null}
      {stops.map(stop => <Text key={stop.id} style={[styles.text, stop.status === 'done' && styles.done]}>
        {stop.seq}. {stop.place_name} · {STOP_KINDS.find(k => k.value === stop.kind)?.label} · {stop.status === 'done' ? 'Done' : stop.status === 'arrived' ? 'Arrived' : 'To come'}
        {stop.due_count || stop.delivered_count || stop.missing_count ? ` · ${stop.delivered_count} off, ${stop.due_count} due${stop.missing_count ? `, ${stop.missing_count} missing` : ''}` : ''}
      </Text>)}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">Truck and driver</Text>
      <Text style={styles.text}>{[load.truck_type, load.truck_number && `Truck ${load.truck_number}`, load.trailer_number && `Trailer ${load.trailer_number}`, load.bol_number && `BOL ${load.bol_number}`].filter(Boolean).join(' · ') || 'No truck details yet'}</Text>
      <Text style={styles.text}>{load.driver_name ? `${load.driver_name}${load.driver_phone ? ` · ${load.driver_phone}` : ''}` : 'No driver checked in yet'}</Text>
      <Text style={licenceOnFile(load) ? styles.text : styles.muted}>{licence}</Text>
      {companies.map(company => <Text key={company.position} style={styles.muted}>
        {company.name} · {COMPANY_ROLES.find(role => role.value === company.role)?.label}{company.contact_name ? ` · ${company.contact_name}` : ''}{company.phone ? ` · ${company.phone}` : ''}
      </Text>)}
    </View>
    {load.notes ? <Text style={styles.muted}>{load.notes}</Text> : null}

    <View style={styles.actions}>
      {before ? <>
        <Button title="Load out" onPress={() => go('load-out')} />
        <Button title="Depart" variant="secondary" onPress={() => go('load-depart')} />
      </> : null}
      {load.status === 'in_transit' ? <Button title="Unload at a stop" onPress={() => go('load-unload')} /> : null}
      {load.status === 'delivered' && canUnload(load) ? <Button title="Scan off a piece found late" variant="secondary" onPress={() => go('load-unload')} /> : null}
      {pickups.map(stop => <Button key={stop.id} title={`Pick up at ${stop.place_name}`} variant="secondary" onPress={() => go('load-out', { stopId: stop.id })} />)}
      {before || load.status === 'in_transit' ? <Button title="Driver check-in" variant="secondary" onPress={() => go('load-checkin')} /> : null}
      {before || load.status === 'in_transit' ? <Button title="Edit load" variant="ghost" onPress={() => go('load-edit')} /> : null}
    </View>
  </ScrollView>;
}
