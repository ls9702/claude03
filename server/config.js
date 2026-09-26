// Runtime configuration from environment variables.
import { randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const envPort = process.env.PORT;
const parsedPort = envPort === undefined || envPort === '' ? 3000 : Number(envPort);

export const PORT = Number.isInteger(parsedPort) && parsedPort >= 0 ? parsedPort : 3000;
/** null when unset → a generated password persisted in DATA_DIR/admin-password (see resolveAdminPassword). */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
export const ADMIN_PASSWORD_FILE = 'admin-password';
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/l/I

export function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

/**
 * The admin password: `explicit` (env / startServer option) wins; otherwise DATA_DIR/admin-password
 * (created with a random 10-char password, mode 600, on first boot so restarts keep it).
 * @returns {{password: string, source: 'env'|'file'|'generated', file?: string}}
 */
export function resolveAdminPassword(dataDir, explicit = null) {
  if (typeof explicit === 'string' && explicit) return { password: explicit, source: 'env' };
  const file = path.join(dataDir, ADMIN_PASSWORD_FILE);
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved) return { password: saved, source: 'file', file };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const password = generatePassword();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { password, source: 'generated', file };
}
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
/** TEST-ONLY: '1' = fake Gemini for the AI character art smoke test, '402' = fake "credits exhausted". */
export const CHAR_ART_FAKE = process.env.CHAR_ART_FAKE || '';
export const CHAR_ART_FAKE_DELAY_MS = Number(process.env.CHAR_ART_FAKE_DELAY_MS) >= 0 && process.env.CHAR_ART_FAKE_DELAY_MS !== undefined && process.env.CHAR_ART_FAKE_DELAY_MS !== '' ? Number(process.env.CHAR_ART_FAKE_DELAY_MS) : 250;

/** Console notice for the admin password source (the password itself only when it was just generated). */
export function adminPasswordNotice({ password, source, file }) {
  if (source === 'generated') {
    return `[관리자] ADMIN_PASSWORD가 설정되지 않아 관리자 비밀번호를 새로 만들었습니다: ${password}\n          (${file} 에 저장됨 — 다음 실행에도 같은 비밀번호를 씁니다. 이 메시지는 한 번만 표시됩니다.)`;
  }
  if (source === 'file') return `[관리자] 관리자 비밀번호는 ${file} 파일에 있습니다.`;
  return null;
}
