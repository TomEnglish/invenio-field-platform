import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { tokens } from '@/lib/design/tokens';

export default function PrototypeScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      <View style={styles.container}>
        <Header />
        <Section title="Color tokens" caption="Invenio Portal palette: navy ink, Invenio blue, teal accent. Same names work light and dark — this page shows the light column.">
          <ColorGrid />
        </Section>

        <Section title="Typography" caption="Inter across the board. Scale: 12 / 13 / 14 / 16 / 20 / 24 / 32 / 48.">
          <TypeScale />
        </Section>

        <Section title="Buttons" caption="Primary solid; secondary tonal; ghost; danger. 8px radius, weight 600.">
          <ButtonRow />
        </Section>

        <Section title="Stat tiles" caption="Dashboard KPI pattern. Uppercase eyebrow + large number + delta chip.">
          <StatRow />
        </Section>

        <Section title="Cards" caption="White surface, 12px radius, 1px border, subtle shadow, 24px padding.">
          <CardRow />
        </Section>

        <Section title="Table header" caption="13px uppercase eyebrow, weight 700, muted color. Row hover uses bg/raised (web only).">
          <TableDemo />
        </Section>

        <Section title="Tags / chips" caption="Tonal fill + matching text color. 6px radius.">
          <TagRow />
        </Section>

        <Footer />
      </View>
    </ScrollView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.eyebrow}>Design prototype</Text>
        <Text style={styles.h1}>Invenio unified system</Text>
        <Text style={styles.lead}>
          One token set, one type scale, one component vocabulary across the three Kindred / Invenio surfaces.
        </Text>
      </View>
      <View style={styles.headerActions}>
        <PrimaryButton title="Continue to app" onPress={() => router.replace('/')} />
        <GhostButton title="View on GitHub" onPress={() => {}} />
      </View>
    </View>
  );
}

function Section({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.h2}>{title}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      {children}
    </View>
  );
}

function ColorGrid() {
  const groups: { label: string; swatches: { name: string; value: string; onDark?: boolean }[] }[] = [
    {
      label: 'Neutral',
      swatches: [
        { name: 'canvas', value: tokens.color.canvas },
        { name: 'surface', value: tokens.color.surface },
        { name: 'raised', value: tokens.color.raised },
        { name: 'border', value: tokens.color.border },
        { name: 'text / muted', value: tokens.color.textMuted, onDark: true },
        { name: 'text / primary', value: tokens.color.textPrimary, onDark: true },
      ],
    },
    {
      label: 'Brand',
      swatches: [
        { name: 'primary (sky-700)', value: tokens.color.brandPrimary, onDark: true },
        { name: 'accent (cyan-600)', value: tokens.color.brandAccent, onDark: true },
        { name: 'accent soft', value: tokens.color.brandAccentSoft },
      ],
    },
    {
      label: 'Status',
      swatches: [
        { name: 'success', value: tokens.color.success, onDark: true },
        { name: 'warn', value: tokens.color.warn, onDark: true },
        { name: 'danger', value: tokens.color.danger, onDark: true },
        { name: 'info', value: tokens.color.info, onDark: true },
      ],
    },
  ];
  return (
    <View style={{ gap: tokens.space[6] }}>
      {groups.map((g) => (
        <View key={g.label}>
          <Text style={styles.smallLabel}>{g.label}</Text>
          <View style={styles.swatchRow}>
            {g.swatches.map((s) => (
              <View key={s.name} style={styles.swatchCard}>
                <View style={[styles.swatchChip, { backgroundColor: s.value }]}>
                  <Text style={[styles.swatchHex, { color: s.onDark ? tokens.color.textInverse : tokens.color.textPrimary }]}>{s.value}</Text>
                </View>
                <Text style={styles.swatchName}>{s.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function TypeScale() {
  const rows = [
    { style: styles.h1, label: 'H1 / 48 / 800', text: 'Laydown yard, under control.' },
    { style: styles.h2, label: 'H2 / 32 / 700', text: 'Real-time material tracking' },
    { style: styles.h3, label: 'H3 / 20 / 600', text: 'Purchase order detail' },
    { style: styles.body, label: 'Body / 16 / 400', text: 'Scan a QR code to receive, relocate, or issue material. All actions sync when the device is online.' },
    { style: styles.bodySmall, label: 'Small / 14 / 400', text: 'Used for dense table rows and app screens.' },
    { style: styles.eyebrow, label: 'Eyebrow / 13 / 700 / uppercase', text: 'Section label' },
  ];
  return (
    <View style={[styles.surface, { padding: tokens.space[6], gap: tokens.space[4] }]}>
      {rows.map((r) => (
        <View key={r.label} style={styles.typeRow}>
          <Text style={styles.typeLabel}>{r.label}</Text>
          <Text style={r.style}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

function ButtonRow() {
  return (
    <View style={[styles.surface, { padding: tokens.space[6] }]}>
      <View style={styles.buttonRow}>
        <PrimaryButton title="Save changes" onPress={() => {}} />
        <SecondaryButton title="Preview" onPress={() => {}} />
        <GhostButton title="Cancel" onPress={() => {}} />
        <DangerButton title="Delete" onPress={() => {}} />
      </View>
    </View>
  );
}

function PrimaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.btn, styles.btnPrimary]}>
      <Text style={[styles.btnText, { color: tokens.color.textInverse }]}>{title}</Text>
    </TouchableOpacity>
  );
}
function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.btn, styles.btnSecondary]}>
      <Text style={[styles.btnText, { color: tokens.color.brandPrimary }]}>{title}</Text>
    </TouchableOpacity>
  );
}
function GhostButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={[styles.btn, styles.btnGhost]}>
      <Text style={[styles.btnText, { color: tokens.color.textMuted }]}>{title}</Text>
    </TouchableOpacity>
  );
}
function DangerButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.btn, styles.btnDanger]}>
      <Text style={[styles.btnText, { color: tokens.color.textInverse }]}>{title}</Text>
    </TouchableOpacity>
  );
}

