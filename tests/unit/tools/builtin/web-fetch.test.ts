import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebFetchTool, type DnsResolver } from '../../../../src/tools/builtin/web-fetch.js';

describe('builtin/web-fetch', () => {
  const signal = new AbortController().signal;

  afterEach(() => { vi.restoreAllMocks(); });

  it('should return AgentTool with correct metadata', () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe('WebFetch');
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.isReadOnly).toBe(true);
  });

  it('should fetch URL content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body><p>Hello World</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('Hello World');
  });

  it('should strip HTML tags', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<h1>Title</h1><p>Content</p><script>evil()</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('Title');
    expect(content).toContain('Content');
    expect(content).not.toContain('<h1>');
    expect(content).not.toContain('evil');
  });

  it('should respect max_chars', async () => {
    const longContent = 'x'.repeat(10000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(longContent, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com', max_chars: 100 }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content.length).toBeLessThan(200);
  });

  it('should return error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' }, signal);
    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
  });

  describe('SSRF protection', () => {
    const tool = createWebFetchTool();

    it('blocks localhost and loopback addresses', async () => {
      for (const url of ['http://localhost/', 'http://127.0.0.1:6379', 'http://[::1]/', 'http://0.0.0.0/']) {
        const result = await tool.execute({ url }, signal);
        const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
        expect(parsed.isError, `should block ${url}`).toBe(true);
      }
    });

    it('blocks cloud metadata endpoints', async () => {
      const result = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
    });

    it('blocks private IPv4 ranges', async () => {
      for (const url of ['http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/']) {
        const result = await tool.execute({ url }, signal);
        const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
        expect(parsed.isError, `should block ${url}`).toBe(true);
      }
    });

    it('blocks non-http(s) schemes', async () => {
      for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/']) {
        const result = await tool.execute({ url }, signal);
        const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
        expect(parsed.isError, `should block ${url}`).toBe(true);
      }
    });

    // --- issue #21: redirect bypass and IPv6 private ranges ---

    it('blocks redirect to internal IPv4 (SSRF via redirect)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      );
      const result = await tool.execute({ url: 'https://example.com/redirect' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
      expect(parsed.content).toMatch(/[Rr]edirect|[Bb]locked/);
    });

    it('blocks redirect to private range 10.x.x.x (SSRF via redirect)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'http://10.0.0.1/internal' },
        }),
      );
      const result = await tool.execute({ url: 'https://example.com/redir2' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
    });

    it('blocks IPv6 ULA addresses (fc00::/7)', async () => {
      for (const url of ['http://[fc00::1]/', 'http://[fd12:3456:789a::1]/']) {
        const result = await tool.execute({ url }, signal);
        const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
        expect(parsed.isError, `should block ${url}`).toBe(true);
      }
    });

    it('blocks IPv6 link-local addresses (fe80::/10)', async () => {
      const result = await tool.execute({ url: 'http://[fe80::1%25eth0]/' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
    });

    it('blocks IPv4-mapped IPv6 for private ranges', async () => {
      for (const url of ['http://[::ffff:10.0.0.1]/', 'http://[::ffff:192.168.1.1]/']) {
        const result = await tool.execute({ url }, signal);
        const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
        expect(parsed.isError, `should block ${url}`).toBe(true);
      }
    });

    // --- issue #49: DNS rebinding mitigation ---

    function mockDns(v4: string[], v6: string[] = []): DnsResolver {
      return {
        resolve4: vi.fn().mockResolvedValue(v4),
        resolve6: vi.fn().mockResolvedValue(v6),
      };
    }
    function failingDns(): DnsResolver {
      return {
        resolve4: vi.fn().mockRejectedValue(new Error('NXDOMAIN')),
        resolve6: vi.fn().mockRejectedValue(new Error('NXDOMAIN')),
      };
    }

    it('blocks hostname whose DNS resolves to cloud metadata IP (issue #49)', async () => {
      const tool = createWebFetchTool({ dnsResolver: mockDns(['169.254.169.254']) });
      const result = await tool.execute({ url: 'http://evil-rebind.com/' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
      expect(parsed.content).toMatch(/DNS|blocked|rebind/i);
    });

    it('blocks hostname whose DNS resolves to private 10.x.x.x range (issue #49)', async () => {
      const tool = createWebFetchTool({ dnsResolver: mockDns(['10.0.0.1']) });
      const result = await tool.execute({ url: 'http://internal.corp.example/' }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
    });

    it('allows hostname whose DNS resolves to a public IP (issue #49)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('safe content', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );
      const tool = createWebFetchTool({ dnsResolver: mockDns(['93.184.216.34']) });
      const result = await tool.execute({ url: 'http://example.com/' }, signal);
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('safe content');
    });

    it('allows fetch when DNS lookup fails — fail-open (issue #49)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );
      const tool = createWebFetchTool({ dnsResolver: failingDns() });
      const result = await tool.execute({ url: 'http://some-domain.example/' }, signal);
      // DNS failure → fail-open → fetch proceeds
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('ok');
    });

    it('allows valid redirect to safe HTTPS URL', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(null, {
            status: 301,
            headers: { Location: 'https://example.com/final' },
          }),
        )
        .mockResolvedValueOnce(
          new Response('safe content', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        );
      const result = await tool.execute({ url: 'https://example.com/old' }, signal);
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('safe content');
    });
  });
});
