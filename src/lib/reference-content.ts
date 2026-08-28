import { isIP } from "node:net";

const maxBytes = 240_000;

function assertPublicHttpUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http/https 参考链接');
  const host = url.hostname.toLowerCase();
  const blockedName = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal');
  const blockedIp = isIP(host) > 0 && (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1');
  if (blockedName || blockedIp) throw new Error('参考链接不能指向本机或私有网络');
  return url;
}

function htmlToText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchReferenceContent(value: string) {
  let url = assertPublicHttpUrl(value);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'TrendRadar/1.0 (+manual-topic-analysis)', Accept: 'text/html,text/plain,application/json' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('参考链接重定向缺少地址');
      url = assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`参考链接读取失败：${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, maxBytes);
    const raw = new TextDecoder().decode(bytes);
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw.replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('参考链接没有可分析正文');
    return { finalUrl: url.toString(), text: text.slice(0, 18_000) };
  }
  throw new Error('参考链接重定向次数过多');
}
