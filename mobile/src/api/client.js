import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { loadToken } from '../auth/tokenStorage';

const PRODUCTION_API_URL = 'https://eyemyhealth.com';

function defaultBaseUrl() {
  // On web, the app and API are served from the same origin (nginx serves
  // the static build at "/" and proxies "/api/" to the Node app) — a
  // relative base URL means the build works unmodified behind any host.
  if (Platform.OS === 'web') return '';
  // A store/release build has no dev machine to reach: point at production
  // (HTTPS - iOS App Transport Security and Android both refuse plain HTTP).
  // EAS profiles normally set EXPO_PUBLIC_API_BASE_URL explicitly.
  if (!__DEV__) return PRODUCTION_API_URL;
  // Android emulators can't reach the host machine via localhost.
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

// EXPO_PUBLIC_* vars are inlined at build time. Used to point the production
// web build at a same-origin "" (nginx proxies /api on that same host/port),
// which "||" can't express since "" is falsy - "??" only falls through for
// null/undefined, leaving an explicitly empty string intact.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? Constants.expoConfig?.extra?.apiBaseUrl ?? defaultBaseUrl();

// Set by AuthContext once, at app start - lets this module react to a
// session becoming invalid (expired/revoked token) without importing
// AuthContext itself (which imports this module), avoiding a cycle.
let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

// The family member's profile currently being viewed (Family Health Eye),
// or null for the signed-in account's own. Set by AuthContext; sent as
// X-Profile-Id, which the server only honors for a profile this account has
// been granted (and ignores on account routes like /api/auth and
// /api/family).
let activeProfileId = null;
export function setActiveProfileId(profileId) {
  activeProfileId = profileId || null;
}

// Every authenticated call funnels through here so the session token is
// attached exactly once, in one place, rather than at each of the 20+ call
// sites below - and so a 401 (expired/invalid/revoked session) is handled
// the same way everywhere: hand the app back to the sign-in screen instead
// of quietly failing or, worse, falling back to some default identity.
async function apiFetch(path, options = {}) {
  const token = loadToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (activeProfileId) headers['X-Profile-Id'] = activeProfileId;

  // Belt-and-suspenders alongside the server's own Cache-Control: no-store -
  // every call here is a signed-in user's current data (report processing
  // status, dashboard scores), never something a browser should serve
  // stale from its disk/memory cache on a repeat GET.
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, cache: 'no-store' });
  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
  }
  return response;
}

async function handleResponse(response) {
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    // e.g. 'consent_required' / 'ai_consent_required' / 'upload_rejected'
    // - lets screens react (open the Privacy & AI screen) instead of only
    // showing the message.
    error.code = body?.code || null;
    error.consentType = body?.consentType || null;
    throw error;
  }
  return body;
}

export async function fetchSupportedFormats() {
  const response = await apiFetch('/api/config/supported-formats');
  return handleResponse(response);
}

export async function fetchAuthConfig() {
  const response = await apiFetch('/api/auth/config');
  return handleResponse(response);
}

export async function signInGuest() {
  const response = await apiFetch('/api/auth/guest', { method: 'POST' });
  return handleResponse(response);
}

export async function signInGoogle(idToken) {
  const response = await apiFetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  return handleResponse(response);
}

export async function signInApple(identityToken, fullName) {
  const response = await apiFetch('/api/auth/apple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken, fullName }),
  });
  return handleResponse(response);
}

export async function fetchMe() {
  const response = await apiFetch('/api/auth/me');
  return handleResponse(response);
}

// The signed-in user's AI token usage - this session, the last `days`
// days, and all-time - for Settings > AI usage.
export async function fetchAiUsage(days = 30) {
  const response = await apiFetch(`/api/ai-usage?days=${encodeURIComponent(days)}`);
  return handleResponse(response);
}

export async function fetchSupportedLanguages() {
  const response = await apiFetch('/api/auth/languages');
  return handleResponse(response);
}

export async function updatePreferredLanguage(languageCode) {
  const response = await apiFetch('/api/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferred_language: languageCode }),
  });
  return handleResponse(response);
}

export async function fetchReports() {
  const response = await apiFetch('/api/reports');
  return handleResponse(response);
}

