// Runtime configuration from environment variables.
import path from 'node:path';

const envPort = process.env.PORT;
const parsedPort = envPort === undefined || envPort === '' ? 3000 : Number(envPort);

export const PORT = Number.isInteger(parsedPort) && parsedPort >= 0 ? parsedPort : 3000;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
export const USING_DEFAULT_PASSWORD = !process.env.ADMIN_PASSWORD;
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
/** TEST-ONLY: '1' = fake Gemini for the AI character art smoke test, '402' = fake "credits exhausted". */
export const CHAR_ART_FAKE = process.env.CHAR_ART_FAKE || '';
export const CHAR_ART_FAKE_DELAY_MS = Number(process.env.CHAR_ART_FAKE_DELAY_MS) >= 0 && process.env.CHAR_ART_FAKE_DELAY_MS !== undefined && process.env.CHAR_ART_FAKE_DELAY_MS !== '' ? Number(process.env.CHAR_ART_FAKE_DELAY_MS) : 250;

export function warnIfDefaults(log = console.warn) {
  if (USING_DEFAULT_PASSWORD) {
    log('[경고] ADMIN_PASSWORD 환경변수가 설정되지 않아 기본 비밀번호 "admin"을 사용합니다. 운영 환경에서는 반드시 설정하세요.');
  }
}
