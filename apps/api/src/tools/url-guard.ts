import * as dns from 'node:dns';

/**
 * SSRF guard for `web_fetch`, non-negotiable. This pod sits on a cluster
 * network next to Postgres, Argo CD and the kubelet; an unguarded fetch
 * tool is a request-forgery primitive that the model can be talked into
 * aiming anywhere. `checkUrl` must be called on the initial URL and again
 * on every redirect hop before that hop is followed.
 */

const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

const BLOCKED_IPV6_CIDRS = [
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '2001:db8::/32',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/** Expands an IPv6 address (already normalized by Node's dns module) to a BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  // Node's dns.lookup normalizes IPv6 addresses without `::` shorthand
  // ambiguity issues, but may still return them with `::` compressed. Expand
  // manually rather than depending on a specific normalized form.
  let head = ip;
  let tail = '';
  const doubleColon = ip.indexOf('::');
  if (doubleColon !== -1) {
    head = ip.slice(0, doubleColon);
    tail = ip.slice(doubleColon + 2);
  }
  const headParts = head.length > 0 ? head.split(':') : [];
  const tailParts = tail.length > 0 ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) {
    return null;
  }
  const groups = [
    ...headParts,
    ...Array(doubleColon !== -1 ? missing : 0).fill('0'),
    ...tailParts,
  ];
  if (groups.length !== 8) {
    return null;
  }
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const ipVal = ipv6ToBigInt(ip);
  const netVal = ipv6ToBigInt(network);
  if (ipVal === null || netVal === null) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = prefix === 128 ? (1n << 128n) - 1n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (ipVal & mask) === (netVal & mask);
}

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 address
 * (`::ffff:0:0/96`), or null. Handles both the dotted-quad form
 * (`::ffff:127.0.0.1`, as DNS may return it) and the pure-hex form the
 * WHATWG URL parser normalizes bracketed literals to (`::ffff:7f00:1`).
 */
function mappedIpv4(ip: string): string | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (dotted) {
    return dotted[1];
  }
  const value = ipv6ToBigInt(ip);
  if (value === null) {
    return null;
  }
  if ((value >> 32n) !== 0xffffn) {
    return null;
  }
  const low32 = value & 0xffffffffn;
  return [24n, 16n, 8n, 0n].map((shift) => (low32 >> shift) & 0xffn).join('.');
}

/** True if `ip` (v4 or v6, dotted/colon form) falls in any blocked range. */
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(':')) {
    const mapped = mappedIpv4(ip);
    if (mapped) {
      return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4InCidr(mapped, cidr));
    }
    return BLOCKED_IPV6_CIDRS.some((cidr) => ipv6InCidr(ip, cidr));
  }
  return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

export interface UrlGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Full guard for one URL (the initial URL, or one redirect hop). Checks
 * scheme, embedded credentials, then resolves the hostname and checks
 * *every* returned address against the blocklist.
 */
export async function checkUrl(rawUrl: string): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'unparseable URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `scheme ${url.protocol} not allowed` };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: 'URL carries credentials' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // A literal IP in the URL — check directly, no DNS round trip.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (isBlockedIp(hostname)) {
      return { allowed: false, reason: `blocked address ${hostname}` };
    }
    return { allowed: true };
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true });
  } catch {
    return { allowed: false, reason: `DNS lookup failed for ${hostname}` };
  }
  if (records.length === 0) {
    return { allowed: false, reason: `DNS lookup returned no addresses for ${hostname}` };
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      return { allowed: false, reason: `${hostname} resolves to blocked address ${record.address}` };
    }
  }
  return { allowed: true };
}
