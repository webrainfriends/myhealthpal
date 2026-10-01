const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { runWithContext } = require('../lib/requestContext');
const audit = require('../security/auditLog');
const smartUploadRouter = require('../routes/smartUpload');
const { rateLimit } = require('../oauth/rateLimit');
const { esc } = require('../oauth/authorizePage');
const links = require('./uploadLinks');

const router = express.Router();
const limiter = rateLimit({ limit: 30 });

function headers(res) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
}

function page(subject, category) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add a file to EyeMyHealth</title><style>
:root{--bg:#f7f9fc;--card:#fff;--ink:#1f2937;--muted:#6b7280;--brand:#2f6fed;--line:#e5e7eb}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}main{max-width:30rem;margin:2.5rem auto;padding:0 1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.5rem}h1{font-size:1.25rem;margin:0 0 .5rem}
.muted{color:var(--muted);font-size:.9rem}input[type=file]{margin:1rem 0;max-width:100%}
button{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:.7rem 1.1rem;font:inherit;cursor:pointer}button:disabled{opacity:.6}
#out{margin-top:1rem}.err{color:#b91c1c}.ok{color:#047857}</style></head><body><main><div class="card">
<h1>Add a file for ${esc(subject.display_name || 'you')}</h1>
<p class="muted">Lab reports, insurance policies, meal photos or diet plans (PDF, Word, Excel, CSV, JPG, PNG). The file is encrypted and read the same way as in the EyeMyHealth app. This link works once.</p>
<form id="f"><input type="file" name="file" required><input type="hidden" name="category" value="${esc(category)}">
<div><button id="b" type="submit">Upload</button></div></form><p id="out" role="status"></p></div></main>
<script>
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var b=document.getElementById('b'),o=document.getElementById('out');b.disabled=true;o.className='muted';o.textContent='Uploading…';
fetch(location.pathname,{method:'POST',body:new FormData(e.target)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
if(x.ok){o.className='ok';o.textContent='Uploaded as '+(x.j.categoryLabel||'a document')+'. EyeMyHealth is reading it now - you can go back to your AI assistant.';b.hidden=true}
else{o.className='err';o.textContent=x.j.error||'Upload failed.';b.disabled=false}}).catch(function(){o.className='err';o.textContent='Upload failed. Check your connection.';b.disabled=false})});
</script></body></html>`;
}

function expired(res, err) {
  headers(res);
  const status = err.status || 400;
  if (res.req.method === 'GET') {
    return res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem"><h1>Can't upload</h1><p>${esc(err.message)}</p></body>`);
  }
  return res.status(status).json({ error: err.message });
}

router.get('/:token', limiter, async (req, res) => {
  try {
    const ctx = await links.verify(req.params.token);
    headers(res);
    res.type('html').send(page(ctx.subject, ctx.category));
  } catch (err) {
    if (err instanceof links.UploadLinkError) return expired(res, err);
    throw err;
  }
});

router.post('/:token', limiter, async (req, res, next) => {
  let ctx;
  try {
    ctx = await links.verify(req.params.token);
  } catch (err) {
    if (err instanceof links.UploadLinkError) return expired(res, err);
    return next(err);
  }
  headers(res);
  req.user = ctx.subject;
  req.accountUser = ctx.account;
  req.url = '/';
  // Only a successful upload spends the link, so a rejected file (wrong type,
  // too large) can be retried with the same link.
  res.on('finish', () => {
    if (res.statusCode === 201) links.markUsed(ctx.jti, ctx.exp);
  });
  await audit.record({ eventType: 'MCP_TOOL_CALLED', userId: ctx.subject.id, actorUserId: ctx.account.id, purpose: 'upload_via_link' });
  return runWithContext(
    { userId: ctx.account.id, sessionId: `mcp-${ctx.grantId}`, requestId: crypto.randomUUID(), clientIp: req.ip, userAgent: req.get('user-agent') },
    () => smartUploadRouter(req, res, next)
  );
});

module.exports = router;
