import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Image, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { useLoadReference } from '@/components/logistics/useLoadReference';
import { loadStyles as styles } from '@/components/logistics/loadStyles';
import { useCheckInStore } from '@/stores/checkInStore';
import { useAuthStore } from '@/stores/authStore';
import { addToQueue } from '@/lib/sync/offlineQueue';
import { processQueue } from '@/lib/sync/syncManager';
import { useNetworkStore } from '@/lib/sync/networkStore';
import { persistPhoto } from '@/lib/utils/persistPhoto';
import { deleteLicencePhotos, LICENCE_PHOTO_DIRECTORY } from '@/lib/api/licence';
import { rememberLicence } from '@/lib/sync/licenceMemory';
import { loadOf } from '@/lib/sync/queuePresentation';
import { capturedNow, licenceOnFile, CHECK_IN_STEPS, checkInIssue, checkInPayloads, COMPANY_ROLES, isoDate, loadLabel } from '@/lib/logistics/loads';
import { radius } from '@/lib/design/tokens';

const parseDate = (text: string) => { const [y, m, d] = text.split('-').map(Number); return text ? new Date(y, m - 1, d) : null; };
const REVIEW = CHECK_IN_STEPS.length - 1;

// Driver check-in: driver, companies, licence, review. The driver and
// companies are one queued load_save; the licence is its own queued item.
// The licence number is shown only while typed: never saved in the draft,
// shown back, or listed anywhere; "Licence on file" is all anyone sees after.
export function CheckInScreenContent() {
  const { id = '' } = useLocalSearchParams<{ id?: string }>();
  const { user, activeProject } = useAuthStore();
  // Fresh when online, so the details shown (and compared) are the office's latest.
  const { loads } = useLoadReference({ refresh: true });
  const load = loads.loads.get(id);
  const draft = useCheckInStore();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const capturing = useRef(false);
  // Complete on file (number and photo), or waiting to upload: then entering it again is optional.
  const onFile = licenceOnFile(load) || !!load?.licence_waiting;
  // The screen stays mounted between visits: each visit starts on the form.
  useFocusEffect(useCallback(() => () => { setSaved(false); setError(''); }, []));

  // A check-in belongs to one load: another load starts from what it has.
  useEffect(() => {
    if (!id || draft.loadId === id || !load) return;
    void deleteLicencePhotos({ photos: [draft.front, draft.back].filter((uri): uri is string => !!uri).map(uri => ({ uri })) });
    draft.begin(id, {
      driverName: load.driver_name ?? '', driverPhone: load.driver_phone ?? '',
      companies: (loads.companies.get(id) ?? []).sort((a, b) => a.position - b.position).map(c => ({ name: c.name, role: c.role, contactName: c.contact_name ?? '', phone: c.phone ?? '' })),
    });
  }, [id, load?.id]);

  const step = Math.max(0, Math.min(draft.step, REVIEW));
  const go = (next: number) => {
    const issue = next > step ? checkInIssue(draft, true) : null;
    // Moving on checks only the steps already passed.
    if (issue && issue.step < next && issue.step <= step) { setError(issue.message); return; }
    setError(''); draft.setStep(next);
  };

  const capture = async (side: 'front' | 'back', camera: boolean) => {
    if (capturing.current) return;
    capturing.current = true; setError('');
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Allow camera access in device Settings, or choose a photo from the library.');
      }
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
      if (result.canceled || !result.assets[0]) return;
      // Kept apart, and no other copy left behind.
      const uri = await persistPhoto(result.assets[0].uri, { directory: LICENCE_PHOTO_DIRECTORY, temporary: true, discardSources: true });
      const old = useCheckInStore.getState()[side];
      if (useCheckInStore.getState().loadId !== id) { await deleteLicencePhotos({ photos: [{ uri }] }); return; }
      useCheckInStore.getState().set({ [side]: uri });
      if (old) await deleteLicencePhotos({ photos: [{ uri: old }] });
    } catch (e: any) { setError(e?.message || 'Photo not saved. Please try again.'); }
    finally { capturing.current = false; }
  };
  const removePhoto = async (side: 'front' | 'back') => {
    const old = useCheckInStore.getState()[side];
    useCheckInStore.getState().set({ [side]: null });
    if (old) await deleteLicencePhotos({ photos: [{ uri: old }] });
  };

  const save = async () => {
    if (saving || !user || !activeProject) return;
    const current = useCheckInStore.getState();
    const issue = checkInIssue(current, onFile);
    if (issue) { setError(issue.message); draft.setStep(issue.step); return; }
    setSaving(true); setError('');
    try {
      const capturedAt = current.capturedAt ?? capturedNow();
      if (!current.capturedAt) current.markCaptured(capturedAt);
      const { save: op, licence } = checkInPayloads(id, loadLabel(load), current, current.start ?? undefined, capturedAt);
      if (!op && !licence) { setError('Nothing has changed.'); return; }
      if (op) await addToQueue({ type: 'load_save', payload: { op, label: loadLabel(load) } }, current.saveId);
      if (licence) {
        // The number stays in memory; the queued item goes ahead of the load's departure, which needs it.
        rememberLicence(current.licenceId, licence.details);
        await addToQueue({ type: 'licence', payload: licence.payload }, current.licenceId, item => item.action.type === 'load_depart' && loadOf(item) === id);
      }
      // The number leaves the draft; the photo files now belong to the queued licence.
      useCheckInStore.getState().reset();
      setSaved(true);
      if (useNetworkStore.getState().isOnline) void processQueue().catch(() => {});
    } catch (e: any) { setError(`Could not save: ${e.message ?? 'Please try again'}. The check-in is still here.`); }
    finally { setSaving(false); }
  };
  const discard = async () => {
    await deleteLicencePhotos({ photos: [draft.front, draft.back].filter((uri): uri is string => !!uri).map(uri => ({ uri })) });
    useCheckInStore.getState().reset();
    router.back();
  };

  if (saved) return <ScrollView contentContainerStyle={[styles.content, { justifyContent: 'center' }]}>
    <Stack.Screen options={{ headerShown: true, title: 'Checked in' }} />
    <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">Driver checked in</Text>
    <Text style={styles.muted}>Saved on this device. It uploads when online; Sync shows anything waiting. The licence shows only as “Licence on file”.</Text>
    <Button title="Back to the load" onPress={() => router.back()} />
  </ScrollView>;

  const photo = (side: 'front' | 'back', label: string) => <View style={styles.card}>
    <Text style={styles.rowTitle}>{label}</Text>
    {draft[side] ? <Image source={{ uri: draft[side]! }} style={local.photo} accessibilityLabel={`${label} taken`} /> : null}
    <View style={styles.chips}>
      <Button title={draft[side] ? 'Retake' : 'Take photo'} onPress={() => capture(side, true)} style={styles.chip} />
      <Button title="Choose photo" variant="secondary" onPress={() => capture(side, false)} style={styles.chip} />
      {draft[side] ? <Button title="Remove" variant="ghost" onPress={() => removePhoto(side)} style={styles.chip} /> : null}
    </View>
  </View>;

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <Stack.Screen options={{ headerShown: true, title: `Check in · ${loadLabel(load)}` }} />
    <View style={styles.progress}>
      <Text style={styles.heading} accessibilityRole="header">Step {step + 1} of {CHECK_IN_STEPS.length} · {CHECK_IN_STEPS[step]}</Text>
      <View style={styles.stepBar} accessibilityRole="progressbar" accessibilityLabel="Check-in progress" accessibilityValue={{ min: 1, max: CHECK_IN_STEPS.length, now: step + 1, text: CHECK_IN_STEPS[step] }}>
        {CHECK_IN_STEPS.map((title, i) => <View key={title} style={[styles.stepSegment, i <= step && styles.stepActive]} />)}
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {step === 0 ? <>
        <Input label="Driver’s name" required value={draft.driverName} onChangeText={text => draft.set({ driverName: text })} maxLength={120} autoComplete="off" />
        <Input label="Driver’s phone" value={draft.driverPhone} onChangeText={text => draft.set({ driverPhone: text })} maxLength={40} keyboardType="phone-pad" autoComplete="off" />
      </> : null}

      {step === 1 ? <>
        <Text style={styles.muted}>Up to 3 companies, from the one we hired to the one whose truck it is.</Text>
        {draft.companies.map((company, index) => <View key={index} style={styles.card}>
          <Input label={`Company ${index + 1}`} required value={company.name} onChangeText={text => draft.setCompany(index, { ...company, name: text })} maxLength={120} />
          <View style={styles.chips}>
            {COMPANY_ROLES.map(role => <Button key={role.value} title={role.label} variant={company.role === role.value ? 'primary' : 'secondary'} style={styles.chip}
              accessibilityLabel={company.role === role.value ? `${role.label}, chosen` : `Company ${index + 1} is the ${role.label.toLowerCase()}`}
              onPress={() => draft.setCompany(index, { ...company, role: role.value })} />)}
          </View>
          <Input label="Contact" value={company.contactName} onChangeText={text => draft.setCompany(index, { ...company, contactName: text })} maxLength={120} />
          <Input label="Phone" value={company.phone} onChangeText={text => draft.setCompany(index, { ...company, phone: text })} maxLength={40} keyboardType="phone-pad" />
          <Button title="Remove company" variant="ghost" onPress={() => draft.removeCompany(index)} />
        </View>)}
        {draft.companies.length < 3 ? <Button title="Add company" variant="secondary" onPress={draft.addCompany} /> : null}
      </> : null}

      {step === 2 ? <>
        {onFile ? <Text style={styles.text}>Licence on file. Enter it again only to correct it.</Text> : null}
        {!onFile && load?.licence_recorded_at ? <Text style={styles.warning}>The licence on file is incomplete: the number or the photo of it is missing. Enter it again, with a photo of the front.</Text> : null}
        {/* Typed only: no autofill, no suggestions, never shown again. */}
        <Input label="Licence number" required={!onFile} value={draft.licenceNumber} onChangeText={text => draft.set({ licenceNumber: text })} maxLength={40}
          autoCapitalize="characters" autoCorrect={false} autoComplete="off" importantForAutofill="no" textContentType="none" spellCheck={false} />
        <Input label="Issuing state" value={draft.licenceState} onChangeText={text => draft.set({ licenceState: text })} maxLength={40} />
        <DatePicker label="Expiry" value={parseDate(draft.licenceExpiry)} onChange={date => draft.set({ licenceExpiry: date ? isoDate(date) : '' })} placeholder="Not entered" />
        {photo('front', 'Front of the licence')}
        {photo('back', 'Back of the licence (optional)')}
      </> : null}

      {step === REVIEW ? <>
        <View style={styles.card}>
          <Text style={styles.heading}>Driver</Text>
          <Text style={styles.text}>{draft.driverName || 'Not entered'}{draft.driverPhone ? ` · ${draft.driverPhone}` : ''}</Text>
          <Button title="Edit driver" variant="ghost" onPress={() => draft.setStep(0)} />
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Companies</Text>
          {draft.companies.length === 0 ? <Text style={styles.muted}>None</Text> : null}
          {draft.companies.map((company, index) => <Text key={index} style={styles.text}>{company.name || 'No name'} · {COMPANY_ROLES.find(r => r.value === company.role)?.label}</Text>)}
          <Button title="Edit companies" variant="ghost" onPress={() => draft.setStep(1)} />
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Licence</Text>
          <Text style={styles.text}>{draft.licenceNumber.trim() ? `Number entered · ${[draft.front, draft.back].filter(Boolean).length} photo${[draft.front, draft.back].filter(Boolean).length === 1 ? '' : 's'}` : onFile ? 'Licence on file' : 'Not entered'}</Text>
          <Button title="Edit licence" variant="ghost" onPress={() => draft.setStep(2)} />
        </View>
      </> : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.pair}>
        <Button title="Back" variant="secondary" onPress={() => (step === 0 ? router.back() : go(step - 1))} style={styles.flex} disabled={saving} />
        {step === REVIEW ? <Button title="Save check-in" onPress={save} loading={saving} style={styles.flex} />
          : <Button title={`Next: ${CHECK_IN_STEPS[step + 1].toLowerCase()}`} onPress={() => go(step + 1)} style={styles.flex} />}
      </View>
      <Button title="Discard check-in" variant="ghost" onPress={discard} disabled={saving} />
    </ScrollView>
  </KeyboardAvoidingView>;
}

const local = StyleSheet.create({ photo: { width: '100%', height: 180, borderRadius: radius.md, resizeMode: 'contain' } });