export async function fetchReport(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}`);
  return handleResponse(response);
}

export async function uploadReport(file) {
  const formData = new FormData();
  if (file.file) {
    // On web, expo-document-picker/expo-image-picker hand back the real
    // browser File/Blob in `file` — the {uri, name, type} object below is a
    // React Native-only FormData convention that a browser's FormData
    // silently ignores (no bytes get sent), so web must use the Blob itself.
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    });
  }

  const response = await apiFetch('/api/reports', {
    method: 'POST',
    body: formData,
    // Do not set Content-Type manually: fetch computes the multipart
    // boundary itself from the FormData body, and a hand-set header here
    // (missing that boundary) makes the server unable to parse the body.
  });
  return handleResponse(response);
}

// The single Upload-tab entry point: the server works out whether the file
// is a lab result, insurance policy, food photo or diet schedule and files it
// in the right place (routes/smartUpload.js). `category` is 'auto' (default)
// or one of 'lab_report' | 'insurance' | 'food' | 'diet_schedule' when the
// person picked a type themselves.
export async function uploadSmart(file, { category = 'auto' } = {}) {
  const formData = new FormData();
  if (file.file) {
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    });
  }
  formData.append('category', category);

  const response = await apiFetch('/api/uploads', { method: 'POST', body: formData });
  return handleResponse(response);
}

export async function fetchReportFileUrl(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}/file-url`);
  const data = await handleResponse(response);
  // The signed url is server-relative (it's opened by window.open/
  // Linking.openURL, not through apiFetch, so it needs to be absolute -
  // API_BASE_URL is '' on web same-origin builds, which is also correct.
  return `${API_BASE_URL}${data.url}`;
}

export async function retryReport(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}/retry`, { method: 'POST' });
  return handleResponse(response);
}

// Re-applies the current matching / unit / flag rules to a report's
// already-extracted results (no AI, status unchanged) and returns its counts
// next to the dashboard's.
export async function recheckReport(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}/recheck`, { method: 'POST' });
  return handleResponse(response);
}

