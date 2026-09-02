import * as dns from 'node:dns';
import { checkUrl, isBlockedIp } from './url-guard';

describe('url-guard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkUrl — URLs resolvable without DNS (literal IPs, scheme/credential checks)', () => {
    const cases: { url: string; allowed: boolean; label: string }[] = [
      { url: 'http://localhost:5432', allowed: false, label: 'localhost (loopback)' },
      {
        url: 'http://169.254.169.254/latest/meta-data/',
        allowed: false,
        label: 'cloud metadata address',
      },
      { url: 'http://[::1]/', allowed: false, label: 'IPv6 loopback' },
      { url: 'http://[fe80::1]/', allowed: false, label: 'IPv6 link-local' },
      { url: 'http://[fc00::1]/', allowed: false, label: 'IPv6 unique local' },
      { url: 'http://[::ffff:127.0.0.1]/', allowed: false, label: 'IPv4-mapped IPv6 loopback' },
      { url: 'file:///etc/passwd', allowed: false, label: 'file scheme' },
      { url: 'ftp://example.com/file', allowed: false, label: 'ftp scheme' },
      { url: 'http://user:pw@example.com', allowed: false, label: 'embedded credentials' },
      { url: 'http://10.0.0.5/', allowed: false, label: 'RFC1918 10/8' },
      { url: 'http://172.16.0.1/', allowed: false, label: 'RFC1918 172.16/12' },
      { url: 'http://192.168.1.1/', allowed: false, label: 'RFC1918 192.168/16' },
      { url: 'http://100.64.0.1/', allowed: false, label: 'CGNAT range' },
      { url: 'http://0.0.0.0/', allowed: false, label: 'unspecified address' },
      { url: 'http://192.0.2.1/', allowed: false, label: 'TEST-NET-1' },
      { url: 'http://255.255.255.255/', allowed: false, label: 'broadcast' },
      { url: 'http://127.0.0.1/', allowed: false, label: 'loopback IP literal' },
      { url: 'not a url', allowed: false, label: 'unparseable' },
    ];

    for (const { url, allowed, label } of cases) {
      it(`${allowed ? 'allows' : 'blocks'} ${label} (${url})`, async () => {
        const result = await checkUrl(url);
        expect(result.allowed).toBe(allowed);
      });
    }
  });

  it('allows a normal public https URL (DNS resolves to a public address)', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const result = await checkUrl('https://example.com/page');
    expect(result.allowed).toBe(true);
  });

  it('blocks a public hostname that DNS resolves to a private address', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const result = await checkUrl('https://looks-public.example/');
    expect(result.allowed).toBe(false);
  });

  it('blocks when ANY of several resolved addresses is blocked, not just the first', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never);
    const result = await checkUrl('https://multi-address.example/');
    expect(result.allowed).toBe(false);
  });

  it('blocks when DNS resolution fails outright', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    const result = await checkUrl('https://does-not-resolve.example/');
    expect(result.allowed).toBe(false);
  });

  describe('isBlockedIp', () => {
    it('treats an IPv4-mapped IPv6 address the same as its embedded IPv4', () => {
      expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
      expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
    });

    it('allows a public IPv4 address', () => {
      expect(isBlockedIp('8.8.8.8')).toBe(false);
    });

    it('allows a public IPv6 address', () => {
      expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
    });

    it('blocks the documentation IPv6 range', () => {
      expect(isBlockedIp('2001:db8::1')).toBe(true);
    });
  });
});
