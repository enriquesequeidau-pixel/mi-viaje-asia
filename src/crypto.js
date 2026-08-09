const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = bytes => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 32768) binary += String.fromCharCode(...view.subarray(offset, offset + 32768));
  return btoa(binary);
};
const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function deriveKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, usages
  );
}

export async function encryptJson(value, passphrase) {
  if (String(passphrase).length < 8) throw new Error('Usa una clave de al menos 8 caracteres.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { format: 'asia-backup', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM', salt: toBase64(salt), iv: toBase64(iv), data: toBase64(cipher) };
}

export async function decryptJson(payload, passphrase) {
  if (payload?.format !== 'asia-backup' || payload?.version !== 1) throw new Error('Formato de respaldo cifrado no compatible.');
  try {
    const key = await deriveKey(passphrase, fromBase64(payload.salt), ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.data));
    return JSON.parse(decoder.decode(plain));
  } catch { throw new Error('La clave no coincide o el archivo está dañado.'); }
}
