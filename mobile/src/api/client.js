import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { loadToken } from '../auth/tokenStorage';

function defaultBaseUrl() {
  // On web, the app and API are served from the same origin (nginx serves
  // the static build at "/" and proxies "/api/" to the Node app) — a
  // relative base URL means the build works unmodified behind any host.
  if (Platform.OS === 'web') return '';
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

// Every authenticated call funnels through here so the session token is
// attached exactly once, in one place, rather than at each of the 20+ call
// sites below - and so a 401 (expired/invalid/revoked session) is handled
// the same way everywhere: hand the app back to the sign-in screen instead
// of quietly failing or, worse, falling back to some default identity.
async function apiFetch(path, options = {}) {
  const token = loadToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

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

export async function logActivity(fields) {
  const response = await apiFetch('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
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

export async function fetchMedicationAlerts(state = 'active') {
  const response = await apiFetch(`/api/medications/alerts?state=${state}`);
  return handleResponse(response);
}

export async function dismissMedicationAlert(alertId) {
  const response = await apiFetch(`/api/medications/alerts/${alertId}/dismiss`, { method: 'POST' });
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

// Auto-generated, paginated recipe feed for the standalone Recipes screen.
// excludeTitles carries every title already shown so far so a "Load more"
// call doesn't repeat them.
export async function fetchDietRecipeFeed({ mealType, excludeTitles = [], limit = 10 } = {}) {
  const response = await apiFetch('/api/diet/recipes/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_type: mealType || undefined, exclude_titles: excludeTitles, limit }),
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

export { API_BASE_URL };
