const express = require('express');
const recipeReactionService = require('../recipes/recipeReactionService');

const router = express.Router();

function currentUserId(req) {
  return req.user.id;
}

// Batched lookup for a list screen (Recipes feed, schedule calendar) - one
// request for every card's reaction state instead of one per card.
router.get('/', async (req, res, next) => {
  try {
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : [];
    const reactions = await recipeReactionService.getReactionsForUser(currentUserId(req), ids);
    res.json({ reactions });
  } catch (err) {
    next(err);
  }
});

router.put('/:recipeSuggestionId', async (req, res, next) => {
  try {
    const reactionType = req.body?.reactionType;
    if (!recipeReactionService.REACTION_TYPES.includes(reactionType)) {
      return res.status(400).json({ error: `reactionType must be one of ${recipeReactionService.REACTION_TYPES.join(', ')}.` });
    }
    const reaction = await recipeReactionService.setReaction(currentUserId(req), req.params.recipeSuggestionId, reactionType);
    if (!reaction) return res.status(404).json({ error: 'Recipe suggestion not found.' });
    res.json({ reaction: { recipeSuggestionId: reaction.recipe_suggestion_id, reactionType: reaction.reaction_type } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:recipeSuggestionId', async (req, res, next) => {
  try {
    const cleared = await recipeReactionService.clearReaction(currentUserId(req), req.params.recipeSuggestionId);
    if (!cleared) return res.status(404).json({ error: 'Recipe suggestion not found or has no reaction to clear.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
