import { useAuthStore } from '@/stores/authStore';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from 'react-native';
import { Modal } from './Modal';
import { colors, radius, space, fontSize, fontWeight } from '@/lib/design/tokens';

export function ProjectSelector() {
  const { activeProject, availableProjects, setActiveProject } = useAuthStore();
  const [modalVisible, setModalVisible] = useState(false);

  if (!activeProject || availableProjects.length <= 1) {
    return (
      <View style={styles.singleProjectContainer}>
        <Text style={styles.singleProjectText}>{activeProject?.name}</Text>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={styles.selectorButton}
        accessibilityRole="button"
        accessibilityLabel={`Project: ${activeProject.name}. Tap to change.`}
      >
        <Text style={styles.selectorText}>{activeProject.name}</Text>
        <FontAwesome name="caret-down" size={16} color={colors.brandPrimary} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title="Select project"
        accessibilityLabel="Project selector"
      >
        <FlatList
          data={availableProjects}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isActive = item.id === activeProject.id;
            return (
              <TouchableOpacity
                style={[styles.projectItem, isActive && styles.projectItemActive]}
                onPress={() => {
                  void setActiveProject(item.id).catch(error => Alert.alert('Project not changed', error.message));
                  setModalVisible(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[styles.projectItemText, isActive && styles.projectItemTextActive]}
                >
                  {item.name}
                </Text>
                {isActive ? (
                  <FontAwesome name="check" size={16} color={colors.brandPrimary} />
                ) : null}
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          style={{ maxHeight: 320 }}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  singleProjectContainer: {
    paddingHorizontal: space[3],
    marginRight: space[2],
  },
  singleProjectText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    fontWeight: fontWeight.medium as TextStyle['fontWeight'],
  },
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    paddingHorizontal: space[3],
    paddingVertical: space[2] - 2,
    backgroundColor: colors.brandPrimarySoft,
    borderRadius: radius.pill,
    marginRight: space[2],
  },
  selectorText: {
    fontSize: fontSize.body,
    color: colors.brandPrimary,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  projectItemActive: { backgroundColor: colors.brandPrimarySoft },
  projectItemText: {
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  projectItemTextActive: {
    color: colors.brandPrimary,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
  },
  separator: { height: 1, backgroundColor: colors.raised },
});
