/**
 * Criptografia do armazenamento no Android.
 *
 * No desktop a chave vive no cofre do sistema operacional (DPAPI/Keychain via
 * `safeStorage`). No Android não existe equivalente acessível a um WebView, então
 * a estratégia é outra — e melhor do que guardar a chave em `localStorage`:
 *
 *  • a chave AES-256 é gerada com `extractable: false`, ou seja, **não pode ser
 *    lida de volta** nem por JavaScript que rode com XSS no app;
 *  • ela é guardada como objeto `CryptoKey` no IndexedDB (structured clone
 *    preserva a propriedade de não-extraível);
 *  • dados e gravações ficam cifrados com AES-GCM (IV aleatório por gravação).
 *
 * Limite honesto: quem tem acesso root ao aparelho pode ler o banco de dados do
 * WebView e usar a chave (não consegue exportá-la, mas consegue pedir que o
 * WebView decifre). É melhor que o modo navegador (sem criptografia) e pior que
 * o DPAPI do Windows. Está documentado em docs/ANDROID.md.
 */
import { idbGet, idbPut } from './idb';

const KEY_STORE = 'kv';
const KEY_ID = '__crypto_key__';

type Serialized = { iv: number[]; data: number[] };

async function getKey(): Promise<CryptoKey> {
  const stored = await idbGet<CryptoKey>(KEY_STORE, KEY_ID);
  if (stored instanceof CryptoKey) return stored;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await idbPut(KEY_STORE, KEY_ID, key);
  return key;
}

export async function isEncryptionAvailable(): Promise<boolean> {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

async function encryptBytes(bytes: Uint8Array): Promise<Serialized> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ct)) };
}

async function decryptBytes(payload: Serialized): Promise<Uint8Array> {
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data) as BufferSource,
  );
  return new Uint8Array(plain);
}

export function encryptJson(value: unknown): Promise<Serialized> {
  return encryptBytes(new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJson<T>(payload: Serialized): Promise<T> {
  const bytes = await decryptBytes(payload);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function encryptArray(buffer: ArrayBuffer | Uint8Array): Promise<Serialized> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return encryptBytes(bytes);
}

export function decryptArray(payload: Serialized): Promise<Uint8Array> {
  return decryptBytes(payload);
}
