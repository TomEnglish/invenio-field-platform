import { ScrollView } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { MaterialWithLocation } from '@/lib/api/materials';

interface EditMaterialModalProps {
  editItem: MaterialWithLocation | null;
  reason: string;
  setReason: (value: string) => void;
  editType: string;
  setEditType: (val: string) => void;
  editSize: string;
  setEditSize: (val: string) => void;
  editGrade: string;
  setEditGrade: (val: string) => void;
  editSpec: string;
  setEditSpec: (val: string) => void;
  editWeight: string;
  setEditWeight: (val: string) => void;
  onSave: () => void;
  saving: boolean;
  onCancel: () => void;
}

export function EditMaterialModal({
  editItem,
  reason, setReason,
  editType,
  setEditType,
  editSize,
  setEditSize,
  editGrade,
  setEditGrade,
  editSpec,
  setEditSpec,
  editWeight,
  setEditWeight,
  onSave,
  saving,
  onCancel,
}: EditMaterialModalProps) {
  return (
    <Modal
      visible={!!editItem}
      onClose={onCancel}
      title="Edit Material"
      maxWidth={520}
      actions={
        <>
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
          <Button title="Save" onPress={onSave} loading={saving} disabled={reason.trim().length < 5} />
        </>
      }
    >
      <ScrollView style={{ maxHeight: 420 }}>
        <Input label="Reason for correction" value={reason} onChangeText={setReason} required />
        <Input label="Material Type" value={editType} onChangeText={setEditType} />
        <Input label="Size" value={editSize} onChangeText={setEditSize} />
        <Input label="Grade" value={editGrade} onChangeText={setEditGrade} />
        <Input label="Spec" value={editSpec} onChangeText={setEditSpec} />
        <Input label="Weight" value={editWeight} onChangeText={setEditWeight} keyboardType="decimal-pad" />
      </ScrollView>
    </Modal>
  );
}
