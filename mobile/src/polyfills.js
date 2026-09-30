// Fills in JavaScript built-ins that older Safari (iPadOS/iOS < 15.4-17.4)
// lacks. The app and its dependencies (React Navigation's findLast/
// findLastIndex, uuid's crypto.randomUUID, ...) call these unguarded while
// rendering the first screen, so a missing one throws before anything paints
// and the page stays blank. Imported first from index.js - no-ops wherever
// the built-in already exists.

function define(target, name, value) {
  if (typeof target[name] === 'function') return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

function findLastIndex(predicate, thisArg) {
  for (let i = this.length - 1; i >= 0; i -= 1) {
    if (predicate.call(thisArg, this[i], i, this)) return i;
  }
  return -1;
}

function findLast(predicate, thisArg) {
  const i = findLastIndex.call(this, predicate, thisArg);
  return i === -1 ? undefined : this[i];
}

define(Array.prototype, 'findLastIndex', findLastIndex);
define(Array.prototype, 'findLast', findLast);
define(Array.prototype, 'at', function at(index) {
  const i = Math.trunc(index) || 0;
  return this[i < 0 ? this.length + i : i];
});
define(String.prototype, 'at', function at(index) {
  const i = Math.trunc(index) || 0;
  const k = i < 0 ? this.length + i : i;
  return k >= 0 && k < this.length ? this.charAt(k) : undefined;
});
define(String.prototype, 'replaceAll', function replaceAll(search, replacement) {
  if (search instanceof RegExp) {
    if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
    return this.replace(search, replacement);
  }
  return this.split(String(search)).join(
    typeof replacement === 'function' ? replacement(String(search)) : String(replacement)
  );
});
define(Object, 'hasOwn', (obj, key) => Object.prototype.hasOwnProperty.call(obj, key));
define(Promise, 'withResolvers', function withResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

// crypto.randomUUID is unavailable on older Safari and on any non-HTTPS
// page (e.g. http://www.<domain> before the redirect to HTTPS).
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID !== 'function' && typeof globalThis.crypto.getRandomValues === 'function') {
  globalThis.crypto.randomUUID = function randomUUID() {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
  };
}
