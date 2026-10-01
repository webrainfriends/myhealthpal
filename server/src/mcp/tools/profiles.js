const familyService = require('../../services/familyService');
const consentService = require('../../security/consentService');

// `accountLevel` tools act for the signed-in account rather than a chosen
// profile, so they ignore `profileId` and never need view-only checks.
const listProfiles = {
  name: 'list_profiles',
  description:
    'List the people this account can look at: the user themself plus any family members they look after. ' +
    'Pass a returned profile id as `profileId` to any other tool to act for that person. ' +
    '`connectorConsent` says whether that person has allowed AI apps to access their records.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  scope: 'health:read',
  accountLevel: true,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async execute(args, { account }) {
    const profiles = await familyService.listProfiles(account);
    const withConsent = await Promise.all(
      profiles.map(async (p) => ({
        id: p.id,
        displayName: p.displayName,
        relation: p.relation,
        access: p.access,
        isSelf: p.isSelf,
        connectorConsent: await consentService.hasConsent(p.id, 'external_ai_connector'),
      }))
    );
    return { data: { profiles: withConsent }, evidence: [] };
  },
};

module.exports = [listProfiles];
