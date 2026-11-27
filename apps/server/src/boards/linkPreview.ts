import { lookup } from 'node:dns/promises';
import net from 'node:net';

import type { LinkPreview } from '@whiteboard/core';

/** The preview could not be made; the message is safe to show the person who pasted the link. */
export class LinkPreviewError extends Error {}

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/**
 * True for addresses on this computer or the office network (or otherwise not public). A link
 * preview must never reach these: it would let anyone with a link probe the Host's own network.
 */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7)); // IPv4 written as IPv6
    return (
      v === '::' ||
      v === '::1' ||
      /^f[cd]/.test(v) || // unique local
      /^fe[89ab]/.test(v) || // link local
      v.startsWith('ff') // multicast
    );
  }
  return true; // not an address at all
}

/** Throws unless every address the host name resolves to is public. */
async function assertPublicHost(hostname: string) {
  const literal = hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(literal)
    ? [{ address: literal }]
    : await lookup(hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new LinkPreviewError('That address is not a public web page');
  }
}

const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Title and description from a page's HTML: Open Graph tags first, then the plain tags. */
export function parseMeta(html: string): { title: string; description: string } {
  const head = html.slice(0, 200_000);
  const meta = (name: string) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      'i',
    );
    const m = re.exec(head);
    return m ? decode(m[1] ?? m[2] ?? '') : '';
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = meta('og:title') || (titleTag ? decode(titleTag[1]!) : '');
  const description = meta('og:description') || meta('description');
  return { title: title.slice(0, 300), description: description.slice(0, 1000) };
}

/** Fetches a public page and returns its title and description. Follows a few redirects, each re-checked. */
export async function previewLink(raw: string): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkPreviewError('That is not a web address');
  }
  for (let hops = 0; ; hops++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new LinkPreviewError('Only web addresses (http or https) can be previewed');
    }
    if (url.username || url.password)
      throw new LinkPreviewError('Addresses with a login are not allowed');
    await assertPublicHost(url.hostname);

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/html', 'user-agent': 'Whiteboard link preview' },
      });
    } catch {
      throw new LinkPreviewError('The page did not answer');
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hops >= MAX_REDIRECTS) throw new LinkPreviewError('Too many redirects');
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new LinkPreviewError(`The page answered with ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) {
      throw new LinkPreviewError('That address is not a web page');
    }
    const html = await readCapped(res);
    return { url: url.toString(), ...parseMeta(html) };
  }
}

/** Reads at most MAX_BYTES of the body, as text. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
}
