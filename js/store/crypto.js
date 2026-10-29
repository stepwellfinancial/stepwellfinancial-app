/* Stepwell Financial: the passphrase lock's and the encrypted backup's crypto.
   WebCrypto only, nothing else. No DOM and no storage.

   Scheme: a key from PBKDF2-SHA-256 at ITERATIONS (800,000; the floor is
   600,000) with a random 16-byte salt; AES-GCM with a 256-bit key; a fresh
   random 12-byte IV for every encryption. The key is created non-extractable,
   so its bytes can't be read back, and it is held only in the store's memory.
   The passphrase is normalised to Unicode NFC first, so the same passphrase
   typed on two devices gives the same key. */
(function (root) {
  'use strict';

  var ITERATIONS = 800000;
  var MIN_ITERATIONS = 600000;
  var MIN_LENGTH = 12;
  var subtle = root.crypto && root.crypto.subtle;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function randomBytes(n) { var b = new Uint8Array(n); root.crypto.getRandomValues(b); return b; }
  function toB64(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function fromB64(text) {
    var s = root.atob(text), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  // deriveKey('my long passphrase', salt, 800000) -> Promise<CryptoKey>
  function deriveKey(passphrase, salt, iterations) {
    iterations = iterations || ITERATIONS;
    if (iterations < MIN_ITERATIONS) return Promise.reject(new Error('iterations below the floor'));
    var raw = enc.encode(String(passphrase).normalize('NFC'));
    return subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  // encryptJson(key, {a: 1}, 'accounts/abc') -> Promise<{ iv: Uint8Array(12), ct: ArrayBuffer }>
  // aad ties the ciphertext to where it is stored, so a record can't be moved
  // to another slot and still decrypt.
  function encryptJson(key, value, aad) {
    var iv = randomBytes(12);
    var params = { name: 'AES-GCM', iv: iv };
    if (aad) params.additionalData = enc.encode(aad);
    return subtle.encrypt(params, key, enc.encode(JSON.stringify(value))).then(function (ct) { return { iv: iv, ct: ct }; });
  }
  // Rejects when the key is wrong or the bytes were changed.
  function decryptJson(key, iv, ct, aad) {
    var params = { name: 'AES-GCM', iv: iv };
    if (aad) params.additionalData = enc.encode(aad);
    return subtle.decrypt(params, key, ct).then(function (buf) { return JSON.parse(dec.decode(buf)); });
  }

  // The verifier: a fixed text, encrypted. Unlock decrypts it to check the
  // passphrase before touching any record.
  var CHECK = 'stepwell-lock-check-v1';
  function makeVerifier(key) { return encryptJson(key, CHECK, 'settings/verifier'); }
  function checkVerifier(key, v) {
    return decryptJson(key, v.iv, v.ct, 'settings/verifier').then(function (x) { return x === CHECK; }, function () { return false; });
  }

  // A strength hint from length and variety. A hint, not a promise.
  // -> { ok, level: 0..3, message }
  function strength(passphrase) {
    var p = String(passphrase || '').normalize('NFC'), n = Array.from(p).length;
    if (n < MIN_LENGTH) return { ok: false, level: 0, message: 'Use at least ' + MIN_LENGTH + ' characters. This one has ' + n + '.' };
    var kinds = 0;
    if (/[a-z]/.test(p)) kinds++;
    if (/[A-Z]/.test(p)) kinds++;
    if (/[0-9]/.test(p)) kinds++;
    if (/[^a-zA-Z0-9]/.test(p)) kinds++;
    var unique = {};
    Array.from(p.toLowerCase()).forEach(function (c) { unique[c] = true; });
    var distinct = Object.keys(unique).length;
    if (distinct < 6) return { ok: true, level: 1, message: 'Long enough, but it repeats a few characters. Repeats are easier to guess.' };
    if (n >= 20 && (kinds >= 2 || / \S+ \S+ /.test(p))) return { ok: true, level: 3, message: 'Long and varied. Several unrelated words are hard to guess and easier to remember.' };
    if (n >= 16 && kinds >= 2) return { ok: true, level: 2, message: 'Long enough, with some variety. Longer is harder to guess.' };
    return { ok: true, level: 1, message: 'Long enough. Longer is harder to guess: several unrelated words work well.' };
  }

  // ---------- Encrypted backup ----------
  // encryptBackup(textOfPlainBackup, passphrase, meta) -> Promise<object to save as JSON>
  function encryptBackup(text, passphrase, meta) {
    var salt = randomBytes(16), iv = randomBytes(12);
    return deriveKey(passphrase, salt, ITERATIONS).then(function (key) {
      return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(meta.app + '/backup') }, key, enc.encode(text));
    }).then(function (ct) {
      return {
        app: meta.app, encrypted: true, schemaVersion: meta.schemaVersion, createdAt: meta.createdAt,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) },
        cipher: { name: 'AES-GCM', iv: toB64(iv) },
        ciphertext: toB64(ct)
      };
    });
  }
  // -> Promise<text of the plain backup>; rejects on a wrong passphrase.
  function decryptBackup(obj, passphrase) {
    return deriveKey(passphrase, fromB64(obj.kdf.salt), obj.kdf.iterations).then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(obj.cipher.iv), additionalData: enc.encode(obj.app + '/backup') }, key, fromB64(obj.ciphertext));
    }).then(function (buf) { return dec.decode(buf); });
  }

  var api = {
    ITERATIONS: ITERATIONS, MIN_ITERATIONS: MIN_ITERATIONS, MIN_LENGTH: MIN_LENGTH,
    randomBytes: randomBytes, toB64: toB64, fromB64: fromB64,
    deriveKey: deriveKey, encryptJson: encryptJson, decryptJson: decryptJson,
    makeVerifier: makeVerifier, checkVerifier: checkVerifier, strength: strength,
    encryptBackup: encryptBackup, decryptBackup: decryptBackup
  };
  root.SWCrypto = api;
})(this);
