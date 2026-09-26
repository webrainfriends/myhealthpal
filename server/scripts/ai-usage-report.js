// Operator report: AI token usage and estimated cost per user over the last
// N days (default 30) - the input for sizing per-user plans and a
// commercial cost model. Reads the ai_usage_events ledger directly; run on
// the server host with DATABASE_URL set:
//
//   npm run ai-usage-report            # last 30 days, table
//   npm run ai-usage-report -- 90      # last 90 days
//   npm run ai-usage-report -- 30 --csv
require('dotenv').config();
const pool = require('../src/db/pool');
const { getAllUsersUsageReport } = require('../src/services/aiUsageService');

async function main() {
  const args = process.argv.slice(2);
  const days = Number.parseInt(args.find((a) => /^\d+$/.test(a)), 10) || 30;
  const csv = args.includes('--csv');
  const rows = await getAllUsersUsageReport({ days });

  if (csv) {
    console.log('user_id,email,auth_provider,sessions,requests,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,total_tokens,estimated_cost_usd');
    for (const r of rows) {
      console.log(
        [r.userId ?? '', r.email ?? '', r.authProvider ?? '', r.sessions, r.requests, r.inputTokens, r.outputTokens,
          r.cacheWriteTokens, r.cacheReadTokens, r.totalTokens, r.estimatedCostUsd.toFixed(6)].join(',')
      );
    }
    return;
  }

  const users = rows.filter((r) => r.userId);
  const total = rows.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  console.log(`AI usage, last ${days} days - ${users.length} active users, est. $${total.toFixed(4)} total`);
  if (users.length > 0) {
    console.log(`Average est. cost per active user: $${(users.reduce((s, r) => s + r.estimatedCostUsd, 0) / users.length).toFixed(4)}`);
  }
  console.table(
    rows.map((r) => ({
      user: r.email || r.userId || '(no user / deleted)',
      provider: r.authProvider || '',
      sessions: r.sessions,
      requests: r.requests,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      estCostUsd: r.estimatedCostUsd.toFixed(4),
    }))
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
