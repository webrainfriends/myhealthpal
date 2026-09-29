import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, mealTypeColors, radii, spacing, typography } from '../theme/theme';
import PrimaryButton from './PrimaryButton';
import RecipeReactionRow from './RecipeReactionRow';

const RECIPE_STATUS_LABELS = {
  pending: '⏳ Recipe queued',
  generating: '✨ Generating recipe…',
  generated: null, // shown via the expandable recipe details instead
  failed: '⚠️ Recipe generation failed',
};

// One meal slot within a diet schedule's day - mirrors FoodEntryCard.jsx's
// layout (name + meal-type pill on top, a status/badge row below) with the
// addition of an expandable recipe (same pattern RecipesScreen.jsx uses for
// its own cards) and a reaction row, since every schedule entry is expected
// to end up with a full generated recipe (requirement 4).
export default function DietScheduleEntryCard({
  entry,
  expanded,
  onToggleExpand,
  onSaveDishName,
  onLog,
  onRetry,
  reaction,
  onReactionChange,
  logging,
  retrying,
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(entry.dishName);
  const mealPalette = mealTypeColors[entry.mealType] || { fg: colors.textSecondary, bg: colors.surfaceMuted };

  function startEditing() {
    setDraftName(entry.dishName);
    setEditing(true);
  }

  function saveEditing() {
    const trimmed = draftName.trim();
    setEditing(false);
    if (trimmed && trimmed !== entry.dishName) onSaveDishName(trimmed);
  }

  return (
    <View style={[styles.card, cardShadow]}>
      <View style={styles.topRow}>
        {editing ? (
          <TextInput
            style={[typography.heading, styles.nameInput]}
            value={draftName}
            onChangeText={setDraftName}
            onSubmitEditing={saveEditing}
            onBlur={saveEditing}
            autoFocus
          />
        ) : (
          <TouchableOpacity style={styles.nameTouchable} onPress={startEditing}>
            <Text style={typography.heading} numberOfLines={2}>{entry.dishName}</Text>
          </TouchableOpacity>
        )}
        <View style={[styles.mealPill, { backgroundColor: mealPalette.bg }]}>
          <Text style={[styles.mealPillText, { color: mealPalette.fg }]}>{entry.mealType}</Text>
        </View>
      </View>

      {entry.needsReview && <Text style={styles.reviewNote}>Imported text: "{entry.rawImportText || entry.dishName}" - check this is right.</Text>}

      {RECIPE_STATUS_LABELS[entry.recipeStatus] && (
        <View style={styles.statusRow}>
          {entry.recipeStatus === 'generating' && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={typography.bodySecondary}>{RECIPE_STATUS_LABELS[entry.recipeStatus]}</Text>
        </View>
      )}

      {entry.recipeStatus === 'failed' && (
        <PrimaryButton title="Retry recipe" variant="secondary" onPress={onRetry} loading={retrying} />
      )}

      {entry.recipe && (
        <>
          <TouchableOpacity onPress={onToggleExpand}>
            <Text style={styles.expandHint}>{expanded ? 'Hide recipe ▴' : 'View recipe ▾'}</Text>
          </TouchableOpacity>

          {expanded && (
            <View style={styles.details}>
              {entry.recipe.description && <Text style={typography.bodySecondary}>{entry.recipe.description}</Text>}
              <Text style={[typography.heading, styles.subheading]}>Ingredients</Text>
              {entry.recipe.ingredients.map((ing, i) => (
                <Text key={i} style={typography.body}>• {ing.amount ? `${ing.amount} ` : ''}{ing.item}</Text>
              ))}
              <Text style={[typography.heading, styles.subheading]}>Instructions</Text>
              {entry.recipe.instructions.map((step, i) => (
                <Text key={i} style={[typography.body, styles.step]}>{i + 1}. {step}</Text>
              ))}
            </View>
          )}

          <View style={styles.footerRow}>
            <RecipeReactionRow recipeSuggestionId={entry.recipe.id} reaction={reaction} onChange={onReactionChange} />
            <PrimaryButton
              title={entry.foodEntryId ? 'Logged ✓' : 'Log this meal'}
              variant={entry.foodEntryId ? 'secondary' : 'primary'}
              onPress={onLog}
              loading={logging}
              disabled={Boolean(entry.foodEntryId) || logging}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nameTouchable: {
    flex: 1,
  },
  nameInput: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  mealPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  mealPillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  reviewNote: {
    fontSize: 12,
    color: colors.warning,
    fontStyle: 'italic',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  expandHint: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  details: {
    gap: spacing.sm,
  },
  subheading: {
    marginTop: spacing.xs,
  },
  step: {
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
