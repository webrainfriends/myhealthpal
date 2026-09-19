import Constants from 'expo-constants';
import { Platform } from 'react-native';

function defaultBaseUrl() {
  // Android emulators can't reach the host machine via localhost.
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || defaultBaseUrl();

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

export { API_BASE_URL };
