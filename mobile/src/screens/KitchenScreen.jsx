import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { addKitchenItem, deleteKitchenItem, fetchKitchenItems } from '../api/client';
import { showAlert } from '../utils/alert';

// Kept in sync with the CHECK constraint in migration 025_kitchen_items.sql -
// validated client-side too so a bad value never round-trips as a 400.
const CATEGORY_OPTIONS = [
  { value: 'vegetable', label: 'Vegetable' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'grain', label: 'Grain' },
  { value: 'legume', label: 'Legume' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'protein', label: 'Protein' },
  { value: 'spice', label: 'Spice' },
  { value: 'condiment', label: 'Condiment' },
  { value: 'other', label: 'Other' },
];

// The mini kitchen (pantry): items the person selects here feed into an
// AI-generated diet schedule constrained to what they actually have on hand
// (see scheduleGenerationService.js server-side). Selecting items for that
// is a distinct mode from ordinary browsing/editing, entered with the
// "Select for a schedule" toggle below.
export default function KitchenScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('vegetable');
  const [adding, setAdding] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const load = useCallback(async (category_) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKitchenItems({ category: category_ });
      setItems(data.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(categoryFilter);
  }, [categoryFilter, load]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => load(categoryFilter));
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  async function handleAdd() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await addKitchenItem({ name: name.trim(), category });
      setName('');
      await load(categoryFilter);
    } catch (err) {
      showAlert('Could not add item', err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(item) {
    try {
      await deleteKitchenItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setSelectedIds((prev) => prev.filter((id) => id !== item.id));
    } catch (err) {
      showAlert('Could not remove item', err.message);
    }
  }

  function toggleSelected(itemId) {
    setSelectedIds((prev) => (prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]));
  }

  function handleGeneratePress() {
    navigation.navigate('DietScheduleForm', { initialMode: 'kitchen', kitchenItemIds: selectedIds });
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Mini kitchen</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>
          Keep a list of what's on hand, then build a diet schedule around it.
        </Text>

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Add an ingredient (e.g. Onion)"
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={setName}
            onSubmitEditing={handleAdd}
          />
        </View>
        <ChipSelect
          label="Category for new item"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(v) => setCategory(v || 'other')}
          allowClear={false}
        />
        <PrimaryButton title="Add to kitchen" onPress={handleAdd} loading={adding} disabled={!name.trim() || adding} />

        <ChipSelect label="Filter by category" options={CATEGORY_OPTIONS} value={categoryFilter} onChange={setCategoryFilter} />

        <TouchableOpacity
          onPress={() => {
            setSelectionMode((v) => !v);
            setSelectedIds([]);
          }}
        >
          <Text style={styles.toggleSelection}>
            {selectionMode ? 'Cancel selection' : 'Select items for a diet schedule →'}
          </Text>
        </TouchableOpacity>

        {loading && <ActivityIndicator style={styles.status} color={colors.primary} />}
        {!loading && error && <Text style={[typography.bodySecondary, styles.status]}>{error}</Text>}
        {!loading && !error && items.length === 0 && (
          <Text style={[typography.bodySecondary, styles.status]}>Your kitchen is empty - add what you have on hand above.</Text>
        )}

        {items.map((item) => {
          const selected = selectedIds.includes(item.id);
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.itemRow, cardShadow, selected && styles.itemRowSelected]}
              onPress={() => (selectionMode ? toggleSelected(item.id) : null)}
              activeOpacity={selectionMode ? 0.7 : 1}
            >
              {selectionMode && (
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </View>
              )}
              <View style={styles.itemText}>
                <Text style={typography.body}>{item.name}</Text>
                <Text style={typography.caption}>
                  {CATEGORY_OPTIONS.find((c) => c.value === item.category)?.label || item.category}
                  {item.quantity_amount != null ? ` · ${item.quantity_amount}${item.quantity_unit ? ` ${item.quantity_unit}` : ''}` : ''}
                </Text>
              </View>
              {!selectionMode && (
                <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.removeLabel}>Remove</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {selectionMode && (
        <View style={[styles.bottomBar, cardShadow]}>
          <PrimaryButton
            title={selectedIds.length > 0 ? `Generate schedule from ${selectedIds.length} items` : 'Select at least one item'}
            onPress={handleGeneratePress}
            disabled={selectedIds.length === 0}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  subtitle: {
    marginTop: -spacing.sm,
  },
  addRow: {
    flexDirection: 'row',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  toggleSelection: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  status: {
    textAlign: 'center',
    marginTop: spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  itemRowSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
  },
  checkmark: {
    color: colors.onBrand,
    fontSize: 13,
    fontWeight: '800',
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  removeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
  },
  bottomBar: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
});
