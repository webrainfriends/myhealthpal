import { useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../theme/theme';
import { searchHealthParameters } from '../api/client';

export default function CanonicalMappingModal({ visible, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    searchHealthParameters('')
      .then((data) => setResults(data.parameters))
      .catch(() => setResults([]));
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      searchHealthParameters(query)
        .then((data) => setResults(data.parameters))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={typography.title}>Map to a known test</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeLabel}>Close</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search (e.g. cholesterol, hemoglobin)"
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        <TouchableOpacity
          style={styles.clearRow}
          onPress={() => {
            onSelect(null);
            onClose();
          }}
        >
          <Text style={styles.clearLabel}>None of these — leave unmapped</Text>
        </TouchableOpacity>
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultRow}
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
            >
              <Text style={typography.body}>{item.display_name}</Text>
              <Text style={typography.caption}>
                {item.category} · {item.canonical_unit || item.data_type}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={[typography.bodySecondary, styles.empty]}>No matches.</Text>}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  closeLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    fontSize: 15,
  },
  clearRow: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  clearLabel: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  resultRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
