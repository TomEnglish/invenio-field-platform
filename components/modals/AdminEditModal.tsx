import { newOperationId } from '@/lib/utils/operationId';
import { useState, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type TextStyle } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { colors, radius, space, fontSize, fontWeight } from '@/lib/design/tokens';

export interface ColumnConfig {
  key: string;
  label: string;
  editable: boolean;
  type: 'text' | 'number' | 'boolean' | 'enum' | 'date';
  options?: string[];
}

interface AdminEditModalProps {
  visible: boolean;
  tableName: string;
  columns: ColumnConfig[];
  record: Record<string, any> | null;
  isNew: boolean;
  onSave: (changes: Record<string, any>) => void;
  onDelete?: () => void;
  onCancel: () => void;
  saving: boolean;
  canDelete: boolean;
  correction?: boolean;
}

export function AdminEditModal({
  visible,
  tableName,
  columns,
  record,
  isNew,
  onSave,
  onDelete,
  onCancel,
  saving,
  canDelete,
  correction = false,
}: AdminEditModalProps) {
  const [reason, setReason] = useState('');
  const [operationId, setOperationId] = useState(newOperationId());
  const [formData, setFormData] = useState<Record<string, any>>({});

  useEffect(() => {
    setReason(''); setOperationId(newOperationId());
    if (record) {
      setFormData({ ...record });
    } else if (isNew) {
      const blank: Record<string, any> = {};
      columns.forEach((col) => {
        if (col.type === 'boolean') blank[col.key] = false;
        else blank[col.key] = '';
      });
      setFormData(blank);
    }
  }, [record, isNew]);

  const setValue = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const changes: Record<string, any> = {};
    columns.forEach((col) => {
      if (!col.editable) return;
      const val = formData[col.key];
      if (col.type === 'number') {
        changes[col.key] = val === '' || val === null || val === undefined ? null : Number(val);
      } else if (col.type === 'boolean') {
        changes[col.key] = !!val;
      } else {
        changes[col.key] = val === '' ? null : val;
      }
    });
    if (correction) { changes._reason = reason; changes._operationId = operationId; }
    onSave(changes);
  };

  const renderField = (col: ColumnConfig) => {
    const value = formData[col.key];
    const disabled = !col.editable && !isNew;

    if (col.type === 'enum' && col.options) {
      return (
        <View key={col.key} style={styles.fieldContainer}>
          <Text style={styles.fieldLabel}>{col.label}</Text>
          <View style={styles.enumRow}>
            {col.options.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.enumButton,
                  value === opt && styles.enumButtonActive,
                  disabled && styles.enumButtonDisabled,
                ]}
                onPress={() => !disabled && setValue(col.key, opt)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected: value === opt, disabled }}
              >
                <Text
                  style={[
                    styles.enumText,
                    value === opt && styles.enumTextActive,
                  ]}
                >
                  {opt.replaceAll('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    if (col.type === 'boolean') {
      return (
        <View key={col.key} style={styles.fieldContainer}>
          <Text style={styles.fieldLabel}>{col.label}</Text>
          <View style={styles.enumRow}>
            <TouchableOpacity
              style={[
                styles.enumButton,
                value === true && styles.enumButtonActive,
                disabled && styles.enumButtonDisabled,
              ]}
              onPress={() => !disabled && setValue(col.key, true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: value === true, disabled }}
            >
              <Text style={[styles.enumText, value === true && styles.enumTextActive]}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.enumButton,
                value === false && styles.enumButtonActive,
                disabled && styles.enumButtonDisabled,
              ]}
              onPress={() => !disabled && setValue(col.key, false)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: value === false, disabled }}
            >
              <Text style={[styles.enumText, value === false && styles.enumTextActive]}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <Input
        key={col.key}
        label={col.label}
        value={value != null ? String(value) : ''}
        onChangeText={(text) => setValue(col.key, text)}
        editable={!disabled}
        keyboardType={col.type === 'number' ? 'numeric' : 'default'}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      onClose={onCancel}
      title={isNew ? `New ${tableName}` : `Edit ${tableName}`}
      maxWidth={560}
      actions={
        <>
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
          {canDelete && !isNew && onDelete ? (
            <Button title="Delete" variant="danger" onPress={onDelete} />
          ) : null}
          {columns.some(c => c.editable) && <Button title={isNew ? 'Create' : 'Save'} onPress={handleSave} loading={saving} disabled={correction && reason.trim().length < 5} />}
        </>
      }
    >
      <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator>
        {columns.map(renderField)}
        {correction && <Input label="Reason for correction" value={reason} onChangeText={setReason} required />}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fieldContainer: { marginBottom: space[4] },
  fieldLabel: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    color: colors.textPrimary,
    marginBottom: space[1] + 2,
  } as TextStyle,
  enumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  enumButton: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.sm,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: 36,
    justifyContent: 'center',
  },
  enumButtonActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  enumButtonDisabled: { opacity: 0.5 },
  enumText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
    color: colors.textPrimary,
  } as TextStyle,
  enumTextActive: { color: colors.textInverse },
});
