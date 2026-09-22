require('dotenv').config();
const { Pool, types } = require('pg');

// A DATE column (report effective_date, medication start/end/expiry date, a
// dashboard trend point's day, ...) means a specific calendar day with no
// attached time or timezone. pg's default parser for DATE (OID 1082) turns
// it into a JS Date object at UTC midnight; once that round-trips through
// JSON (Date -> toISOString()) and a client parses it back with `new
// Date(...)`, formatting it in the *device's* local timezone can land on
// the wrong side of midnight - e.g. UTC midnight Sept 1 reads as Aug 31,
// 7pm in any timezone behind UTC (all of the Americas). Returning the raw
// 'YYYY-MM-DD' string instead removes that round-trip entirely: every route
// now sends the exact calendar date that was stored, and the client is
// responsible for treating it as a calendar date (see mobile/src/utils/
// date.js's parseCalendarDate) rather than an instant to re-localize.
types.setTypeParser(types.builtins.DATE, (value) => value);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;