function StatRow() {
  const stats = [
    { label: 'Open POs', value: '142', delta: '+8 this week', tone: 'success' as const },
    { label: 'On-site value', value: '$4.8M', delta: '+$320k', tone: 'success' as const },
    { label: 'Exceptions', value: '6', delta: '2 overdue', tone: 'warn' as const },
    { label: 'RTS today', value: '37', delta: '3 pending', tone: 'info' as const },
  ];
  return (
    <View style={styles.statRow}>
      {stats.map((s) => (
        <View key={s.label} style={[styles.surface, styles.statCard]}>
          <Text style={styles.statLabel}>{s.label}</Text>
          <Text style={styles.statValue}>{s.value}</Text>
          <DeltaChip tone={s.tone} text={s.delta} />
        </View>
      ))}
    </View>
  );
}

function DeltaChip({ tone, text }: { tone: 'success' | 'warn' | 'info' | 'danger'; text: string }) {
  const map = {
    success: { bg: tokens.color.successSoft, fg: tokens.color.success },
    warn: { bg: tokens.color.warnSoft, fg: tokens.color.warn },
    info: { bg: tokens.color.infoSoft, fg: tokens.color.info },
    danger: { bg: tokens.color.dangerSoft, fg: tokens.color.danger },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: map.bg, alignSelf: 'flex-start' }]}>
      <Text style={[styles.chipText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

function CardRow() {
  return (
    <View style={styles.cardRow}>
      <View style={[styles.surface, { padding: tokens.space[6], flex: 1, minWidth: 260, gap: tokens.space[3] }]}>
        <Text style={styles.eyebrow}>Greenfield LNG</Text>
        <Text style={styles.h3}>Module MR-402 received</Text>
        <Text style={styles.bodySmall}>Container #884201 · 12 items · QA passed</Text>{/* tokens-lint-ignore: data string */}
        <View style={{ flexDirection: 'row', gap: tokens.space[2] }}>
          <Tag tone="success" text="Delivered" />
          <Tag tone="info" text="RTS" />
        </View>
      </View>
      <View style={[styles.surface, { padding: tokens.space[6], flex: 1, minWidth: 260, gap: tokens.space[3] }]}>
        <Text style={styles.eyebrow}>Action required</Text>
        <Text style={styles.h3}>PO 99214 missing BOL</Text>
        <Text style={styles.bodySmall}>Receiver could not match packing list to purchase order line 17.</Text>
        <View style={{ flexDirection: 'row', gap: tokens.space[2] }}>
          <SecondaryButton title="Open exception" onPress={() => {}} />
        </View>
      </View>
    </View>
  );
}

function TableDemo() {
  const rows = [
    ['PO-99201', 'Pipe spool, 6" SA-106', 'Delivered', 'Apr 18'],
    ['PO-99214', 'Valve, 4" flanged', 'In transit', 'Apr 21'],
    ['PO-99218', 'Structural beam W12x26', 'Not RTS', 'Apr 22'],
    ['PO-99230', 'Cable tray 24"', 'RTS', 'Apr 19'],
  ];
  const toneFor = (s: string): 'success' | 'warn' | 'info' | 'danger' =>
    s === 'Delivered' ? 'success' : s === 'In transit' ? 'info' : s === 'Not RTS' ? 'warn' : 'success';
  return (
    <View style={[styles.surface, { padding: 0, overflow: 'hidden' }]}>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadCell, { flex: 1 }]}>PO</Text>
        <Text style={[styles.tableHeadCell, { flex: 3 }]}>Description</Text>
        <Text style={[styles.tableHeadCell, { flex: 1 }]}>Status</Text>
        <Text style={[styles.tableHeadCell, { flex: 1 }]}>Due</Text>
      </View>
      {rows.map((r, i) => (
        <View key={r[0]} style={[styles.tableRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={[styles.tableCell, { flex: 1, fontWeight: '600' }]}>{r[0]}</Text>
          <Text style={[styles.tableCell, { flex: 3 }]}>{r[1]}</Text>
          <View style={{ flex: 1 }}>
            <Tag tone={toneFor(r[2])} text={r[2]} />
          </View>
          <Text style={[styles.tableCell, { flex: 1, color: tokens.color.textMuted }]}>{r[3]}</Text>
        </View>
      ))}
    </View>
  );
}

function Tag({ tone, text }: { tone: 'success' | 'warn' | 'info' | 'danger'; text: string }) {
  return <DeltaChip tone={tone} text={text} />;
}

function TagRow() {
  return (
    <View style={[styles.surface, { padding: tokens.space[6] }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] }}>
        <Tag tone="success" text="Delivered" />
        <Tag tone="info" text="In transit" />
        <Tag tone="warn" text="Not RTS" />
        <Tag tone="danger" text="Missing BOL" />
        <Tag tone="success" text="QA passed" />
      </View>
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footer}>
      <Text style={styles.caption}>
        Prototype route — not wired into auth. Navigate to <Text style={{ fontFamily: 'SpaceMono' }}>/</Text> to enter the app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  rootContent: { paddingVertical: tokens.space[12] },
  container: { maxWidth: 1120, width: '100%', alignSelf: 'center', paddingHorizontal: tokens.space[6], gap: tokens.space[12] },

  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.space[6],
    paddingBottom: tokens.space[6],
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  headerActions: { flexDirection: 'row', gap: tokens.space[3], flexWrap: 'wrap' },

  section: { gap: tokens.space[4] },
  sectionHead: { gap: tokens.space[1], marginBottom: tokens.space[2] },

  surface: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...(tokens.shadow.sm as object),
  },

  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.color.brandPrimary,
  },
  h1: { fontSize: 48, lineHeight: 56, fontWeight: '800', color: tokens.color.textPrimary, marginTop: tokens.space[1] },
  h2: { fontSize: 32, lineHeight: 40, fontWeight: '700', color: tokens.color.textPrimary },
  h3: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: tokens.color.textPrimary },
  lead: { fontSize: 18, lineHeight: 28, color: tokens.color.textMuted, marginTop: tokens.space[3], maxWidth: 640 },
  body: { fontSize: 16, lineHeight: 24, color: tokens.color.textPrimary },
  bodySmall: { fontSize: 14, lineHeight: 20, color: tokens.color.textMuted },
  caption: { fontSize: 14, lineHeight: 20, color: tokens.color.textMuted, maxWidth: 720 },
  smallLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: tokens.color.textSubtle,
    marginBottom: tokens.space[3],
  },
  typeRow: { gap: tokens.space[1] },
  typeLabel: { fontSize: 12, color: tokens.color.textSubtle, fontFamily: 'SpaceMono' },

  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[3] },
  swatchCard: { width: 160, gap: tokens.space[2] },
  swatchChip: {
    height: 88,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space[3],
    justifyContent: 'flex-end',
  },
  swatchHex: { fontSize: 12, fontFamily: 'SpaceMono', fontWeight: '600' },
  swatchName: { fontSize: 13, color: tokens.color.textMuted },

  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[3], alignItems: 'center' },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: tokens.color.brandPrimary },
  btnSecondary: { backgroundColor: tokens.color.brandPrimarySoft, borderColor: tokens.color.brandPrimary },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: tokens.color.danger },
  btnText: { fontSize: 14, fontWeight: '600' },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[4] },
  statCard: { padding: tokens.space[6], flex: 1, minWidth: 200, gap: tokens.space[2] },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: tokens.color.textMuted,
  },
  statValue: { fontSize: 32, fontWeight: '700', color: tokens.color.textPrimary },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
  },
  chipText: { fontSize: 12, fontWeight: '600' },

  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[4] },

  tableHead: {
    flexDirection: 'row',
    paddingHorizontal: tokens.space[4],
    paddingVertical: tokens.space[3],
    backgroundColor: tokens.color.raised,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  tableHeadCell: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: tokens.color.textMuted,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.space[4],
    paddingVertical: tokens.space[3],
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  tableCell: { fontSize: 14, color: tokens.color.textPrimary },

  footer: { paddingTop: tokens.space[6], borderTopWidth: 1, borderTopColor: tokens.color.border },
});
