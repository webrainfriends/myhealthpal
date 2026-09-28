import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing } from '../theme/theme';
import { clearRecipeReaction, setRecipeReaction } from '../api/client';

// Love/Like/Unlike on one recipe_suggestions row (recipeSuggestionId) - the
// person's own signal for how well a recipe is actually working for them.
// Tapping the currently-active reaction clears it; tapping a different one
// switches (server-side this is a single-row upsert, never a duplicate).
// Reused on both the standalone Recipes feed and a diet schedule entry
// card, since both can point at the same recipe_suggestion_id.
//
// Follows this app's icon convention (see FoodEntryCard.jsx's badge row):
// no vector-icon library anywhere in the app, so reactions are plain emoji
// glyphs in a <Text>, wrapped in a TouchableOpacity for the tap target.
const REACTIONS = [
  { type: 'love', emoji: '💖', label: 'Love' },
  { type: 'like', emoji: '👍', label: 'Like' },
  { type: 'unlike', emoji: '👎', label: 'Unlike' },
];

export default function RecipeReactionRow({ recipeSuggestionId, reaction, onChange, disabled }) {
  async function handlePress(type) {
    if (disabled || !recipeSuggestionId) return;
    const next = reaction === type ? null : type;
    onChange(next); // optimistic - the row toggles immediately
    try {
      if (next) {
        await setRecipeReaction(recipeSuggestionId, next);
      } else {
        await clearRecipeReaction(recipeSuggestionId);
      }
    } catch (err) {
      onChange(reaction); // revert on failure
    }
  }

  return (
    <View style={styles.row}>
      {REACTIONS.map((r) => {
        const active = reaction === r.type;
        return (
          <TouchableOpacity
            key={r.type}
            style={[styles.button, active && styles.buttonActive]}
            onPress={() => handlePress(r.type)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.emoji}>{r.emoji}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonActive: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  emoji: {
    fontSize: 16,
  },
});
