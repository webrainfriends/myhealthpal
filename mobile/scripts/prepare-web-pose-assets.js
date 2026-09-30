// Puts the browser pose-tracking files under mobile/public/mediapipe so
// `expo export` copies them into the web build and eyemyhealth.com serves them
// itself (no third-party CDN at runtime):
//   - the MediaPipe WebAssembly engine, copied from @mediapipe/tasks-vision
//   - the pose_landmarker_lite model, downloaded once from Google's model store
//
// A failed model download prints a warning and exits 0: it must never fail a
// deploy. The web Workout Coach then reports that tracking is unavailable.
const fs = require('fs');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'mediapipe');
const wasmOut = path.join(outDir, 'wasm');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const MODEL_FILE = path.join(outDir, 'pose_landmarker_lite.task');
const MIN_MODEL_BYTES = 1024 * 1024;

function copyWasm() {
  const src = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  fs.mkdirSync(wasmOut, { recursive: true });
  for (const file of fs.readdirSync(src)) fs.copyFileSync(path.join(src, file), path.join(wasmOut, file));
  console.log(`[pose-assets] copied ${fs.readdirSync(wasmOut).length} wasm files`);
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const tmp = `${dest}.tmp`;
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        if (fs.statSync(tmp).size < MIN_MODEL_BYTES) {
          fs.unlinkSync(tmp);
          reject(new Error('downloaded model is too small'));
          return;
        }
        fs.renameSync(tmp, dest);
        resolve();
      }));
      file.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  try {
    copyWasm();
  } catch (err) {
    console.warn(`[pose-assets] warning: could not copy the wasm engine (${err.message})`);
    return;
  }
  if (fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size >= MIN_MODEL_BYTES) {
    console.log('[pose-assets] model already present');
    return;
  }
  try {
    await download(MODEL_URL, MODEL_FILE);
    console.log(`[pose-assets] downloaded model (${(fs.statSync(MODEL_FILE).size / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    console.warn(`[pose-assets] warning: model download failed (${err.message}); browser pose tracking will be unavailable`);
  }
})();
