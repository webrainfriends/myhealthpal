const sax = require('sax');
const JSZip = require('jszip');
const { StringDecoder } = require('string_decoder');
const { parse: parseCsv } = require('csv-parse/sync');

// Reads an Apple Health export in any of its shapes and flattens it into the
// same { contentKind: 'structured_table', tables } contract the other
// adapters produce, so the existing activity/glucose importers and the
// generic extractor handle it unchanged:
//   - export.zip            the whole "Export All Health Data" archive
//   - export.xml            HealthKit records (steps, energy, weight, BP...)
//   - export_cda.xml        the clinical-document (CDA) export
//   - *.gpx                 workout routes
//   - electrocardiograms/*.csv, clinical-records/*.json  (inside the zip)
// Nothing is materialised per raw record: a real export.xml is hundreds of
// MB with millions of <Record>s, so it is streamed through a SAX parser and
// folded into daily aggregates as it goes.

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const MAX_VITAL_ROWS = 2000;
const HK = 'HKQuantityTypeIdentifier';

// Daily-summed quantities -> the activity table.
const ACTIVITY_TYPES = {
  [`${HK}StepCount`]: 'steps',
  [`${HK}ActiveEnergyBurned`]: 'calories',
  [`${HK}DistanceWalkingRunning`]: 'distance',
};

// Point-in-time quantities kept as the latest reading per day.
const VITAL_TYPES = {
  [`${HK}BodyMass`]: { name: 'Body Weight', convert: weightKg },
  [`${HK}Height`]: { name: 'Height', convert: heightCm },
  [`${HK}BodyMassIndex`]: { name: 'BMI', unit: 'kg/m2' },
  [`${HK}BodyFatPercentage`]: { name: 'Body Fat', unit: '%', convert: percent },
  [`${HK}RestingHeartRate`]: { name: 'Resting Heart Rate', unit: 'bpm' },
  [`${HK}HeartRateVariabilitySDNN`]: { name: 'Heart Rate Variability', unit: 'ms' },
  [`${HK}OxygenSaturation`]: { name: 'Oxygen Saturation', unit: '%', convert: percent },
  [`${HK}BodyTemperature`]: { name: 'Body Temperature', convert: tempC },
  [`${HK}BloodPressureSystolic`]: { name: 'Systolic Blood Pressure', unit: 'mmHg' },
  [`${HK}BloodPressureDiastolic`]: { name: 'Diastolic Blood Pressure', unit: 'mmHg' },
  [`${HK}RespiratoryRate`]: { name: 'Respiratory Rate', unit: 'breaths/min' },
  [`${HK}VO2Max`]: { name: 'VO2 Max', unit: 'mL/kg/min' },
};
const GLUCOSE_TYPE = `${HK}BloodGlucose`;

function weightKg(v, unit) {
  return /lb/i.test(unit) ? { value: v * 0.45359237, unit: 'kg' } : { value: v, unit: 'kg' };
}
function heightCm(v, unit) {
  if (/^m$/i.test(unit)) return { value: v * 100, unit: 'cm' };
  if (/^in/i.test(unit)) return { value: v * 2.54, unit: 'cm' };
  if (/^ft/i.test(unit)) return { value: v * 30.48, unit: 'cm' };
  return { value: v, unit: 'cm' };
}
function percent(v) {
  // HealthKit stores these as a 0-1 fraction even though the unit says "%".
  return { value: v <= 1 ? v * 100 : v, unit: '%' };
}
function tempC(v, unit) {
  return /f/i.test(unit) ? { value: ((v - 32) * 5) / 9, unit: 'C' } : { value: v, unit: 'C' };
}
function distanceMeters(v, unit) {
  if (/^km/i.test(unit)) return v * 1000;
  if (/^mi/i.test(unit)) return v * 1609.344;
  return v;
}
function energyKcal(v, unit) {
  return /kj/i.test(unit) ? v / 4.184 : v;
}

