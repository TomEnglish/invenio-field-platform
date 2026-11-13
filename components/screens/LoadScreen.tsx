import { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { useNetworkStore } from '@/lib/sync/networkStore';
import type { LoadIndex } from '@/lib/logistics/crates';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { NoSignalNote, sayNoSignal } from '@/components/logistics/NoSignalNote';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { groupRoute } from '@/components/logistics/routes';
import { canUnload, COMPANY_ROLES, countedOnly, licenceOnFile, LINE_STATUS_LABELS, LOAD_STATUS_LABELS, loadLabel, loadPieces, pieceRoute, STOP_KINDS, type LoadLine } from '@/lib/logistics/loads';
import { colors } from '@/lib/design/tokens';

// One piece on the load: a crate (or container, skid...) opens its Crate screen, a received item its material's page.
// `known` is the device's copy, for lines saved before they said what an item is. Offline, a received item's page
// can't load, so the tap says so under the row (`warned`) instead.
function PieceRow({ line, known, online, warned, onNoSignal }: { line: LoadLine; known: LoadIndex; online: boolean; warned: boolean; onNoSignal: (line: LoadLine) => void }) {
  const route = pieceRoute(line, known);
  const status = LINE_STATUS_LABELS[line.status] ?? line.status;
  const body = <>
    <FontAwesome name={line.piece_kind === 'crate' ? 'archive' : 'tag'} size={16} color={route ? colors.brandPrimary : colors.textMuted} />
    <View style={styles.rowText}>
      <Text style={styles.rowTitle}>{line.tag}{line.is_high_value ? ' · High value' : ''}</Text>
      <Text style={styles.muted}>{line.name} · {status}{countedOnly(line, known) ? ' · Counted, not received yet' : ''}</Text>
    </View>
    {route ? <FontAwesome name="chevron-right" size={12} color={colors.textMuted} /> : null}
  </>;
  if (!route) return <View style={styles.row}>{body}</View>;
  const go = () => {
    if (route.to === 'crate') router.push({ pathname: groupRoute('crate') as any, params: { code: route.code } });
    // The material's page reads from the server: offline it would say the item isn't found.
    else if (!online) onNoSignal(line);
    else router.push({ pathname: groupRoute('material-detail') as any, params: { id: route.id } });
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${line.tag}, ${line.name}, ${status}. Open it.`} onPress={go} style={styles.row}>{body}</Pressable>
    {warned ? <NoSignalNote tag={line.tag} /> : null}
  </>;
}

// One load: its route, truck, driver and companies, what is on it, and the
// steps open to the field at its stage. The office closes or cancels loads.
// Each piece opens what it is: a crate's contents, or an item's page.
export function LoadScreenContent() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const { loads, index, pending, refused, loading, data, reload } = useLoadReference({ refresh: true });
  const online = useNetworkStore(s => s.isOnline);
  const [pulling, setPulling] = useState(false);
  // The piece whose page couldn't open for want of signal; cleared when signal returns or another load opens.
  const [noSignal, setNoSignal] = useState<string | null>(null);
  useEffect(() => { setNoSignal(null); }, [id, online]);
  const noSignalFor = (line: LoadLine) => { setNoSignal(line.id); sayNoSignal(line.tag); };
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

  const pieces = loadPieces(loads, id);
  const before = load.status === 'planning' || load.status === 'loading';
  const pickups = load.status === 'in_transit' ? stops.filter(stop => stop.kind !== 'dropoff' && stop.status !== 'done') : [];
  const licence = licenceOnFile(load) ? 'License on file' : load.licence_waiting ? 'License saved on this device; it uploads when online'
    : load.licence_override_at ? 'Left without a license (the office gave a reason)'
    : load.licence_recorded_at ? 'License incomplete: the number or the photo of it is missing' : 'No license recorded yet';
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
      {pieces.map(group => <View key={group.stop?.id ?? 'other'} style={styles.section}>
        <Text style={styles.rowTitle}>{group.stop ? `Stop ${group.stop.seq} · ${group.stop.place_name}` : 'Other stops'}</Text>
        {group.lines.map(line => <PieceRow key={line.id} line={line} known={index} online={online} warned={noSignal === line.id} onNoSignal={noSignalFor} />)}
      </View>)}
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
