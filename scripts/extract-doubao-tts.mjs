import { readFile, writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('Usage: node scripts/extract-doubao-tts.mjs INPUT.json OUTPUT.mp3');
}

const responses = (await readFile(input, 'utf8'))
  .trim()
  .split(/\n(?=\{)/)
  .map((line) => JSON.parse(line));

const audio = responses
  .filter((response) => response.code === 0 && typeof response.data === 'string')
  .map((response) => Buffer.from(response.data, 'base64'));

if (audio.length === 0) {
  const last = responses.at(-1) ?? {};
  throw new Error(`TTS failed: ${last.message ?? 'no audio returned'}`);
}

await writeFile(output, Buffer.concat(audio));
