# Retention strategy and market research

Research from September 2026: competitor apps (Google Play, App Store, web), adoption by region, and positioning. Several app-store pages were blocked during research, so some competitor details come from search results; check them in the stores before relying on them.

## 1. Competitors
**Uploading a report and getting an AI explanation is now a commodity.**
- **India:** Eka Care (14M+ downloads, 4.7★, with ABHA, family profiles and trends), DRiefcase, Health-e, the government ABHA app, and Tata 1mg's AI report reader.
- **Global and US:** Apple Health (2026 redesign that reads lab trends and sells Quest tests in the app), Google Health (Gemini coach), ChatGPT Health (US, 2026, with a "changes since last visit" summary), Function Health, Superpower, InsideTracker, Carrot Care, Kantesti, Wizey, Docus.
- **UK:** Thriva, Medichecks.
- **Middle East and SE Asia:** few strong regional apps that interpret uploaded reports. These regions look underserved.

**Commodity, so not a pitch on its own:** extracting values from reports, plain-language summaries, trend charts, chat over your own data, family profiles (standard in India), multiple languages, and an emergency card.

**Rare or not found in any consumer app:**
- **Medicines linked to lab values** (for example "you started metformin, so watch B12", or "statin, so watch ALT"). Already built: `server/src/medications/medicationLinkingService.js` and `medicationForecastService.js`.
- **A retest due date set by the abnormal value and by the medicine's typical onset time.** Carrot Care only has reminders you set yourself.
- **Diet photos linked to the user's own lab values.** Kantesti only generates meal plans.
- **Gmail auto-import.** Competitors ask users to forward reports by WhatsApp or email.
- **Voice readout in Indian languages** for older parents.
- **A forecast of the next report.** Not found anywhere.

**Gaps, what competitors have that EyeMyHealth lacks:**
- ABHA/ABDM linking (table stakes in India)
- Uploading reports through WhatsApp
- Booking a test or home sample collection, which is needed to close the retest loop
- Push reminders
- Wearables sync
- Sending a flagged result to a doctor for review
- Chart milestones, such as "started medicine here"

**Why users leave competitors:** values read wrongly (for example "5,6" read as 56), aggressive upselling, no human support, and the one-time-use pattern.

## 2. Adoption by region
- **India:** about 900M ABHA health IDs and 1B linked records, but real use of health-record apps is low. There are 101M people with diabetes and 136M with prediabetes; each needs HbA1c every 3–6 months. Vitamin D deficiency runs 70–90%. Two-thirds of people over 60 have a chronic disease. Willingness to pay is low, so the payer is the adult child.
- **Gulf states:** vitamin D deficiency around 85%, about 17% diabetes in an Abu Dhabi study, high-income Indian expats. The UAE requires health data to stay in the country, so start with expats paying for parents whose data sits in India.
- **US:** 65% use a patient portal (69% of people with a chronic condition). Function Health shows people will pay (about $100M a year of revenue at $365 per year). Crowded with free offerings from Big Tech. Keep the product framed as wellness and information only.
- **UK/EU:** AI interpretation of results is likely a Class IIa medical device plus AI Act obligations. The NHS App has 39M registrations. Wait on this market.
- **Retention benchmark:** health apps keep about 3–4% of users at day 30. Engagement comes from chronic conditions, reminders and caregiver use.

## 3. Positioning: what to take to market
**"The health eye on your parents: it knows what to recheck, when, and why."**
The target is India first, with Indian expats in the Gulf, US and UK as the payers.

Competitors are report lockers or report explainers. EyeMyHealth becomes the app that **watches between reports**, and it does so for your family. The pieces that make it unique already exist in the code or are small to add:
1. **Retest Radar.** A due date driven by each abnormal value and by how long the linked medicine usually takes to work. Every week it gives one small action tied to diet and activity. It sends a push reminder and ends with "book the test".
2. **Family Health Eye.** An adult child, including one abroad, follows a parent's due dates and flags. The parent hears results read aloud in their own language.
3. **Medicine ↔ lab watch.** "Dad started metformin 6 months ago. His B12 check is due."
4. **Zero-effort input.** Gmail import already exists; add WhatsApp next. Parents never have to open the app.

Pricing: free for yourself, a paid Family plan (per parent or per household).

## 4. Build order

1. **Retest Radar + push reminders**: built (see README, "Retest Radar").
2. **Family/caregiver profiles**: data is keyed only by `user_id` today, so this needs a `profiles` table, per-person tables moved onto `profile_id`, and an invite/share flow.
3. **ABHA link, WhatsApp upload, a lab-booking partner link, and medicine milestones on trend charts.**
