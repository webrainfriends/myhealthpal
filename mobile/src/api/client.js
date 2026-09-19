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

export async function updateParameter(reportId, parameterId, changes) {
  const response = await fetch(`${API_BASE_URL}/api/reports/${reportId}/parameters/${parameterId}`, {
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

export { API_BASE_URL };