export async function updateMeasurement(reportId, measurementId, changes) {
  const response = await apiFetch(`/api/reports/${reportId}/measurements/${measurementId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function resolveDuplicateMeasurement(reportId, measurementId, action) {
  const response = await apiFetch(`/api/reports/${reportId}/measurements/${measurementId}/duplicate-resolution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return handleResponse(response);
}

export async function confirmReport(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}/confirm`, { method: 'POST' });
  return handleResponse(response);
}

export async function deleteReport(reportId) {
  const response = await apiFetch(`/api/reports/${reportId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function searchHealthParameters(query) {
  const response = await apiFetch(`/api/health-parameters?search=${encodeURIComponent(query || '')}`);
  return handleResponse(response);
}

export async function updateReportDate(reportId, effectiveDate) {
  const response = await apiFetch(`/api/reports/${reportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effective_date: effectiveDate }),
  });
  return handleResponse(response);
}

export async function fetchTimeline(filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const response = await apiFetch(`/api/timeline?${params.toString()}`);
  return handleResponse(response);
}

export async function fetchDashboardSnapshot() {
  const response = await apiFetch('/api/dashboard/snapshot');
  return handleResponse(response);
}

export async function fetchOrganHealth() {
  const response = await apiFetch('/api/dashboard/organs');
  return handleResponse(response);
}

export async function fetchCustomCards() {
  const response = await apiFetch('/api/dashboard/custom-cards');
  return handleResponse(response);
}

export async function fetchParameterTrend(code, range = '90d') {
  const response = await apiFetch(`/api/dashboard/parameters/${code}/trend?range=${range}`);
  return handleResponse(response);
}

export async function fetchActivitySummary(days = 14) {
  const response = await apiFetch(`/api/activity/summary?days=${days}`);
  return handleResponse(response);
}

export async function fetchGlucoseSummary(days = 30) {
  const response = await apiFetch(`/api/glucose/summary?days=${days}`);
  return handleResponse(response);
}

export async function logActivity(fields) {
  const response = await apiFetch('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

// AI Workout Coach (issue #135). Pose tracking is on-device; only per-rep
// aggregates and form events are sent, in batches.
async function workoutJson(path, method, body) {
  const response = await apiFetch(`/api/activity/workouts${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse(response);
}
export const fetchWorkoutExercises = () => workoutJson('/exercises', 'GET');
export const fetchWorkoutHistory = () => workoutJson('/history', 'GET');
export const createWorkout = (fields) => workoutJson('', 'POST', fields);
export const startWorkout = (id) => workoutJson(`/${id}/start`, 'POST');
export const recordWorkoutSets = (id, sets) => workoutJson(`/${id}/sets`, 'POST', { sets });
export const completeWorkout = (id, fields) => workoutJson(`/${id}/complete`, 'POST', fields);
export const fetchWorkoutSummary = (id) => workoutJson(`/${id}/summary`, 'GET');
export const fetchWorkoutProgression = (exerciseId) => workoutJson(`/progression/${exerciseId}`, 'GET');
export const fetchWorkoutAnalytics = () => workoutJson('/analytics', 'GET');
// Permanently deletes captured workouts (and any saved recording). Ring totals are computed live, so they update immediately.
export const deleteWorkouts = (ids) => workoutJson('/delete', 'POST', { ids });
export const fetchWorkoutPlans = () => workoutJson('/plans', 'GET');
export const fetchWorkoutPlan = (id) => workoutJson(`/plans/${id}`, 'GET');
export const createWorkoutPlan = (plan) => workoutJson('/plans', 'POST', plan);
export const deleteWorkoutPlan = (id) => workoutJson(`/plans/${id}`, 'DELETE');
export const runWorkoutPlan = (id) => workoutJson(`/plans/${id}/run`, 'POST');

// Retained workout video (issue #135 Phase 3). The recording is uploaded
// straight into the encrypted vault; nothing here ever builds a public URL.
export const fetchWorkoutVideoStatus = (id) => workoutJson(`/${id}/video`, 'GET');
export const completeWorkoutVideo = (id, hashes) => workoutJson(`/${id}/video/complete`, 'POST', hashes);
export const markWorkoutVideoLocalDeleted = (id) => workoutJson(`/${id}/video/local-deleted`, 'POST');
export const deleteWorkoutVideo = (id) => workoutJson(`/${id}/video`, 'DELETE');
export const saveWorkoutPoseSegment = (id, segment) => workoutJson(`/${id}/pose-segments`, 'POST', segment);
export const fetchWorkoutPoseSegment = (id) => workoutJson(`/${id}/pose-segments`, 'GET');
export async function fetchWorkoutVideoUrl(id) {
  const data = await workoutJson(`/${id}/video/url`, 'POST');
  // Short-lived and video-scoped; absolute so a native player can open it.
  return `${API_BASE_URL}${data.url}`;
}

// Native only: multipart upload of the recorded file without loading it into
// JS memory. Resolves with the server's asset status.
export async function uploadWorkoutVideo(id, fileUri) {
  // eslint-disable-next-line global-require
  const FileSystem = require('expo-file-system/legacy');
  const headers = {};
  const token = loadToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (activeProfileId) headers['X-Profile-Id'] = activeProfileId;
  const result = await FileSystem.uploadAsync(`${API_BASE_URL}/api/activity/workouts/${id}/video/upload`, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'video',
    mimeType: 'video/mp4',
    headers,
  });
  let body = null;
  try {
    body = JSON.parse(result.body);
  } catch (err) {
    body = null;
  }
  if (result.status === 401 && onUnauthorized) onUnauthorized();
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(body?.error || `Upload failed with status ${result.status}`);
    error.status = result.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}

export async function fetchPairedDevices() {
  const response = await apiFetch('/api/devices');
  return handleResponse(response);
}

export async function pairDevice(fields) {
  const response = await apiFetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function renameDevice(deviceId, name) {
  const response = await apiFetch(`/api/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse(response);
}

export async function unpairDevice(deviceId) {
  const response = await apiFetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function syncDeviceReadings(deviceId, readings) {
  const response = await apiFetch(`/api/devices/${deviceId}/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readings }),
  });
  return handleResponse(response);
}

export async function fetchVitalsSummary() {
  const response = await apiFetch('/api/devices/vitals/summary');
  return handleResponse(response);
}

export async function fetchVitalsHistory(readingType, days = 90) {
  const response = await apiFetch(`/api/devices/vitals/history?type=${readingType}&days=${days}`);
  return handleResponse(response);
}

export async function fetchPinnedParameters() {
  const response = await apiFetch('/api/pinned-parameters');
  return handleResponse(response);
}

export async function pinParameter(healthParameterId) {
  const response = await apiFetch('/api/pinned-parameters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ health_parameter_id: healthParameterId }),
  });
  return handleResponse(response);
}

