import { useRef, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Modal, Platform, AccessibilityInfo } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createRepeatFilter } from './repeatFilter';
import { colors, radius, space, fontSize, fontWeight } from '@/lib/design/tokens';

// What a continuous scan did, shown over the camera: a tick for one taken.
export interface ScanFeedback { tone: 'ok' | 'warn' | 'info'; message: string }

interface QRScannerProps {
  onScan: (code: string) => void | Promise<ScanFeedback | void | null>;
  // Keep the camera live scan after scan (packing). A code is ignored until it
  // has been out of view for about 2 s; manual entry is never ignored.
  continuous?: boolean;
  // The running count shown in continuous mode, e.g. "12 in HU-ABC123".
  countLabel?: string;
  // Extra buttons under the camera.
  actions?: ReactNode;
}

export function QRScanner({ onScan, continuous = false, countLabel, actions }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const fresh = useRef(createRepeatFilter()).current;
  const latest = useRef(0);

  // Only the most recent scan's result is shown.
  const deliver = async (code: string) => {
    const id = ++latest.current;
    const result = await Promise.resolve(onScan(code)).catch((): ScanFeedback => ({ tone: 'warn', message: 'That scan could not be checked. Try again.' }));
    if (!continuous || !result || id !== latest.current) return;
    setFeedback(result);
    // VoiceOver has no live regions; TalkBack reads the banner below. No
    // vibration: the installed Android build doesn't hold that permission.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(result.message);
  };

  const submitManual = () => {
    if (manualCode.trim()) {
      void deliver(manualCode.trim());
      setManualCode('');
      setShowManual(false);
    }
  };
  const manualModal = (
    <ManualEntryModal
      visible={showManual}
      code={manualCode}
      onChangeCode={setManualCode}
      onSubmit={submitManual}
      onClose={() => setShowManual(false)}
    />
  );
  const banner = continuous && (countLabel || feedback) ? (
    <View style={styles.feedback}>
      {countLabel ? <Text style={styles.count} accessibilityRole="header">{countLabel}</Text> : null}
      {feedback ? (
        <View style={[styles.result, feedback.tone === 'ok' ? styles.ok : feedback.tone === 'warn' ? styles.warn : styles.info]}>
          <FontAwesome name={feedback.tone === 'ok' ? 'check-circle' : feedback.tone === 'warn' ? 'exclamation-triangle' : 'info-circle'} size={18} color={feedback.tone === 'ok' ? colors.success : feedback.tone === 'warn' ? colors.warnDeep : colors.brandPrimary} />
          <Text style={styles.resultText} accessibilityLiveRegion="polite">{feedback.message}</Text>
        </View>
      ) : null}
    </View>
  ) : null;

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Loading camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Camera access is needed to scan QR codes</Text>
        <Button title="Grant Permission" onPress={requestPermission} style={{ marginTop: 16 }} />
        <Button
          title="Enter Code Manually"
          variant="secondary"
          onPress={() => setShowManual(true)}
          style={{ marginTop: 12 }}
        />
        {banner}
        {actions}
        {manualModal}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={
          continuous
            ? ({ data }) => { if (fresh(data)) void deliver(data.trim()); }
            : scanned
              ? undefined
              : ({ data }) => {
                  setScanned(true);
                  onScan(data);
                }
        }
      >
        <View style={styles.overlay}>
          <View style={styles.scanArea} />
        </View>
      </CameraView>

      {banner}
      <View style={styles.controls}>
        {scanned && !continuous && (
          <Button title="Scan Again" onPress={() => setScanned(false)} style={{ marginBottom: 8 }} />
        )}
        <Button
          title="Enter Code Manually"
          variant="secondary"
          onPress={() => setShowManual(true)}
        />
        {actions}
      </View>

      {manualModal}
    </View>
  );
}

function ManualEntryModal({
  visible,
  code,
  onChangeCode,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  code: string;
  onChangeCode: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Enter QR Code</Text>
          <Input
            label="Code Value"
            value={code}
            onChangeText={onChangeCode}
            placeholder="Type or paste QR code value"
            autoFocus
          />
          <Button title="Submit" onPress={onSubmit} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={onClose}
            style={{ marginTop: 8 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.canvas,
  },
  message: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scanArea: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: colors.textInverse,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  controls: {
    padding: 16,
    gap: 8,
    backgroundColor: colors.surface,
  },
  feedback: { paddingHorizontal: space[4], paddingTop: space[3], gap: space[2], backgroundColor: colors.surface, alignSelf: 'stretch' },
  count: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  result: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.md },
  ok: { backgroundColor: colors.successSoft },
  warn: { backgroundColor: colors.warnSoft },
  info: { backgroundColor: colors.brandPrimarySoft },
  resultText: { flex: 1, fontSize: fontSize.body, color: colors.textPrimary, lineHeight: 20 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 16,
  },
});