// '2024-01-05 08:30:00 +0530' -> local day / local wall-clock time.
const dayOf = (s) => (s || '').slice(0, 10);
const timeOf = (s) => (s || '').slice(0, 19);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function round(n, digits = 1) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function haversine(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

class Aggregate {
  constructor() {
    this.daily = new Map(); // day -> kind -> source -> sum
    this.glucose = [];
    this.vitals = new Map(); // `${name}|${day}` -> { time, name, value, unit }
    this.routeMeters = new Map(); // day -> metres from GPX
    this.recordCount = 0;
  }

  addActivity(kind, day, source, amount) {
    if (!isDay(day) || !Number.isFinite(amount)) return;
    const byKind = this.daily.get(day) || new Map();
    const bySource = byKind.get(kind) || new Map();
    bySource.set(source, (bySource.get(source) || 0) + amount);
    byKind.set(kind, bySource);
    this.daily.set(day, byKind);
  }

  addVital(name, dateStr, value, unit) {
    const day = dayOf(dateStr);
    if (!isDay(day) || !Number.isFinite(value)) return;
    const key = `${name}|${day}`;
    const existing = this.vitals.get(key);
    const time = timeOf(dateStr);
    if (!existing || time >= existing.time) {
      this.vitals.set(key, { time, name, value: round(value, 2), unit, day });
    }
  }

  addRecord(attrs) {
    const type = attrs.type;
    const value = Number.parseFloat(attrs.value);
    if (!type || !Number.isFinite(value)) return;
    const unit = attrs.unit || '';
    const start = attrs.startDate || attrs.creationDate || '';
    this.recordCount += 1;

    const kind = ACTIVITY_TYPES[type];
    if (kind) {
      const amount =
        kind === 'distance' ? distanceMeters(value, unit) : kind === 'calories' ? energyKcal(value, unit) : value;
      // Phone and Watch both log the same steps; summing across sources
      // would double-count, so each source is totalled separately and the
      // day takes the largest (see flushActivity).
      this.addActivity(kind, dayOf(start), attrs.sourceName || 'unknown', amount);
      return;
    }
    if (type === GLUCOSE_TYPE) {
      const time = timeOf(start);
      if (isDay(dayOf(time)) && value > 0) {
        this.glucose.push([time, value, /mmol/i.test(unit) ? 'mmol/L' : 'mg/dL']);
      }
      return;
    }
    const vital = VITAL_TYPES[type];
    if (vital) {
      const converted = vital.convert ? vital.convert(value, unit) : { value, unit: vital.unit || unit };
      this.addVital(vital.name, start, converted.value, converted.unit);
    }
  }

  addRoute(day, meters) {
    if (!isDay(day) || !(meters > 0)) return;
    this.routeMeters.set(day, (this.routeMeters.get(day) || 0) + meters);
  }

  toTables() {
    const tables = [];

    // Activity: best single source per metric per day. GPX distance only
    // fills days HealthKit reported no distance for.
    const days = new Set([...this.daily.keys(), ...this.routeMeters.keys()]);
    const activityRows = [];
    for (const day of [...days].sort()) {
      const byKind = this.daily.get(day) || new Map();
      const best = (kind) => {
        const sources = byKind.get(kind);
        return sources ? Math.max(...sources.values()) : null;
      };
      const steps = best('steps');
      const calories = best('calories');
      let distance = best('distance');
      if (distance === null && this.routeMeters.has(day)) distance = this.routeMeters.get(day);
      if (steps === null && calories === null && distance === null) continue;
      activityRows.push([
        day,
        steps === null ? '' : Math.round(steps),
        calories === null ? '' : Math.round(calories),
        distance === null ? '' : Math.round(distance),
      ]);
    }
    if (activityRows.length > 0) {
      tables.push([['Date', 'Steps', 'Calories Burned', 'Distance (m)'], ...activityRows]);
    }

    if (this.glucose.length > 0) {
      this.glucose.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      tables.push([
        ['Date & Time', 'Glucose', 'Glucose Units', 'Source'],
        ...this.glucose.map(([time, value, unit]) => [time, round(value, 1), unit, 'Apple Health']),
      ]);
    }

    if (this.vitals.size > 0) {
      const rows = [...this.vitals.values()].sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, MAX_VITAL_ROWS);
      tables.push([
        ['Test Name', 'Result', 'Unit', 'Date'],
        ...rows.map((v) => [v.name, round(v.value, 2), v.unit, v.day]),
      ]);
    }
    return tables;
  }
}

// ---- export.xml / export_cda.xml --------------------------------------

function newParser(handlers) {
  // Strict (case-preserving tag names) + no entity loading: sax never fetches external DTDs or
  // resolves external entities, so a crafted export can't read local files.
  const parser = sax.parser(true, { trim: false });
  Object.assign(parser, handlers);
  parser.onerror = function onerror() {
    this.error = null; // tolerate the odd malformed fragment, keep going
    this.resume();
  };
  return parser;
}

function healthDataHandlers(agg) {
  return {
    onopentag(node) {
      if (node.name === 'Record') agg.addRecord(node.attributes);
    },
  };
}

// CDA: <observation> ... <code displayName="..."/> <value value="" unit=""/>
function cdaHandlers(agg) {
  let current = null;
  return {
    onopentag(node) {
      const a = node.attributes;
      if (node.name === 'observation') current = { name: null, value: null, unit: '', date: null };
      else if (!current) return;
      else if (node.name === 'code' && !current.name) current.name = a.displayName || null;
      else if (node.name === 'value' && a.value !== undefined && current.value === null) {
        current.value = Number.parseFloat(a.value);
        current.unit = a.unit || '';
      } else if (node.name === 'effectiveTime' && !current.date) {
        const raw = a.value || '';
        const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
        if (m) current.date = `${m[1]}-${m[2]}-${m[3]}`;
      }
    },
    onclosetag(name) {
      if (name === 'observation' && current) {
        if (current.name && Number.isFinite(current.value) && current.date) {
          agg.addVital(current.name, current.date, current.value, current.unit);
        }
        current = null;
      }
    },
  };
}

function feedString(parser, str) {
  parser.write(str);
}

