import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const targetDir = process.env.TTS_VOICE_TEST_DIR ?? join(process.cwd(), 'storage', 'voice-tests');
const appId = process.env.VOLC_TTS_APP_ID;
const apiKey = process.env.VOLC_TTS_API_KEY;
if (!appId || !apiKey) {
  console.error('Missing VOLC_TTS_APP_ID or VOLC_TTS_API_KEY. Set them in .env.local or your shell environment.');
  process.exit(1);
}
const text = '哎，先别急着点。这个地方最容易踩坑，我替你试过了。';
const candidates = [
  { name: '01-傲娇吐槽', speaker: 'zh_male_aojiaobazong_moon_bigtts', resource: 'seed-tts-1.0' },
  { name: '02-天才同桌', speaker: 'saturn_zh_male_tiancaitongzhuo_tob', resource: 'seed-tts-2.0' },
  { name: '03-爽朗少年', speaker: 'saturn_zh_male_shuanglangshaonian_tob', resource: 'seed-tts-2.0' },
  { name: '04-儒雅冷淡', speaker: 'zh_male_ruyayichen_saturn_bigtts', resource: 'seed-tts-2.0' },
];

await mkdir(targetDir, { recursive: true });
for (const candidate of candidates) {
  const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Id': appId,
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': candidate.resource,
      'X-Api-Request-Id': randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: 'fishy' },
      req_params: {
        text,
        speaker: candidate.speaker,
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: -8, loudness_rate: 0 },
      },
    }),
  });
  const body = await response.text();
  const events = body.trim().split(/\n(?=\{)/).map((line) => JSON.parse(line));
  const audio = events
    .filter((event) => event.code === 0 && typeof event.data === 'string')
    .map((event) => Buffer.from(event.data, 'base64'));
  if (audio.length > 0) {
    await writeFile(join(targetDir, `${candidate.name}.mp3`), Buffer.concat(audio));
    console.log(`OK ${candidate.name}`);
  } else {
    const last = events.at(-1) ?? {};
    console.log(`SKIP ${candidate.name}: ${last.code ?? response.status} ${last.message ?? 'no audio'}`);
  }
}
