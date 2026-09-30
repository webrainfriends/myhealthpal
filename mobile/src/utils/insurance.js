import { Linking, Platform, Share } from 'react-native';

// Small helpers shared by the My Insurance screens.

export function formatMoney(amount, currency) {
  const n = Number(amount);
  if (amount === null || amount === undefined || !Number.isFinite(n)) return null;
  return `${currency ? `${currency} ` : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Cleans a number for a tel: link (keeps a leading +, digits, and * #).
function dialable(phone) {
  return String(phone || '').replace(/[^\d+*#]/g, '');
}

export function callNumber(phone) {
  const number = dialable(phone);
  if (!number) return Promise.resolve();
  return Linking.openURL(`tel:${number}`).catch((err) => console.warn('Could not open the dialer', err.message));
}

export function emailTo(address, subject, body) {
  if (!address) return Promise.resolve();
  const query = [subject ? `subject=${encodeURIComponent(subject)}` : null, body ? `body=${encodeURIComponent(body)}` : null]
    .filter(Boolean)
    .join('&');
  return Linking.openURL(`mailto:${address}${query ? `?${query}` : ''}`).catch((err) => console.warn('Could not open mail', err.message));
}

export function openWebsite(url) {
  if (!url) return Promise.resolve();
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return Linking.openURL(href).catch((err) => console.warn('Could not open the website', err.message));
}

// Hands a drafted message to the system share sheet; on web (no share
// sheet) copies it to the clipboard when the browser allows.
export async function shareDraft(message) {
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard.writeText(message);
      return 'copied';
    } catch (err) {
      return 'failed';
    }
  }
  try {
    await Share.share({ message });
    return 'shared';
  } catch (err) {
    return 'failed';
  }
}

// "Acme Health – Gold" style label already comes from the server as
// `label`; an entry only has policyName. Kept here so screens agree on the
// fallback wording.
export function policyDisplayName(policy) {
  return policy?.label || policy?.policyName || policy?.originalFilename || 'Policy';
}

// Lookup for the coverage verdict -> i18n key.
export const COVERAGE_LABEL_KEYS = {
  covered: 'insurance.covered',
  partial: 'insurance.partial',
  not_covered: 'insurance.notCovered',
  not_mentioned: 'insurance.notMentioned',
};

export const CEILING_BASIS_KEYS = {
  per_illness: 'insurance.basisPerIllness',
  per_year: 'insurance.basisPerYear',
  per_claim: 'insurance.basisPerClaim',
  lifetime: 'insurance.basisLifetime',
  sum_insured: 'insurance.basisSumInsured',
};

// Whether an item/entry set has any clause the person can tap into.
export function hasClauseDetail(item) {
  return Boolean(item && (item.clauseText || item.clauseReference || item.ceilingAmount || item.copayPercent));
}

// Mirrors INSURANCE_ORGANS in server/src/insurance/insuranceRules.js (key,
// label, icon) - the choices offered when adding or re-filing a clause.
export const INSURANCE_ORGANS = [
  { key: 'heart', label: 'Heart & circulation', icon: '❤️' },
  { key: 'diabetes', label: 'Diabetes', icon: '💉' },
  { key: 'kidney', label: 'Kidney & urinary', icon: '🫘' },
  { key: 'liver_pancreas', label: 'Liver & pancreas', icon: '🔥' },
  { key: 'blood', label: 'Blood', icon: '🩸' },
  { key: 'thyroid_endocrine', label: 'Thyroid & hormones', icon: '⚗️' },
  { key: 'brain_nerves', label: 'Brain & nerves', icon: '🧠' },
  { key: 'bones_joints', label: 'Bones & joints', icon: '🦴' },
  { key: 'cancer', label: 'Cancer', icon: '🎗️' },
  { key: 'infections', label: 'Infections & immunity', icon: '🛡️' },
  { key: 'digestive', label: 'Digestive system', icon: '🍽️' },
  { key: 'respiratory', label: 'Lungs & breathing', icon: '🫁' },
  { key: 'eye', label: 'Eyes', icon: '👁️' },
  { key: 'ent', label: 'Ear, nose & throat', icon: '👂' },
  { key: 'skin', label: 'Skin', icon: '🧴' },
  { key: 'reproductive_maternity', label: 'Reproductive & maternity', icon: '🤰' },
  { key: 'mental_health', label: 'Mental health', icon: '🧘' },
  { key: 'dental', label: 'Dental', icon: '🦷' },
  { key: 'general', label: 'General / whole policy', icon: '📄' },
];

export function organInfo(key) {
  return INSURANCE_ORGANS.find((organ) => organ.key === key) || INSURANCE_ORGANS[INSURANCE_ORGANS.length - 1];
}
