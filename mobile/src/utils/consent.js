// Uploads are refused (409 consent_required) until the person has agreed to
// medical-record storage on the Privacy & AI screen. Screens that upload
// call this from their catch block: it opens that screen and returns true,
// so the caller skips its generic error alert.
export function openPrivacyIfConsentNeeded(err, navigation) {
  if (err?.code === 'consent_required' || err?.code === 'ai_consent_required') {
    navigation.navigate('PrivacyConsent', { reason: err.code, consentType: err.consentType });
    return true;
  }
  return false;
}
