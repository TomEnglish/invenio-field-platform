import { ScrollView, View, Text, Image, StyleSheet } from 'react-native';
import { Button } from '@/components/ui/Button';
import { useReceivingStore } from '@/stores/receivingStore';
import { receivingReviewIssue } from '@/lib/utils/receivingReview';
import { CONDITIONS, DECISIONS, EXCEPTION_TYPES, PHOTO_TYPES, RECEIVING_STEPS, labelOf } from '@/lib/utils/receivingLabels';
import type { PhotoType } from '@/types/database';
import { colors } from '@/lib/design/tokens';

// "Review material details", but "Review PO / delivery".
const inSentence = (title: string) => (/^[A-Z]{2}/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1));

interface Props { onEdit: (step: number) => void; onSubmit: () => void; submitting: boolean; error?: string; }
// Each section is named, and each choice worded, as on its step.
export function ReceivingReviewStep({ onEdit, onSubmit, submitting, error }: Props) {
  const draft = useReceivingStore();
  const issue = receivingReviewIssue(draft);
  const decision = draft.decision;
  const accepted = decision.status === 'accepted' ? draft.material.qty : decision.status === 'rejected' ? 0 : decision.accepted_qty;
  const exception = labelOf(EXCEPTION_TYPES, decision.exception_type) ?? decision.exception_type;
  const photoType = (type: PhotoType) => labelOf(PHOTO_TYPES, type) ?? type;
  const sections = [
    { title: RECEIVING_STEPS[0], rows: [['Material', draft.material.material_type], ['Delivered quantity', draft.material.qty], ['Size / grade', [draft.material.size,draft.material.grade].filter(Boolean).join(' · ')], ['Weight (lbs)', draft.material.weight], ['Description', draft.material.description], ['Specification', draft.material.spec]] },
    { title: RECEIVING_STEPS[1], rows: [['Purchase order', draft.po.po_number], ['Vendor', draft.po.vendor], ['Delivery ticket', draft.po.delivery_ticket], ['Carrier', draft.po.carrier]] },
    { title: RECEIVING_STEPS[2], rows: [['Attached photos', draft.photos.length]] },
    { title: RECEIVING_STEPS[3], rows: [['Condition', labelOf(CONDITIONS, draft.inspection.condition) ?? draft.inspection.condition], ['Inspection', draft.inspection.inspection_pass ? 'Passed' : 'Failed'], ['Notes', draft.inspection.damage_notes]] },
    { title: RECEIVING_STEPS[4], rows: [['Decision', labelOf(DECISIONS, decision.status)], ['Accepted quantity', accepted], ['Exception', decision.has_exception ? (decision.exception_type ? exception : 'Flagged; type not specified') : 'None']] },
    { title: RECEIVING_STEPS[5], rows: [['Location', draft.locationLabel || (draft.location.location_id ? 'Previously selected yard location' : 'Not selected')]] },
  ];
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title} accessibilityRole="header">{RECEIVING_STEPS[6]}</Text>
    <Text style={styles.hint}>Check the details below. Submitting saves this receipt for upload, including its photos.</Text>
    {sections.map((section, step) => <View key={section.title} style={styles.section}>
      <View style={styles.heading}><Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text><Button title="Edit" accessibilityLabel={`Edit ${section.title}`} variant="ghost" onPress={() => onEdit(step)} disabled={submitting} /></View>
      {section.rows.filter(([, value], index) => index === 0 || (value !== undefined && value !== '')).map(([label, value]) => <View key={String(label)} style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value === undefined || value === '' ? 'Not recorded' : value}</Text></View>)}
      {step === 2 && draft.photos.length > 0 && <ScrollView horizontal contentContainerStyle={styles.photos}>{draft.photos.map((photo,index) => <View key={`${photo.uri}-${index}`}><Image source={{uri:photo.uri}} style={styles.photo} accessibilityLabel={`${photoType(photo.photo_type)} photo ${index+1}`} /><Text style={styles.label}>{photoType(photo.photo_type)}</Text></View>)}</ScrollView>}
    </View>)}
    {issue && <View style={styles.issue}><Text accessibilityRole="alert" style={styles.error}>{issue.message}</Text><Button title={`Review ${inSentence(sections[issue.step].title)}`} onPress={() => onEdit(issue.step)} variant="secondary" disabled={submitting} /></View>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button title="Submit receiving" onPress={onSubmit} loading={submitting} disabled={!!issue} />
    <Button title="Back to location" onPress={() => onEdit(5)} variant="secondary" disabled={submitting} />
  </ScrollView>;
}
const styles = StyleSheet.create({
  content:{padding:20,gap:16,paddingBottom:40}, title:{fontSize:22,fontWeight:'600',color:colors.textPrimary}, hint:{fontSize:14,color:colors.textMuted,lineHeight:20},
  section:{padding:16,gap:8,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:colors.surface}, heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8}, sectionTitle:{fontSize:16,fontWeight:'600',color:colors.textPrimary,flexShrink:1},
  row:{gap:2}, label:{fontSize:12,color:colors.textMuted}, value:{fontSize:15,color:colors.textPrimary}, photos:{gap:12},photo:{width:120,height:120,borderRadius:4}, issue:{gap:12},error:{color:colors.danger,fontSize:14},
});
