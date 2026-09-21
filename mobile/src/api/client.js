import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

async function handleResponse(response) {
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(body?.error || `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchSupportedFormats() {
  const response = await fetch(`${API_BASE_URL}/api/config/supported-formats`);
  return handleResponse(response);
}

export async function fetchReports() {
  const response = await fetch(`${API_BASE_URL}/api/reports`);
  return handleResponse(response);
}

export async function fetchReport(reportId) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}`);
  return handleResponse(response);
}

export async function uploadReport(file) {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/octet-stream',
  });

  const response = await fetch(`${API_BASE_URL}/api/reports`, {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return handleResponse(response);
}

export async function retryReport(reportId) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}/retry`, { method: 'POST' });
  return handleResponse(response);
}

export async function updateMeasurement(reportId, measurementId, changes) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}/measurements/${measurementId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  return handleResponse(response);
}

export async function confirmReport(reportId) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}/confirm`, { method: 'POST' });
  return handleResponse(response);
}

export async function searchHealthParameters(query) {
  const response = await fetch(`${API_BASE_URL}/api/health-parameters?search=${encodeURIComponent(query || '')}`);
  return handleResponse(response);
}

export async function updateReportDate(reportId, effectiveDate) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effective_date: effectiveDate }),
  });
  return handleResponse(response);
}

export async function fetchTimeline(filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const response = await fetch(`${API_BASE_URL}/api/timeline?${params.toString()}`);
  return handleResponse(response);
}

export async function fetchDashboardSnapshot() {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/snapshot`);
  return handleResponse(response);
}

export async function fetchParameterTrend(code, range = '90d') {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/parameters/${code}/trend?range=${range}`);
  return handleResponse(response);
}

export async function fetchPinnedParameters() {
  const response = await fetch(`${API_BASE_URL}/api/pinned-parameters`);
  return handleResponse(response);
}

export async function pinParameter(healthParameterId) {
  const response = await fetch(`${API_BASE_URL}/api/pinned-parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ health_parameter_id: healthParameterId }),
  });
  return handleResponse(response);
}

export async function unpinParameter(healthParameterId) {
  const response = await fetch(`${API_BASE_URL}/api/pinned-parameters/${healthParameterId}`, { method: 'DELETE' });
  return handleResponse(response);
}

export async function fetchInsights(state = 'active') {
  const response = await fetch(`${API_BASE_URL}/api/insights?state=${state}`);
  return handleResponse(response);
}

export async function dismissInsight(insightId) {
  const response = await fetch(`${API_BASE_URL}/api/insights/${insightId}/dismiss`, { method: 'POST' });
  return handleResponse(response);
}

export async function sendInsightFeedback(insightId, feedback) {
  const response = await fetch(`${API_BASE_URL}/api/insights/${insightId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  return handleResponse(response);
}

export async function createChatSession() {
  const response = await fetch(`${API_BASE_URL}/api/chat/sessions`, { method: 'POST' });
  return handleResponse(response);
}

export async function fetchChatMessages(sessionId) {
  const response = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/messages`);
  return handleResponse(response);
}

export async function sendChatMessage(sessionId, message) {
  const response = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return handleResponse(response);
}

export { API_BASE_URL };
