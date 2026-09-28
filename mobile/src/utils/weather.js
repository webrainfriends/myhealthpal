// Local weather + air quality for the dashboard banner, from the device's
// current location. Open-Meteo is used because both of its endpoints are
// free, keyless, and CORS-enabled, so it works from the mobile client (and
// the web build) without routing through our own API.
import * as Location from 'expo-location';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

// WMO weather codes (the `weather_code` Open-Meteo returns) collapsed down to
// one emoji each - https://open-meteo.com/en/docs#weathervariables.
const WEATHER_ICONS = {
  0: '☀️',
  1: '🌤️',
  2: '⛅',
  3: '☁️',
  45: '🌫️',
  48: '🌫️',
  51: '🌦️',
  53: '🌦️',
  55: '🌦️',
  56: '🌧️',
  57: '🌧️',
  61: '🌧️',
  63: '🌧️',
  65: '🌧️',
  66: '🌧️',
  67: '🌧️',
  71: '🌨️',
  73: '🌨️',
  75: '🌨️',
  77: '🌨️',
  80: '🌦️',
  81: '🌧️',
  82: '⛈️',
  85: '🌨️',
  86: '🌨️',
  95: '⛈️',
  96: '⛈️',
  99: '⛈️',
};

function iconForWeatherCode(code) {
  return WEATHER_ICONS[code] || '🌡️';
}

// US AQI breakpoints (EPA, https://www.airnow.gov/aqi/aqi-basics/), mapped to
// i18n keys under dashboard.aqi.*.
function categoryForAqi(aqi) {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

// Resolves to null (rather than throwing) whenever weather can't be shown -
// permission denied, location unavailable, both requests failing - so a
// banner widget can just skip rendering instead of surfacing an error.
export async function fetchLocationWeather() {
  let permission;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    permission = current.status;
    if (permission !== 'granted') {
      const requested = await Location.requestForegroundPermissionsAsync();
      permission = requested.status;
    }
  } catch {
    return null;
  }
  if (permission !== 'granted') return null;

  let coords;
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    coords = position.coords;
  } catch {
    return null;
  }

  const { latitude, longitude } = coords;
  const [forecastResult, airQualityResult] = await Promise.allSettled([
    fetch(`${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`),
    fetch(`${AIR_QUALITY_URL}?latitude=${latitude}&longitude=${longitude}&current=us_aqi`),
  ]);

  const data = {};

  if (forecastResult.status === 'fulfilled' && forecastResult.value.ok) {
    const body = await forecastResult.value.json();
    if (body.current?.temperature_2m !== undefined) {
      data.temperature = Math.round(body.current.temperature_2m);
      data.temperatureUnit = body.current_units?.temperature_2m || '°C';
      data.weatherIcon = iconForWeatherCode(body.current.weather_code);
    }
  }

  if (airQualityResult.status === 'fulfilled' && airQualityResult.value.ok) {
    const body = await airQualityResult.value.json();
    if (body.current?.us_aqi !== undefined && body.current.us_aqi !== null) {
      data.aqi = Math.round(body.current.us_aqi);
      data.aqiCategory = categoryForAqi(data.aqi);
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}