export async function unpinParameter(healthParameterId) {
  const response = await apiFetch(`/api/pinned-parameters/${healthParameterId}`, { method: 'DELETE' });
  return handleResponse(response);
}

export async function fetchInsights(state = 'active') {
  const response = await apiFetch(`/api/insights?state=${state}`);
  return handleResponse(response);
}

export async function dismissInsight(insightId) {
  const response = await apiFetch(`/api/insights/${insightId}/dismiss`, { method: 'POST' });
  return handleResponse(response);
}

export async function sendInsightFeedback(insightId, feedback) {
  const response = await apiFetch(`/api/insights/${insightId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(response);
}

export async function fetchRetestPlans() {
  const response = await apiFetch('/api/retest');
  return handleResponse(response);
}

export async function snoozeRetestPlan(planId, days = 7) {
  const response = await apiFetch(`/api/retest/${planId}/snooze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  return handleResponse(response);
}

export async function dismissRetestPlan(planId) {
  const response = await apiFetch(`/api/retest/${planId}/dismiss`, { method: 'POST' });
  return handleResponse(response);
}

export async function setRetestCheckin(planId, done) {
  const response = await apiFetch(`/api/retest/${planId}/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
  return handleResponse(response);
}

export async function fetchHealthProfile() {
  const response = await apiFetch('/api/health-profile');
  return handleResponse(response);
}

export async function addWeightEntry(weightKg) {
  const response = await apiFetch('/api/health-profile/weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weightKg }),
  });
  return handleResponse(response);
}

export async function fetchWeightHistory(days = 90) {
  const response = await apiFetch(`/api/health-profile/weight-history?days=${days}`);
  return handleResponse(response);
}

export async function deleteWeightEntry(id) {
  const response = await apiFetch(`/api/health-profile/weight/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return handleResponse(response);
}

export async function addHeightEntry(heightCm) {
  const response = await apiFetch('/api/health-profile/height', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heightCm }),
  });
  return handleResponse(response);
}

export async function addAllergy(allergen) {
  const response = await apiFetch('/api/health-profile/allergies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allergen }),
  });
  return handleResponse(response);
}

export async function removeAllergy(allergyId) {
  const response = await apiFetch(`/api/health-profile/allergies/${allergyId}`, { method: 'DELETE' });
  return handleResponse(response);
}