function parseXmlBuffer(buffer, kind, agg) {
  const parser = newParser(kind === 'cda' ? cdaHandlers(agg) : healthDataHandlers(agg));
  const decoder = new StringDecoder('utf8');
  const CHUNK = 1024 * 1024;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    feedString(parser, decoder.write(buffer.subarray(i, i + CHUNK)));
  }
  feedString(parser, decoder.end());
  parser.close();
}

function parseXmlStream(stream, kind, agg) {
  return new Promise((resolve, reject) => {
    const parser = newParser(kind === 'cda' ? cdaHandlers(agg) : healthDataHandlers(agg));
    const decoder = new StringDecoder('utf8');
    stream.on('data', (chunk) => feedString(parser, decoder.write(chunk)));
    stream.on('end', () => {
      feedString(parser, decoder.end());
      parser.close();
      resolve();
    });
    stream.on('error', reject);
  });
}

// ---- GPX ----------------------------------------------------------------

function parseGpx(text, agg) {
  let point = null;
  let inTime = false;
  let timeText = '';
  let prev = null;
  let firstDay = null;
  let meters = 0;
  const parser = newParser({
    onopentag(node) {
      if (node.name === 'trkseg') prev = null;
      if (node.name === 'trkpt') {
        point = { lat: Number.parseFloat(node.attributes.lat), lon: Number.parseFloat(node.attributes.lon) };
      } else if (node.name === 'time' && point) {
        inTime = true;
        timeText = '';
      }
    },
    ontext(t) {
      if (inTime) timeText += t;
    },
    onclosetag(name) {
      if (name === 'time') {
        inTime = false;
        if (point && !firstDay) firstDay = dayOf(timeText.trim());
      } else if (name === 'trkpt' && point) {
        if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
          if (prev) meters += haversine(prev, point);
          prev = point;
        }
        point = null;
      }
    },
  });
  parser.write(text);
  parser.close();
  agg.addRoute(firstDay, meters);
}

// ---- ECG csv / FHIR clinical records (zip only) ------------------------

function parseEcgCsv(text, agg) {
  let rows;
  try {
    rows = parseCsv(text, { relax_column_count: true, skip_empty_lines: true, to_line: 15 });
  } catch (_) {
    return;
  }
  const meta = new Map(rows.filter((r) => r.length >= 2).map((r) => [String(r[0]).trim(), String(r[1]).trim()]));
  const recorded = meta.get('Recorded Date');
  const hr = Number.parseFloat(meta.get('Average Heart Rate'));
  if (recorded && Number.isFinite(hr)) agg.addVital('ECG Average Heart Rate', recorded.replace('T', ' '), hr, 'bpm');
}

function parseFhirObservation(json, agg) {
  let resource;
  try {
    resource = JSON.parse(json);
  } catch (_) {
    return;
  }
  if (!resource || resource.resourceType !== 'Observation') return;
  const q = resource.valueQuantity;
  const name = resource.code?.text || resource.code?.coding?.[0]?.display;
  const date = resource.effectiveDateTime || resource.issued;
  if (name && q && Number.isFinite(Number(q.value)) && date) {
    agg.addVital(String(name).slice(0, 120), String(date).replace('T', ' '), Number(q.value), q.unit || q.code || '');
  }
}

// ---- entry points --------------------------------------------------------

async function extractFromZip(buffer, agg) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'));
  const base = (f) => f.name.split('/').pop().toLowerCase();

  const exportXml = entries.find((f) => base(f) === 'export.xml');
  const cda = entries.find((f) => base(f) === 'export_cda.xml');
  if (exportXml) await parseXmlStream(exportXml.nodeStream(), 'health', agg);
  // export_cda.xml re-states the same data as documents; only read it when
  // there is no export.xml so nothing is imported twice.
  else if (cda) await parseXmlStream(cda.nodeStream(), 'cda', agg);

  for (const f of entries) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.gpx')) parseGpx(await f.async('string'), agg);
    else if (name.includes('electrocardiograms/') && name.endsWith('.csv')) parseEcgCsv(await f.async('string'), agg);
    else if (name.includes('clinical-records/') && name.endsWith('.json')) parseFhirObservation(await f.async('string'), agg);
  }
}

function startsWithBytes(buf, bytes) {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

async function extract(input) {
  const buffer = Buffer.isBuffer(input) ? input : require('fs').readFileSync(input);
  const agg = new Aggregate();

  if (startsWithBytes(buffer, ZIP_MAGIC)) {
    await extractFromZip(buffer, agg);
  } else {
    const head = buffer.subarray(0, 8192).toString('utf8');
    if (/<gpx[\s>]/i.test(head)) parseGpx(buffer.toString('utf8'), agg);
    else if (/<ClinicalDocument[\s>]/i.test(head)) parseXmlBuffer(buffer, 'cda', agg);
    else if (/<HealthData[\s>]/i.test(head)) parseXmlBuffer(buffer, 'health', agg);
    else throw new Error('This XML file is not an Apple Health export (expected HealthData, ClinicalDocument or GPX).');
  }

  const tables = agg.toTables();
  if (tables.length === 0) {
    throw new Error('No supported Apple Health data (activity, glucose, vitals or routes) was found in this file.');
  }
  return { contentKind: 'structured_table', tables, text: null };
}

module.exports = { extract };
