const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { extract } = require('../src/adapters/appleHealthAdapter');
const { getAdapter } = require('../src/adapters');
const { validateContent } = require('../src/security/fileSniffer');
const { detectActivityTable } = require('../src/services/activityImportService');

const EXPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [<!ELEMENT HealthData (Record)*>]>
<HealthData locale="en_US">
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2024-03-01 08:00:00 +0530" endDate="2024-03-01 08:10:00 +0530" value="1000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2024-03-01 09:00:00 +0530" endDate="2024-03-01 09:10:00 +0530" value="500"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2024-03-01 08:00:00 +0530" endDate="2024-03-01 08:10:00 +0530" value="900"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="iPhone" unit="km" startDate="2024-03-01 08:00:00 +0530" value="1.2"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Watch" unit="kcal" startDate="2024-03-01 08:00:00 +0530" value="120.4"/>
 <Record type="HKQuantityTypeIdentifierBloodGlucose" sourceName="Health" unit="mg/dL" startDate="2024-03-01 07:00:00 +0530" value="98"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="lb" startDate="2024-03-01 06:00:00 +0530" value="154"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Watch" unit="%" startDate="2024-03-01 06:00:00 +0530" value="0.97"/>
</HealthData>`;

const GPX = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="12.9000" lon="77.6000"><time>2024-03-02T06:00:00Z</time></trkpt>
<trkpt lat="12.9090" lon="77.6000"><time>2024-03-02T06:05:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test('export.xml is aggregated into activity, glucose and vitals tables', async () => {
  const doc = await extract(Buffer.from(EXPORT_XML));
  const [activity, glucose, vitals] = doc.tables;
  assert.deepEqual(activity[1], ['2024-03-01', 1500, 120, 1200]); // best source, not phone+watch sum
  assert.ok(detectActivityTable(activity));
  assert.deepEqual(glucose[1], ['2024-03-01 07:00:00', 98, 'mg/dL', 'Apple Health']);
  const byName = Object.fromEntries(vitals.slice(1).map((r) => [r[0], r]));
  assert.equal(byName['Body Weight'][1], 69.85);
  assert.equal(byName['Oxygen Saturation'][1], 97);
});

test('zip with export.xml and a GPX route is read', async () => {
  const zip = new JSZip();
  zip.file('apple_health_export/export.xml', EXPORT_XML);
  zip.file('apple_health_export/workout-routes/route_1.gpx', GPX);
  const doc = await extract(await zip.generateAsync({ type: 'nodebuffer' }));
  const days = doc.tables[0].slice(1).map((r) => r[0]);
  assert.deepEqual(days, ['2024-03-01', '2024-03-02']);
  assert.ok(doc.tables[0][2][3] > 900 && doc.tables[0][2][3] < 1100);
});

test('standalone gpx and adapters/sniffer accept the new extensions', async () => {
  const doc = await extract(Buffer.from(GPX));
  assert.equal(doc.tables[0][1][0], '2024-03-02');
  for (const ext of ['zip', 'xml', 'gpx']) assert.ok(getAdapter(ext));
  assert.equal(validateContent(Buffer.from(GPX), 'gpx'), null);
  assert.equal(validateContent(Buffer.from('<html><script>x</script></html>'), 'xml') === null, false);
});

test('an unrelated xml file is rejected with a clear message', async () => {
  await assert.rejects(extract(Buffer.from('<?xml version="1.0"?><foo/>')), /not an Apple Health export/);
});
