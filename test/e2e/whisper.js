// The real-speech run: Whisper (Offline Captions) must hear a committed
// Kokoro fp32 clip. Same e2e as run.js, with the clip and its words fixed so
// every run is the same; E2E_SPEECH_WAV and E2E_EXPECT still override.
//
//   GIFOS_APP_DIR=../gifos-app npm run test:e2e:whisper
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEECH_WAV = path.resolve(HERE, '..', 'fixtures', 'speech', 'budget-garden.wav');
export const SPEECH_WORDS = 'budget|meeting|garden|tomorrow|morning';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.E2E_STT = 'whisper';
  if (!process.env.E2E_SPEECH_WAV) process.env.E2E_SPEECH_WAV = SPEECH_WAV;
  if (!process.env.E2E_EXPECT) process.env.E2E_EXPECT = SPEECH_WORDS;
  await import('./run.js');
}
