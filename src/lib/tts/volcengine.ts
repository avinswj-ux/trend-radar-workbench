import { randomBytes, randomUUID } from "node:crypto";
import { connect } from "node:tls";

const host = "openspeech.bytedance.com";
const path = "/api/v3/tts/bidirection";
const fullClient = 1;
const fullServer = 9;
const audioServer = 11;
const errorType = 15;
const withEvent = 4;
const startConnection = 1;
const finishConnection = 2;
const connectionStarted = 50;
const connectionFinished = 52;
const startSession = 100;
const finishSession = 102;
const sessionStarted = 150;
const sessionFinished = 152;
const taskRequest = 200;

const DEFAULT_SPEAKER = "zh_male_dayi_uranus_bigtts";
const DEFAULT_RESOURCE = "seed-tts-2.0";

function ttsSpeaker() {
  return DEFAULT_SPEAKER;
}
function ttsResource() {
  return DEFAULT_RESOURCE;
}
function ttsSpeechRate() {
  return 28;
}
function ttsLoudnessRate() {
  return 12;
}

async function synthesizeOfficialVoice(text: string): Promise<Buffer> {
  const apiKey = process.env.VOLC_TTS_API_KEY;
  const appId = process.env.VOLC_TTS_APP_ID;
  if (!apiKey) throw new Error("VOLC_TTS_API_KEY is not configured");
  if (!appId) throw new Error("VOLC_TTS_APP_ID is not configured");
  const response = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Id": appId,
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": ttsResource(),
      "X-Api-Request-Id": randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "avin-studio" },
      req_params: {
        text,
        speaker: ttsSpeaker(),
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
          speech_rate: ttsSpeechRate(),
          loudness_rate: ttsLoudnessRate(),
        },
        additions: JSON.stringify({
          context_texts: [
            "短视频科技工具解说：短句、重音明确、节奏紧凑，带真实体验后的兴奋感，不使用新闻播报腔。",
          ],
        }),
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Volcengine TTS HTTP ${response.status}: ${body.slice(0, 180)}`);
  const chunks: Buffer[] = [];
  let last: { code?: number; message?: string } = {};
  for (const line of body.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { code?: number; message?: string; data?: string };
      last = event;
      if (event.code === 0 && typeof event.data === "string" && event.data) {
        chunks.push(Buffer.from(event.data, "base64"));
      }
    } catch {
      // ignore keep-alive fragments
    }
  }
  if (!chunks.length)
    throw new Error(`Volcengine TTS returned no audio: ${last.code ?? ""} ${last.message ?? body.slice(0, 120)}`);
  return Buffer.concat(chunks);
}

export async function synthesizeWithVolcengine(text: string): Promise<Buffer> {
  const apiKey = process.env.VOLC_TTS_API_KEY;
  if (!apiKey) throw new Error("VOLC_TTS_API_KEY is not configured");
  if (!ttsSpeaker().startsWith("S_")) return synthesizeOfficialVoice(text);
  const speaker = ttsSpeaker();
  const resourceId = ttsResource();
  const speechRate = ttsSpeechRate();
  const loudnessRate = ttsLoudnessRate();
  return new Promise<Buffer>((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host });
    const connectionId = randomUUID();
    const sessionId = randomUUID();
    const audio: Buffer[] = [];
    let raw = Buffer.alloc(0);
    let upgraded = false;
    let settled = false;
    const done = (error?: Error) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(Buffer.concat(audio)); };
    const timeout = setTimeout(() => done(new Error("Volcengine TTS timed out")), 60_000);
    const finish = (error?: Error) => { clearTimeout(timeout); done(error); };

    socket.once("error", finish);
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([`GET ${path} HTTP/1.1`, `Host: ${host}`, "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", `X-Api-Key: ${apiKey}`, `X-Api-Resource-Id: ${resourceId}`, `X-Api-Connect-Id: ${connectionId}`, "X-Control-Require-Usage-Tokens-Return: *", "", ""].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      if (!upgraded) {
        const end = raw.indexOf("\r\n\r\n");
        if (end < 0) return;
        const response = raw.subarray(0, end).toString("utf8");
        raw = raw.subarray(end + 4);
        if (!/^HTTP\/1\.1 101\b/.test(response)) return finish(new Error(`Volcengine TTS handshake failed: ${response.split("\r\n")[0]}`));
        upgraded = true;
        sendWs(socket, encodeEvent(startConnection, "", {}));
      }
      for (const frame of takeWsFrames(() => raw, (next) => { raw = next; })) handleFrame(frame);
    });
    function handleFrame(frame: Buffer) {
      const message = decodeMessage(frame);
      if (message.type === errorType) return finish(new Error(`Volcengine TTS error: ${message.payload.toString("utf8")}`));
      if (message.type === audioServer) audio.push(message.payload);
      if (message.type !== fullServer) return;
      if (message.event === connectionStarted) {
        sendWs(socket, encodeEvent(startSession, sessionId, {
          event: startSession,
          req_params: {
            speaker,
            audio_params: {
              format: "mp3",
              sample_rate: 24000,
              speech_rate: speechRate,
              loudness_rate: loudnessRate,
            },
            additions: JSON.stringify({
              context_texts: [
                "短视频科技工具解说：短句、重音明确、节奏紧凑，带真实体验后的兴奋感，不使用新闻播报腔。",
              ],
            }),
          },
        }));
      } else if (message.event === sessionStarted) {
        for (const part of chunkText(text)) sendWs(socket, encodeEvent(taskRequest, sessionId, { event: taskRequest, req_params: { text: part } }));
        sendWs(socket, encodeEvent(finishSession, sessionId, {}));
      } else if (message.event === sessionFinished) {
        sendWs(socket, encodeEvent(finishConnection, "", {}));
      } else if (message.event === connectionFinished) {
        if (!audio.length) return finish(new Error("Volcengine TTS returned no audio"));
        finish();
      }
    }
  });
}

function encodeEvent(event: number, sessionId: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  const session = event === startConnection || event === finishConnection ? Buffer.alloc(0) : Buffer.concat([u32(Buffer.byteLength(sessionId)), Buffer.from(sessionId)]);
  return Buffer.concat([Buffer.from([0x11, (fullClient << 4) | withEvent, 0x10, 0]), i32(event), session, u32(body.length), body]);
}
function decodeMessage(data: Buffer) {
  const type = data[1] >> 4; const flag = data[1] & 15; let offset = (data[0] & 15) * 4;
  if (type === errorType) { const code = data.readUInt32BE(offset); offset += 4; const size = data.readUInt32BE(offset); return { type, event: 0, payload: Buffer.concat([Buffer.from(String(code)), data.subarray(offset + 4, offset + 4 + size)]) }; }
  if (flag === 1 || flag === 3) offset += 4;
  let event = 0;
  if (flag === withEvent) {
    event = data.readInt32BE(offset); offset += 4;
    if (![connectionStarted, connectionFinished].includes(event)) { const size = data.readUInt32BE(offset); offset += 4 + size; }
    if ([connectionStarted, connectionFinished].includes(event)) { const connectSize = data.readUInt32BE(offset); offset += 4 + connectSize; }
  }
  const size = data.readUInt32BE(offset); return { type, event, payload: data.subarray(offset + 4, offset + 4 + size) };
}
function sendWs(socket: ReturnType<typeof connect>, payload: Buffer) { socket.write(frameWs(payload)); }
function frameWs(payload: Buffer) { const mask = randomBytes(4); const header = payload.length < 126 ? Buffer.from([0x82, 0x80 | payload.length]) : Buffer.from([0x82, 0xfe, payload.length >> 8, payload.length & 255]); const data = Buffer.from(payload); for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4]; return Buffer.concat([header, mask, data]); }
function takeWsFrames(get: () => Buffer, set: (data: Buffer) => void) { const out: Buffer[] = []; let data = get(); while (data.length >= 2) { let offset = 2; let size = data[1] & 127; if (size === 126) { if (data.length < 4) break; size = data.readUInt16BE(2); offset = 4; } if (data.length < offset + size) break; if ((data[0] & 15) === 2) out.push(data.subarray(offset, offset + size)); data = data.subarray(offset + size); } set(data); return out; }
function u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }
function i32(value: number) { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; }
function chunkText(text: string) { return text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text]; }