export async function deleteAccount() {
  const response = await apiFetch('/api/account', { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

// Admin-only (server checks config.adminEmails; the client only ever shows
// this screen when GET /api/auth/me returned isAdmin, and any other account
// gets a 403 from the server itself) session cleanup - see server's
// routes/admin.js.
export async function fetchAdminSessions() {
  const response = await apiFetch('/api/admin/sessions');
  return handleResponse(response);
}

export async function deleteAdminSession(userId) {
  const response = await apiFetch(`/api/admin/sessions/${userId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

// Multi-select delete: deletes exactly the checked-off logins in one request.
export async function bulkDeleteAdminSessions(userIds) {
  const response = await apiFetch('/api/admin/sessions/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
  return handleResponse(response);
}

export async function cleanupGuestSessions() {
  const response = await apiFetch('/api/admin/sessions/cleanup/guests', { method: 'DELETE' });
  return handleResponse(response);
}

export async function updateRetestSettings(remindersEnabled) {
  const response = await apiFetch('/api/account/retest-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remindersEnabled }),
  });
  return handleResponse(response);
}

export async function registerPushToken(token, platform) {
  const response = await apiFetch('/api/account/push-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform }),
  });
  return handleResponse(response);
}

// Privacy & AI consents for the active profile (the signed-in account, or
// a managed family member the caregiver decides for).
export async function fetchConsents() {
  const response = await apiFetch('/api/consents');
  return handleResponse(response);
}

// AI apps (Claude, ChatGPT) the signed-in account connected through the MCP
// connector - listed and disconnected here (server: routes/connectedApps.js).
export async function fetchConnectedApps() {
  const response = await apiFetch('/api/connected-apps');
  return handleResponse(response);
}

export async function disconnectConnectedApp(id) {
  const response = await apiFetch(`/api/connected-apps/${id}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function setConsent(type, granted) {
  const response = await apiFetch(`/api/consents/${type}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ granted, platform: Platform.OS }),
  });
  return handleResponse(response);
}

export async function fetchFamily() {
  const response = await apiFetch('/api/family');
  return handleResponse(response);
}

export async function createFamilyMember(displayName, relation) {
  const response = await apiFetch('/api/family/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, relation }),
  });
  return handleResponse(response);
}

export async function updateFamilyMember(memberId, changes) {
  const response = await apiFetch(`/api/family/members/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function removeFamilyMember(memberId) {
  const response = await apiFetch(`/api/family/members/${memberId}`, { method: 'DELETE' });
  return handleResponse(response);
}

// role: 'caretaker' (default) or 'sponsor' - a sponsor only ever gets the
// summary dashboard and is always view-only.
export async function createFamilyInvite({ profileId, access, role }) {
  const response = await apiFetch('/api/family/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, access, role }),
  });
  return handleResponse(response);
}

// Summary of everyone the signed-in account sponsors or takes care of.
export async function fetchBeneficiaryDashboard() {
  const response = await apiFetch('/api/family/dashboard');
  return handleResponse(response);
}

export async function redeemFamilyInvite(code) {
  const response = await apiFetch('/api/family/invites/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return handleResponse(response);
}

export async function revokeFamilyAccess(userId) {
  const response = await apiFetch(`/api/family/shared-with/${userId}`, { method: 'DELETE' });
  return handleResponse(response);
}

export async function createChatSession() {
  const response = await apiFetch('/api/chat/sessions', { method: 'POST' });
  return handleResponse(response);
}

export async function fetchChatMessages(sessionId) {
  const response = await apiFetch(`/api/chat/sessions/${sessionId}/messages`);
  return handleResponse(response);
}

export async function sendChatMessage(sessionId, message) {
  const response = await apiFetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return handleResponse(response);
}

export async function fetchMedications() {
  const response = await apiFetch('/api/medications');
  return handleResponse(response);
}

export async function fetchMedication(medicationId) {
  const response = await apiFetch(`/api/medications/${medicationId}`);
  return handleResponse(response);
}

export async function createMedication(fields) {
  const response = await apiFetch('/api/medications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function updateMedication(medicationId, changes) {
  const response = await apiFetch(`/api/medications/${medicationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function confirmMedication(medicationId) {
  const response = await apiFetch(`/api/medications/${medicationId}/confirm`, { method: 'POST' });
  return handleResponse(response);
}

export async function deleteMedication(medicationId) {
  const response = await apiFetch(`/api/medications/${medicationId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function uploadMedicationScan(file, scanType) {
  const formData = new FormData();
  if (file.file) {
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    });
  }
  formData.append('scan_type', scanType);

  const response = await apiFetch('/api/medications/scans', {
    method: 'POST',
    body: formData,
    // Do not set Content-Type manually - see uploadReport() above.
  });
  return handleResponse(response);
}

export async function fetchMedicationScan(scanId) {
  const response = await apiFetch(`/api/medications/scans/${scanId}`);
  return handleResponse(response);
}

export async function retryMedicationScan(scanId) {
  const response = await apiFetch(`/api/medications/scans/${scanId}/retry`, { method: 'POST' });
  return handleResponse(response);
}

export async function uploadMedicationPhoto(medicationId, file, source) {
  const formData = new FormData();
  if (file.file) {
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    });
  }
  if (source) formData.append('source', source);

  const response = await apiFetch(`/api/medications/${medicationId}/photos`, {
    method: 'POST',
    body: formData,
    // Do not set Content-Type manually - see uploadReport() above.
  });
  return handleResponse(response);
}

export async function fetchMedicationPhotoUrl(medicationId, photoId) {
  const response = await apiFetch(`/api/medications/${medicationId}/photos/${photoId}/file-url`);
  const data = await handleResponse(response);
  // Server-relative - see fetchReportFileUrl() above for why it's made
  // absolute here rather than through apiFetch.
  return `${API_BASE_URL}${data.url}`;
}

export async function deleteMedicationPhoto(medicationId, photoId) {
  const response = await apiFetch(`/api/medications/${medicationId}/photos/${photoId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function fetchMedicationAlerts(state = 'active') {
  const response = await apiFetch(`/api/medications/alerts?state=${state}`);
  return handleResponse(response);
}

export async function dismissMedicationAlert(alertId) {
  const response = await apiFetch(`/api/medications/alerts/${alertId}/dismiss`, { method: 'POST' });
  return handleResponse(response);
}

// Dose reminders: independent of lab reports. `date` is the caller's local
// YYYY-MM-DD so "today" matches the person's own day, not the server's.
export async function fetchMedicationReminders(date) {
  const response = await apiFetch(`/api/medications/reminders/today?date=${date}`);
  return handleResponse(response);
}

export async function logMedicationDose(medicationId, slot, status, date) {
  const response = await apiFetch(`/api/medications/${medicationId}/doses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, status, date }),
  });
  return handleResponse(response);
}

export async function uploadDietScan(file, consumedAt) {
  const formData = new FormData();
  if (file.file) {
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    });
  }
  if (consumedAt) formData.append('consumed_at', consumedAt);

  const response = await apiFetch('/api/diet/scans', {
    method: 'POST',
    body: formData,
    // Do not set Content-Type manually - see uploadReport() above.
  });
  return handleResponse(response);
}

export async function fetchDietScan(scanId) {
  const response = await apiFetch(`/api/diet/scans/${scanId}`);
  return handleResponse(response);
}

export async function retryDietScan(scanId) {
  const response = await apiFetch(`/api/diet/scans/${scanId}/retry`, { method: 'POST' });
  return handleResponse(response);
}

export async function fetchDietEntries(filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const response = await apiFetch(`/api/diet/entries?${params.toString()}`);
  return handleResponse(response);
}

export async function fetchFoodEntry(entryId) {
  const response = await apiFetch(`/api/diet/entries/${entryId}`);
  return handleResponse(response);
}

export async function estimateFoodNutrition(fields) {
  const response = await apiFetch('/api/diet/entries/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function createFoodEntry(fields) {
  const response = await apiFetch('/api/diet/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function updateFoodEntry(entryId, changes) {
  const response = await apiFetch(`/api/diet/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function confirmFoodEntry(entryId) {
  const response = await apiFetch(`/api/diet/entries/${entryId}/confirm`, { method: 'POST' });
  return handleResponse(response);
}

export async function deleteFoodEntry(entryId) {
  const response = await apiFetch(`/api/diet/entries/${entryId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function fetchDietSummary(days = 7) {
  const response = await apiFetch(`/api/diet/summary?days=${days}`);
  return handleResponse(response);
}

export async function fetchDietRecommendations(refresh = false) {
  const response = await apiFetch(`/api/diet/recommendations${refresh ? '?refresh=true' : ''}`);
  return handleResponse(response);
}

export async function generateDietRecipe(fields) {
  const response = await apiFetch('/api/diet/recipes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

// The signed-in user's already-generated recipe suggestions (see
// dietRecipeService.saveRecipeSuggestions server-side) - a free read, no AI
// call. Backs both the Recipes screen on open and the Diet screen's
// quick-pick list, so returning to either never re-spends tokens on ideas
// already generated.
export async function fetchSavedRecipes({ mealType, limit } = {}) {
  const params = new URLSearchParams();
  if (mealType) params.set('meal_type', mealType);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const response = await apiFetch(`/api/diet/recipes/feed${query ? `?${query}` : ''}`);
  return handleResponse(response);
}

// Generates a new batch of AI recipe ideas - this is the only diet-recipe
// call that spends AI tokens, so it only ever fires from an explicit
// "Generate" tap, never automatically. Every recipe returned is already
// saved server-side (it comes back with an id) - see fetchSavedRecipes
// above to read it back later at no cost. excludeTitles carries every
// title already shown so the new batch doesn't repeat them.
export async function generateRecipeFeed({ mealType, excludeTitles = [], limit = 5 } = {}) {
  const response = await apiFetch('/api/diet/recipes/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_type: mealType || undefined, exclude_titles: excludeTitles, limit }),
  });
  return handleResponse(response);
}

// Logs a saved recipe suggestion as a food_entries row - the "select this
// as my diet" action, used from both the Recipes screen and the Diet
// screen's quick-pick list. No AI call: the nutrition was already
// estimated when the recipe was generated.
export async function logRecipeSuggestion(recipeSuggestionId, { consumedAt } = {}) {
  const response = await apiFetch(`/api/diet/recipes/${recipeSuggestionId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumed_at: consumedAt || undefined }),
  });
  return handleResponse(response);
}

export async function fetchGmailStatus() {
  const response = await apiFetch('/api/integrations/gmail/status');
  return handleResponse(response);
}

export async function fetchGmailConnectUrl() {
  const response = await apiFetch('/api/integrations/gmail/connect');
  return handleResponse(response);
}

export async function disconnectGmail() {
  const response = await apiFetch('/api/integrations/gmail/disconnect', { method: 'DELETE' });
  return handleResponse(response);
}

export async function searchGmailCandidates(sinceDays) {
  const response = await apiFetch('/api/integrations/gmail/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sinceDays ? { sinceDays } : {}),
  });
  return handleResponse(response);
}

export async function importGmailSelections(selections) {
  const response = await apiFetch('/api/integrations/gmail/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selections }),
  });
  return handleResponse(response);
}

export async function fetchGmailDocuments() {
  const response = await apiFetch('/api/integrations/gmail/documents');
  return handleResponse(response);
}

export async function fetchRecipePreferences() {
  const response = await apiFetch('/api/recipe-preferences');
  return handleResponse(response);
}

export async function saveRecipePreferences(dietTypes, cuisines) {
  const response = await apiFetch('/api/recipe-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dietTypes, cuisines }),
  });
  return handleResponse(response);
}

export async function fetchWeightGoal() {
  const response = await apiFetch('/api/weight-goal');
  return handleResponse(response);
}

export async function saveWeightGoal({ currentWeightKg, targetWeightKg, targetDate }) {
  const response = await apiFetch('/api/weight-goal', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentWeightKg, targetWeightKg, targetDate }),
  });
  return handleResponse(response);
}

// --- Mini kitchen (pantry) ---

export async function fetchKitchenItems({ category, search, availableOnly } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  if (availableOnly) params.set('available_only', 'true');
  const query = params.toString();
  const response = await apiFetch(`/api/kitchen/items${query ? `?${query}` : ''}`);
  return handleResponse(response);
}

export async function addKitchenItem(fields) {
  const response = await apiFetch('/api/kitchen/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function updateKitchenItem(itemId, fields) {
  const response = await apiFetch(`/api/kitchen/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function deleteKitchenItem(itemId) {
  const response = await apiFetch(`/api/kitchen/items/${itemId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

// --- Diet schedules ---

export async function fetchDietSchedules() {
  const response = await apiFetch('/api/diet-schedules');
  return handleResponse(response);
}

export async function fetchDietSchedule(scheduleId) {
  const response = await apiFetch(`/api/diet-schedules/${scheduleId}`);
  return handleResponse(response);
}

export async function createManualDietSchedule({ title, durationDays, startDate, entries }) {
  const response = await apiFetch('/api/diet-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      duration_days: durationDays,
      start_date: startDate,
      entries: entries.map((e) => ({ day_number: e.dayNumber, meal_type: e.mealType, dish_name: e.dishName })),
    }),
  });
  return handleResponse(response);
}

export async function generateDietScheduleFromKitchen({ title, durationDays, startDate, kitchenItemIds, mealTypesPerDay }) {
  const response = await apiFetch('/api/diet-schedules/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      duration_days: durationDays,
      start_date: startDate,
      kitchen_item_ids: kitchenItemIds,
      meal_types_per_day: mealTypesPerDay,
    }),
  });
  return handleResponse(response);
}

// Same {uri, name, mimeType, file} shape the document/image pickers hand
// back everywhere else (see uploadReport/uploadDietScan above) - any format
// the report pipeline already reads (PDF/DOCX/XLSX/CSV/photo) works here too.
export async function importDietSchedule(file, { durationDays, startDate }) {
  const formData = new FormData();
  if (file.file) {
    formData.append('file', file.file, file.name);
  } else {
    formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' });
  }
  formData.append('duration_days', String(durationDays));
  formData.append('start_date', startDate);

  const response = await apiFetch('/api/diet-schedules/import', { method: 'POST', body: formData });
  return handleResponse(response);
}

export async function fetchDietScheduleImport(importId) {
  const response = await apiFetch(`/api/diet-schedules/imports/${importId}`);
  return handleResponse(response);
}

export async function deleteDietSchedule(scheduleId) {
  const response = await apiFetch(`/api/diet-schedules/${scheduleId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function updateDietScheduleEntry(entryId, { dishName, mealType }) {
  const response = await apiFetch(`/api/diet-schedules/entries/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dish_name: dishName, meal_type: mealType }),
  });
  return handleResponse(response);
}

export async function logDietScheduleEntry(entryId, consumedAt) {
  const response = await apiFetch(`/api/diet-schedules/entries/${entryId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumed_at: consumedAt || undefined }),
  });
  return handleResponse(response);
}

export async function retryDietScheduleEntryRecipe(entryId) {
  const response = await apiFetch(`/api/diet-schedules/entries/${entryId}/retry-recipe`, { method: 'POST' });
  return handleResponse(response);
}

export async function fetchDietScheduleImpact(scheduleId, { refresh } = {}) {
  const path = refresh ? `/api/diet-schedules/${scheduleId}/impact/refresh` : `/api/diet-schedules/${scheduleId}/impact`;
  const response = await apiFetch(path, refresh ? { method: 'POST' } : undefined);
  return handleResponse(response);
}

// --- Water intake ---

export async function fetchWaterSummary(date) {
  const response = await apiFetch(`/api/water/summary${date ? `?date=${date}` : ''}`);
  return handleResponse(response);
}

export async function fetchWaterHistory(days = 14) {
  const response = await apiFetch(`/api/water/history?days=${days}`);
  return handleResponse(response);
}

export async function logWaterEntry(amountMl, loggedAt) {
  const response = await apiFetch('/api/water/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount_ml: amountMl, logged_at: loggedAt || undefined }),
  });
  return handleResponse(response);
}

export async function deleteWaterEntry(entryId) {
  const response = await apiFetch(`/api/water/entries/${entryId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function refreshWaterTarget() {
  const response = await apiFetch('/api/water/target/refresh', { method: 'POST' });
  return handleResponse(response);
}

export async function updateWaterSettings(remindersEnabled) {
  const response = await apiFetch('/api/account/water-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remindersEnabled }),
  });
  return handleResponse(response);
}

// --- Recipe reactions (Love/Like/Unlike) ---

export async function fetchRecipeReactions(recipeSuggestionIds) {
  if (!recipeSuggestionIds || recipeSuggestionIds.length === 0) return { reactions: {} };
  const response = await apiFetch(`/api/recipe-reactions?ids=${recipeSuggestionIds.join(',')}`);
  return handleResponse(response);
}

export async function setRecipeReaction(recipeSuggestionId, reactionType) {
  const response = await apiFetch(`/api/recipe-reactions/${recipeSuggestionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reactionType }),
  });
  return handleResponse(response);
}

export async function clearRecipeReaction(recipeSuggestionId) {
  const response = await apiFetch(`/api/recipe-reactions/${recipeSuggestionId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export { API_BASE_URL };

// ---- My Insurance ----------------------------------------------------------

export async function fetchInsurance() {
  const response = await apiFetch('/api/insurance');
  return handleResponse(response);
}

export async function fetchInsuranceSummary() {
  const response = await apiFetch('/api/insurance/summary');
  return handleResponse(response);
}

export async function fetchInsurancePolicy(policyId) {
  const response = await apiFetch(`/api/insurance/${policyId}`);
  return handleResponse(response);
}

export async function updateInsurancePolicy(policyId, changes) {
  const response = await apiFetch(`/api/insurance/${policyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function confirmInsurancePolicy(policyId) {
  const response = await apiFetch(`/api/insurance/${policyId}/confirm`, { method: 'POST' });
  return handleResponse(response);
}

export async function retryInsurancePolicy(policyId) {
  const response = await apiFetch(`/api/insurance/${policyId}/retry`, { method: 'POST' });
  return handleResponse(response);
}

export async function deleteInsurancePolicy(policyId) {
  const response = await apiFetch(`/api/insurance/${policyId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function addInsuranceItem(policyId, fields) {
  const response = await apiFetch(`/api/insurance/${policyId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

export async function updateInsuranceItem(policyId, itemId, changes) {
  const response = await apiFetch(`/api/insurance/${policyId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function deleteInsuranceItem(policyId, itemId) {
  const response = await apiFetch(`/api/insurance/${policyId}/items/${itemId}`, { method: 'DELETE' });
  if (!response.ok) return handleResponse(response);
  return null;
}

export async function updateInsuranceSettings(remindersEnabled) {
  const response = await apiFetch('/api/account/insurance-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remindersEnabled }),
  });
  return handleResponse(response);
}
