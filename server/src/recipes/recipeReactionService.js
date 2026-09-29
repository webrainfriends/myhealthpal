const pool = require('../db/pool');
const recipeCatalogService = require('./recipeCatalogService');

// Love/Like/Unlike on a specific recipe_suggestions row (027_recipe_reactions.sql).
// One mutually-exclusive reaction per (user, recipe instance) - since a
// schedule entry and the standalone Recipes feed can point at the same
// recipe_suggestion_id, they share one reaction with no extra table.

const REACTION_TYPES = ['love', 'like', 'unlike'];

async function findOwnedSuggestion(userId, recipeSuggestionId) {
  const { rows } = await pool.query('SELECT id, canonical_recipe_id FROM recipe_suggestions WHERE id = $1 AND user_id = $2', [
    recipeSuggestionId,
    userId,
  ]);
  return rows[0] || null;
}

async function setReaction(userId, recipeSuggestionId, reactionType) {
  if (!REACTION_TYPES.includes(reactionType)) {
    throw Object.assign(new Error('reactionType must be one of love, like, unlike.'), { status: 400 });
  }
  const suggestion = await findOwnedSuggestion(userId, recipeSuggestionId);
  if (!suggestion) return null;

  const { rows } = await pool.query(
    `INSERT INTO recipe_reactions (user_id, recipe_suggestion_id, reaction_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, recipe_suggestion_id) DO UPDATE SET reaction_type = EXCLUDED.reaction_type, updated_at = now()
     RETURNING *`,
    [userId, recipeSuggestionId, reactionType]
  );

  await recipeCatalogService.recordReactionRollup(suggestion.canonical_recipe_id);
  return rows[0];
}

async function clearReaction(userId, recipeSuggestionId) {
  const suggestion = await findOwnedSuggestion(userId, recipeSuggestionId);
  if (!suggestion) return false;

  const { rows } = await pool.query(
    'DELETE FROM recipe_reactions WHERE user_id = $1 AND recipe_suggestion_id = $2 RETURNING recipe_suggestion_id',
    [userId, recipeSuggestionId]
  );
  if (rows.length > 0) await recipeCatalogService.recordReactionRollup(suggestion.canonical_recipe_id);
  return rows.length > 0;
}

// Batched lookup for a list screen (Recipes feed, schedule calendar) so
// rendering N recipe cards costs one query, not N.
async function getReactionsForUser(userId, recipeSuggestionIds) {
  if (!Array.isArray(recipeSuggestionIds) || recipeSuggestionIds.length === 0) return {};
  const { rows } = await pool.query(
    'SELECT recipe_suggestion_id, reaction_type FROM recipe_reactions WHERE user_id = $1 AND recipe_suggestion_id = ANY($2::uuid[])',
    [userId, recipeSuggestionIds]
  );
  const byId = {};
  for (const row of rows) byId[row.recipe_suggestion_id] = row.reaction_type;
  return byId;
}

module.exports = { REACTION_TYPES, setReaction, clearReaction, getReactionsForUser };
