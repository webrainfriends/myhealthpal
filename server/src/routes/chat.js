const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { runTurn } = require('../chat/chatOrchestrator');

const router = express.Router();

function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
}

router.get('/sessions', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC',
      [currentUserId(req)]
    );
    res.json({ sessions: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { rows } = await pool.query('INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING *', [
      currentUserId(req),
    ]);
    res.status(201).json({ session: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const { rows } = await pool.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ messages: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:id/messages', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const owned = await pool.query('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [
      req.params.id,
      userId,
    ]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const userMessage = String(req.body.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'message is required.' });

    const history = await pool.query(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1 AND role IN ('user', 'assistant')
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    const priorMessages = history.rows.map((row) =>
      row.role === 'user' ? { role: 'user', content: row.content } : { role: 'assistant', text: row.content, toolCalls: [] }
    );

    await pool.query(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`, [
      req.params.id,
      userMessage,
    ]);

    const result = await runTurn({ userId, sessionId: req.params.id, userMessage, priorMessages });

    const saved = await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, evidence, provider, model)
       VALUES ($1, 'assistant', $2, $3, $4, $5) RETURNING *`,
      [req.params.id, result.answer, JSON.stringify(result.evidence), result.provider || null, result.model || null]
    );
    await pool.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [req.params.id]);

    res.json({ message: saved.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
