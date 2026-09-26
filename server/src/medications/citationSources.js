// Authentic, government-backed (or WHO/NIH) source links used everywhere the
// app shows a medication or reference-range citation to a user - never a
// fabricated or guessed URL. Each entry here was checked against public
// search corroboration for the exact live URL (domain + page) before being
// added; when a system-specific deep page couldn't be confirmed, this falls
// back to that body's own homepage rather than guessing a page that might
// not exist.
//
// MEDICINE_SYSTEMS mirrors the medications.medicine_system DB check
// constraint (migration 021) - keep both in sync.
const MEDICINE_SYSTEMS = ['allopathic', 'ayurvedic', 'homeopathic', 'unani', 'siddha'];

// One canonical "read more about this system" link per medicine system, from
// India's Ministry of AYUSH (the government body that regulates and
// researches Ayurveda, Unani, Siddha and Homeopathy) or, for allopathic, the
// US National Library of Medicine's drug information service.
const SYSTEM_AUTHORITY = {
  allopathic: {
    name: 'MedlinePlus Drug Information (U.S. National Library of Medicine, NIH)',
    url: 'https://medlineplus.gov/druginformation.html',
  },
  ayurvedic: {
    name: 'Central Council for Research in Ayurvedic Sciences (Ministry of AYUSH, Govt. of India)',
    url: 'https://ccras.nic.in/',
  },
  unani: {
    name: 'Central Council for Research in Unani Medicine (Ministry of AYUSH, Govt. of India)',
    url: 'https://ccrum.ayush.gov.in/',
  },
  siddha: {
    name: 'Central Council for Research in Siddha (Ministry of AYUSH, Govt. of India)',
    url: 'https://ccrs.ayush.gov.in/',
  },
  homeopathic: {
    name: 'Central Council for Research in Homoeopathy (Ministry of AYUSH, Govt. of India)',
    url: 'https://ccrhindia.ayush.gov.in/',
  },
};

// National Health Portal of India (nhp.gov.in, Ministry of Health & Family
// Welfare) publishes a plain-language overview of each AYUSH system - a
// gentler companion link to the research-council sites above.
const NHP_SYSTEM_OVERVIEW = {
  ayurvedic: { name: 'National Health Portal of India - Ayurveda', url: 'https://www.nhp.gov.in/ayurveda_mty' },
  unani: { name: 'National Health Portal of India - Unani', url: 'https://www.nhp.gov.in/unani_mty' },
  siddha: { name: 'National Health Portal of India - Siddha', url: 'https://www.nhp.gov.in/siddha_mty' },
  homeopathic: { name: 'National Health Portal of India - Homeopathy', url: 'https://www.nhp.gov.in/homeopathy_mty' },
};

// reference_ranges.source ('who' | 'icmr' | 'fda') -> the issuing body's own
// site, used when a specific range row has no more specific source_url of
// its own on file.
const REFERENCE_SOURCE_FALLBACK = {
  who: { name: 'World Health Organization (WHO)', url: 'https://www.who.int/' },
  icmr: { name: 'Indian Council of Medical Research (ICMR)', url: 'https://www.icmr.gov.in/' },
  fda: { name: 'U.S. Food and Drug Administration (FDA)', url: 'https://www.fda.gov/' },
};

// The general "look this up yourself" link shown alongside an AI-generated
// (uncurated) medication description - deliberately not presented as "this
// fact came from this exact page", since an AI-authored description has no
// single traceable source the way a curated knowledge-base entry does.
function aiFallbackSource(medicineSystem) {
  return SYSTEM_AUTHORITY[medicineSystem] || SYSTEM_AUTHORITY.allopathic;
}

function referenceSourceFor(source, sourceUrl) {
  if (sourceUrl) return { name: REFERENCE_SOURCE_FALLBACK[source]?.name || null, url: sourceUrl };
  const fallback = REFERENCE_SOURCE_FALLBACK[source];
  return fallback ? { name: fallback.name, url: fallback.url } : null;
}

module.exports = {
  MEDICINE_SYSTEMS,
  SYSTEM_AUTHORITY,
  NHP_SYSTEM_OVERVIEW,
  REFERENCE_SOURCE_FALLBACK,
  aiFallbackSource,
  referenceSourceFor,
};
