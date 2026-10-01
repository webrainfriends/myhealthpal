const config = require('../../config');
const uploadLinks = require('../uploadLinks');
const { CATEGORIES } = require('../../services/documentClassificationService');
const { writeTool } = require('./helpers');

const createUploadLink = writeTool({
  name: 'create_upload_link',
  description:
    'Get a one-time link where the user can upload a file (lab report, insurance policy, meal photo, diet plan) into EyeMyHealth. ' +
    'You cannot send files yourself: give the user the link, tell them to open it and choose the file, then check back with get_latest_report / list_timeline / get_insurance_overview. ' +
    `The link expires in ${uploadLinks.TTL_SECONDS / 60} minutes and works once. Leave category unset to let EyeMyHealth work out the type.`,
  scope: 'health:write',
  properties: { category: { type: 'string', enum: ['auto', ...CATEGORIES], description: 'Optional hint. Default: auto-detect.' } },
  async execute(args, { userId, account, grantId }) {
    const category = args.category && ['auto', ...CATEGORIES].includes(args.category) ? args.category : 'auto';
    const token = uploadLinks.issue({ grantId, accountId: account.id, subjectId: userId, category });
    return {
      data: {
        url: `${config.publicBaseUrl}/mcp-upload/${token}`,
        expiresInMinutes: uploadLinks.TTL_SECONDS / 60,
        instruction: 'Tell the user to open this link and pick the file. It works once.',
      },
      evidence: [],
    };
  },
});

module.exports = [createUploadLink];
