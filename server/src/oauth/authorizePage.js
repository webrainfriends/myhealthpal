const config = require('../config');
const { SCOPES, DEFAULT_SCOPES } = require('./scopes');

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// JSON that is safe inside a <script> block.
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function errorPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EyeMyHealth</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#1f2937}</style></head>
<body><h1>Can't connect</h1><p>${esc(message)}</p></body></html>`;
}

// Server-rendered sign-in + consent screen for connecting an AI app. Light
// theme to match the app; no framework, one inline script.
function authorizePage({ client, params, requestedScopes }) {
  const scopes = requestedScopes.length > 0 ? requestedScopes : Object.keys(SCOPES);
  const state = {
    params,
    scopes: scopes.map((s) => ({ id: s, label: SCOPES[s], checked: requestedScopes.length > 0 || DEFAULT_SCOPES.includes(s) })),
    googleClientId: config.googleClientId,
    appleClientId: config.appleClientId,
    base: config.publicBaseUrl,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to EyeMyHealth</title>
<style>
:root{--bg:#f7f9fc;--card:#fff;--ink:#1f2937;--muted:#6b7280;--brand:#2f6fed;--line:#e5e7eb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:30rem;margin:2.5rem auto;padding:0 1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.5rem}
h1{font-size:1.3rem;margin:0 0 .25rem}p{margin:.5rem 0}.muted{color:var(--muted);font-size:.9rem}
label.scope{display:flex;gap:.6rem;align-items:flex-start;padding:.55rem 0;border-top:1px solid var(--line)}
button{background:var(--brand);color:#fff;border:0;border-radius:10px;padding:.7rem 1.1rem;font:inherit;cursor:pointer}
button.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:.6rem;margin-top:1rem}.err{color:#b91c1c}[hidden]{display:none!important}
</style></head>
<body><main><div class="card">
<h1>Connect ${esc(client.client_name)}</h1>
<p class="muted">to your EyeMyHealth account. Your health records stay in EyeMyHealth; the app only sees what you allow below.</p>
<div id="signin"><p>Sign in to continue.</p><div id="g"></div><div id="a" style="margin-top:.6rem"></div>
<p id="signin-msg" class="muted"></p></div>
<form id="consent" hidden>
<p>Signed in as <strong id="who"></strong>.</p>
<p><strong>${esc(client.client_name)}</strong> wants to:</p>
<div id="scopes"></div>
<label class="scope"><input type="checkbox" id="ext" checked>
<span>I understand my health data will be shared with this AI app and its provider when I use it, and that I can disconnect it at any time in EyeMyHealth.</span></label>
<p id="msg" class="err"></p>
<div class="row"><button type="submit">Allow</button><button type="button" class="secondary" id="deny">Cancel</button></div>
</form></div></main>
<script>
var S=${jsonForScript(state)},ticket=null;
function $(id){return document.getElementById(id)}
function post(path,body){return fetch(S.base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error_description||j.error||'Request failed');return j})})}
function loggedIn(r){ticket=r.ticket;$('who').textContent=r.displayName||r.email||'your account';
S.scopes.forEach(function(s){var l=document.createElement('label');l.className='scope';var c=document.createElement('input');c.type='checkbox';c.value=s.id;c.checked=s.checked;var t=document.createElement('span');t.textContent=s.label;l.appendChild(c);l.appendChild(t);$('scopes').appendChild(l)});
$('signin').hidden=true;$('consent').hidden=false}
function login(provider,credential){$('signin-msg').textContent='Signing in…';post('/oauth/authorize/login',{provider:provider,credential:credential,params:S.params}).then(loggedIn).catch(function(e){$('signin-msg').textContent=e.message;$('signin-msg').className='err'})}
function loadScript(src,cb){var s=document.createElement('script');s.src=src;s.async=true;s.onload=cb;document.head.appendChild(s)}
if(S.googleClientId)loadScript('https://accounts.google.com/gsi/client',function(){google.accounts.id.initialize({client_id:S.googleClientId,callback:function(r){login('google',r.credential)}});google.accounts.id.renderButton($('g'),{theme:'outline',size:'large',text:'continue_with'})});
if(S.appleClientId)loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',function(){AppleID.auth.init({clientId:S.appleClientId,scope:'name email',redirectURI:S.base+'/oauth/authorize',usePopup:true});var b=document.createElement('button');b.className='secondary';b.type='button';b.textContent=' Continue with Apple';b.onclick=function(){AppleID.auth.signIn().then(function(r){login('apple',r.authorization.id_token)}).catch(function(){})};$('a').appendChild(b)});
if(!S.googleClientId&&!S.appleClientId)$('signin-msg').textContent='Sign-in is not configured on this server.';
function finish(body){post('/oauth/authorize/approve',body).then(function(r){window.location.assign(r.redirect)}).catch(function(e){$('msg').textContent=e.message})}
$('consent').addEventListener('submit',function(e){e.preventDefault();var sc=[].slice.call(document.querySelectorAll('#scopes input:checked')).map(function(i){return i.value});
if(sc.length===0){$('msg').textContent='Choose at least one permission, or cancel.';return}
finish({ticket:ticket,params:S.params,scopes:sc,consentExternalAi:$('ext').checked})});
$('deny').onclick=function(){finish({ticket:ticket,params:S.params,deny:true})};
</script></body></html>`;
}

module.exports = { authorizePage, errorPage, esc };
