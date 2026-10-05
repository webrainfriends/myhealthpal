const pool = require('../db/pool');

const MAX_ALLERGEN_LENGTH = 60;

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Standard WHO adult BMI bands - a general-population guide, not a
// diagnosis, and not adjusted for age, sex, or body composition.
function bmiCategory(bmi) {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'overweight';
  return 'obese';
}

async function firstAndLatest(table, valueColumn, userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT ${valueColumn} FROM ${table} WHERE user_id = $1 ORDER BY recorded_at ASC, id ASC LIMIT 1) AS first_value,
       (SELECT recorded_at FROM ${table} WHERE user_id = $1 ORDER BY recorded_at ASC, id ASC LIMIT 1) AS first_recorded_at,
       (SELECT ${valueColumn} FROM ${table} WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1) AS latest_value,
       (SELECT recorded_at FROM ${table} WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1) AS latest_recorded_at`,
    [userId]
  );
  const row = rows[0];
  return {
    first: row.first_value != null ? Number(row.first_value) : null,
    firstRecordedAt: row.first_recorded_at,
    latest: row.latest_value != null ? Number(row.latest_value) : null,
    latestRecordedAt: row.latest_recorded_at,
  };
}

async function getProfile(userId) {
  const [weight, height, allergyRows] = await Promise.all([
    firstAndLatest('user_weight_entries', 'weight_kg', userId),
    firstAndLatest('user_height_entries', 'height_cm', userId),
    pool.query('SELECT id, allergen, created_at FROM user_allergies WHERE user_id = $1 ORDER BY created_at ASC', [
      userId,
    ]),
  ]);

  let bmi = null;
  if (weight.latest != null && height.latest != null) {
    const heightM = height.latest / 100;
    const value = round1(weight.latest / (heightM * heightM));
    bmi = { value, category: bmiCategory(value) };
  }

  return {
    weight: {
      currentKg: weight.latest,
      firstRecordedKg: weight.first,
      firstRecordedAt: weight.firstRecordedAt,
      latestRecordedAt: weight.latestRecordedAt,
    },
    height: {
      currentCm: height.latest,
      firstRecordedCm: height.first,
      firstRecordedAt: height.firstRecordedAt,
      latestRecordedAt: height.latestRecordedAt,
    },
    bmi,
    allergies: allergyRows.rows.map((r) => ({ id: r.id, allergen: r.allergen, createdAt: r.created_at })),
  };
}

function isValidWeightKg(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 500;
}

function isValidHeightCm(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 300;
}

async function addWeightEntry(userId, weightKg) {
  if (!isValidWeightKg(weightKg)) {
    const error = new Error('weightKg must be a positive number of kilograms.');
    error.status = 400;
    throw error;
  }
  await pool.query('INSERT INTO user_weight_entries (user_id, weight_kg) VALUES ($1, $2)', [userId, weightKg]);
  return getProfile(userId);
}

// Pure stats over a chronological (oldest first) list of {weightKg}.
function summarizeWeight(entries, heightCm) {
  if (entries.length === 0) return null;
  const values = entries.map((e) => e.weightKg);
  const first = values[0];
  const latest = values[values.length - 1];
  const bmiFor = (kg) => (heightCm ? round1(kg / ((heightCm / 100) * (heightCm / 100))) : null);
  const sum = values.reduce((a, b) => a + b, 0);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const lastBmi = bmiFor(latest);
  return {
    latestKg: latest,
    firstKg: first,
    changeKg: round1(latest - first),
    previousChangeKg: values.length > 1 ? round1(latest - values[values.length - 2]) : null,
    averageKg: round1(sum / values.length),
    lowestKg: lowest,
    highestKg: highest,
    entryCount: values.length,
    bmi: lastBmi != null ? { value: lastBmi, category: bmiCategory(lastBmi) } : null,
    healthyRangeKg: heightCm
      ? { min: round1(18.5 * (heightCm / 100) ** 2), max: round1(24.9 * (heightCm / 100) ** 2) }
      : null,
  };
}

// Weight history for charts: one point per day (the last reading of that
// day), oldest first, within the last `days` days (default 90, max 3650).
async function getWeightHistory(userId, days = 90) {
  const window = Math.min(Math.max(Math.floor(Number(days)) || 90, 1), 3650);
  const [{ rows }, height] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (recorded_at::date) id, weight_kg, recorded_at
       FROM user_weight_entries
       WHERE user_id = $1 AND recorded_at >= now() - ($2 || ' days')::interval
       ORDER BY recorded_at::date ASC, recorded_at DESC, id DESC`,
      [userId, String(window)]
    ),
    firstAndLatest('user_height_entries', 'height_cm', userId),
  ]);
  const entries = rows.map((r) => ({ id: r.id, weightKg: Number(r.weight_kg), recordedAt: r.recorded_at }));
  const heightCm = height.latest;
  return {
    days: window,
    heightCm,
    entries: entries.map((e) => ({
      ...e,
      bmi: heightCm ? round1(e.weightKg / ((heightCm / 100) * (heightCm / 100))) : null,
    })),
    stats: summarizeWeight(entries, heightCm),
  };
}

async function deleteWeightEntry(userId, entryId) {
  await pool.query('DELETE FROM user_weight_entries WHERE id = $1 AND user_id = $2', [entryId, userId]);
  return getProfile(userId);
}

async function addHeightEntry(userId, heightCm) {
  if (!isValidHeightCm(heightCm)) {
    const error = new Error('heightCm must be a positive number of centimeters.');
    error.status = 400;
    throw error;
  }
  await pool.query('INSERT INTO user_height_entries (user_id, height_cm) VALUES ($1, $2)', [userId, heightCm]);
  return getProfile(userId);
}

function cleanAllergen(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_ALLERGEN_LENGTH) : '';
}

async function addAllergy(userId, allergen) {
  const clean = cleanAllergen(allergen);
  if (!clean) {
    const error = new Error('allergen is required.');
    error.status = 400;
    throw error;
  }
  await pool.query(
    `INSERT INTO user_allergies (user_id, allergen) VALUES ($1, $2)
     ON CONFLICT (user_id, allergen) DO NOTHING`,
    [userId, clean]
  );
  return getProfile(userId);
}

async function removeAllergy(userId, allergyId) {
  await pool.query('DELETE FROM user_allergies WHERE id = $1 AND user_id = $2', [allergyId, userId]);
  return getProfile(userId);
}

module.exports = { getProfile, getWeightHistory, deleteWeightEntry, summarizeWeight, addWeightEntry, addHeightEntry, addAllergy, removeAllergy };
