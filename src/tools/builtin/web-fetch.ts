import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';

const DEFAULT_MAX_CHARS = 50_000;
const MAX_REDIRECT_HOPS = 5;

/** Validate URL against SSRF attack vectors. Returns null if safe, error message if blocked. */
function validateFetchUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Blocked scheme: ${parsed.protocol}`;
  }

  const host = parsed.hostname.toLowerCase();

  // Loopback and wildcard hostnames
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]' || host === '::') {
    return `Blocked hostname: ${host}`;
  }

  // IPv4 literal checks (loopback, private ranges, link-local metadata)
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number) as [number, number, number, number];
    if (a === 127) return 'Blocked loopback address';
    if (a === 10) return 'Blocked private range 10.0.0.0/8';
    if (a === 192 && b === 168) return 'Blocked private range 192.168.0.0/16';
    if (a === 172 && b >= 16 && b <= 31) return 'Blocked private range 172.16.0.0/12';
    if (a === 169 && b === 254) return 'Blocked link-local range (cloud metadata)';
    if (a === 0) return 'Blocked 0.0.0.0/8';
  }

  // IPv6 checks — strip brackets for pattern matching
  const ipv6Bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // Link-local: fe80::/10 (fe80 – febf)
  if (/^fe[89ab]/i.test(ipv6Bare)) return 'Blocked IPv6 link-local address (fe80::/10)';
  // ULA (unique local): fc00::/7 (fc and fd prefixes)
  if (/^f[cd]/i.test(ipv6Bare)) return 'Blocked IPv6 private range (fc00::/7)';
  // IPv4-mapped: ::ffff:a.b.c.d — re-validate the embedded IPv4 address
  const ipv4MappedMatch = ipv6Bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (ipv4MappedMatch) {
    const embeddedResult = validateFetchUrl(`http://${ipv4MappedMatch[1]}/`);
    if (embeddedResult) return `Blocked IPv4-mapped IPv6: ${embeddedResult}`;
  }

  return null;
}

/** IPv4/IPv6 literal patterns — already validated by validateFetchUrl. */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Minimal DNS resolver interface — injectable for testing. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

async function defaultDnsResolver(): Promise<DnsResolver> {
  const mod = await import('node:dns/promises');
  return { resolve4: mod.resolve4, resolve6: mod.resolve6 };
}

/**
 * Pre-resolve DNS and validate each resolved IP against the SSRF blocklist.
 * Mitigates DNS rebinding: an attacker domain switches from a public IP to a
 * private IP after the static check but before the actual fetch.
 * Fails open: DNS errors allow the fetch to proceed (preserves availability).
 */
async function checkDnsRebinding(rawUrl: string, resolver: DnsResolver): Promise<string | null> {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  // IP literals are already validated statically by validateFetchUrl
  if (IPV4_RE.test(hostname) || hostname.startsWith('[') || hostname.includes(':')) return null;

  try {
    const [v4Result, v6Result] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    const addresses: string[] = [
      ...(v4Result.status === 'fulfilled' ? v4Result.value : []),
      ...(v6Result.status === 'fulfilled' ? v6Result.value : []),
    ];
    for (const addr of addresses) {
      const fakeUrl = `http://${addr.includes(':') ? `[${addr}]` : addr}/`;
      const err = validateFetchUrl(fakeUrl);
      if (err) return `DNS rebinding blocked: ${hostname} resolved to ${addr} — ${err}`;
    }
  } catch {
    // DNS failure → fail-open
  }
  return null;
}

const WebFetchParams = z.object({
  url: z.string().describe('URL to fetch'),
  max_chars: z.number().optional().describe('Max characters to return. Default: 50000.'),
});

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createWebFetchTool(options?: { dnsResolver?: DnsResolver }): AgentTool {
  let resolverPromise: Promise<DnsResolver> | null = null;
  const getResolver = (): Promise<DnsResolver> => {
    if (options?.dnsResolver) return Promise.resolve(options.dnsResolver);
    if (!resolverPromise) resolverPromise = defaultDnsResolver();
    return resolverPromise;
  };

  return {
    name: 'WebFetch',
    description: 'Fetch content from a URL. Returns text content (HTML is stripped to plain text).',
    parameters: WebFetchParams,
    isConcurrencySafe: true,
    isReadOnly: true,

    async execute(rawArgs: unknown, signal: AbortSignal) {
      const { url, max_chars } = rawArgs as z.infer<typeof WebFetchParams>;
      const maxChars = max_chars ?? DEFAULT_MAX_CHARS;

      const blocked = validateFetchUrl(url);
      if (blocked) return { content: blocked, isError: true };

      const resolver = await getResolver();
      const dnsBlocked = await checkDnsRebinding(url, resolver);
      if (dnsBlocked) return { content: dnsBlocked, isError: true };

      try {
        // Follow redirects manually so each hop is validated against SSRF rules.
        let currentUrl = url;
        let response!: Response;

        for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
          if (hop === MAX_REDIRECT_HOPS) {
            return { content: `SSRF check: too many redirects (>${MAX_REDIRECT_HOPS})`, isError: true };
          }

          response = await fetch(currentUrl, {
            signal,
            headers: { 'User-Agent': 'AgentX-SDK/1.0' },
            redirect: 'manual',
          });

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
              return { content: 'Redirect without Location header', isError: true };
            }
            let nextUrl: string;
            try {
              nextUrl = new URL(location, currentUrl).href;
            } catch {
              return { content: `Redirect blocked: invalid URL ${location}`, isError: true };
            }
            const redirectBlocked = validateFetchUrl(nextUrl);
            if (redirectBlocked) {
              return { content: `Redirect blocked: ${redirectBlocked}`, isError: true };
            }
            currentUrl = nextUrl;
            continue;
          }
          break;
        }

        if (!response.ok) {
          return { content: `HTTP ${response.status}: ${response.statusText}`, isError: true };
        }

        const contentType = response.headers.get('content-type') ?? '';
        let text = await response.text();

        if (contentType.includes('text/html')) {
          text = stripHtml(text);
        }

        if (text.length > maxChars) {
          text = text.slice(0, maxChars) + `\n\n[truncated — ${text.length - maxChars} characters omitted]`;
        }

        return text || '(empty response)';
      } catch (error) {
        return { content: `Fetch failed: ${(error as Error).message}`, isError: true };
      }
    },
  };
}
