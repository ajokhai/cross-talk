/**
 * Subnet and Network Boundary Isolation Utility
 * Enforces CIDR restrictions so sockets never spill data over unauthorized networks.
 * Zero external dependencies.
 */

export class SubnetGuard {
  /**
   * Normalizes an IP string (unwraps IPv6 mapped IPv4 like ::ffff:192.168.1.10)
   */
  public static normalizeIp(rawIp: string): string {
    // An unknown address must never be mistaken for localhost.
    if (!rawIp) return '';
    let ip = rawIp.trim();
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    if (ip === '::1') {
      return '127.0.0.1';
    }
    return ip;
  }

  /** True when a bind address only accepts local connections. */
  public static isLoopbackHost(host: string): boolean {
    return host === 'localhost' || host === '::1' || this.matchesCidr(host, '127.0.0.0/8');
  }

  /**
   * Converts IPv4 string to 32-bit unsigned integer
   */
  private static ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const byte = parseInt(parts[i], 10);
      if (isNaN(byte) || byte < 0 || byte > 255) return null;
      n = (n << 8) + byte;
    }
    return n >>> 0;
  }

  /**
   * Checks if an IPv4 address is inside an IPv4 CIDR block (e.g. 192.168.1.0/24)
   */
  public static matchesCidr(ip: string, cidr: string): boolean {
    const cleanIp = this.normalizeIp(ip);
    const ipInt = this.ipv4ToInt(cleanIp);
    if (ipInt === null) {
      // IPv6 localhost check
      if (ip === '::1' && (cidr === '127.0.0.1/32' || cidr === 'localhost' || cidr === 'local')) {
        return true;
      }
      return false;
    }

    const [base, prefixStr] = cidr.split('/');
    const prefix = prefixStr !== undefined ? parseInt(prefixStr, 10) : 32;
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

    const baseInt = this.ipv4ToInt(base);
    if (baseInt === null) return false;

    if (prefix === 0) return true;
    const mask = (~0 << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  }

  /**
   * Checks if an IP is within private RFC1918 LAN space (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
   */
  public static isPrivateOrLocal(ip: string): boolean {
    const clean = this.normalizeIp(ip);
    return (
      this.matchesCidr(clean, '127.0.0.0/8') ||
      this.matchesCidr(clean, '10.0.0.0/8') ||
      this.matchesCidr(clean, '172.16.0.0/12') ||
      this.matchesCidr(clean, '192.168.0.0/16') ||
      clean === '127.0.0.1' ||
      clean === 'localhost'
    );
  }

  /**
   * Validates whether a client IP is allowed by a list of allowed subnets / rules
   * Supported rule presets:
   *  - 'any' | '*' | 'global' -> allow any IP
   *  - 'local' | 'localhost'  -> allow 127.0.0.0/8 only
   *  - 'lan' | 'private'      -> allow RFC1918 LAN ranges
   *  - CIDR like '192.168.1.0/24' or '10.50.0.0/16'
   *  - Single IP like '192.168.1.45'
   */
  public static isAllowed(clientIp: string, allowedRules?: string[]): boolean {
    if (!allowedRules || allowedRules.length === 0) {
      return true; // No restriction by default
    }

    const cleanIp = this.normalizeIp(clientIp);

    for (const rule of allowedRules) {
      const r = rule.trim().toLowerCase();
      if (!r) continue;

      if (r === '*' || r === 'any' || r === 'global') {
        return true;
      }
      if (r === 'local' || r === 'localhost') {
        if (cleanIp === '127.0.0.1' || this.matchesCidr(cleanIp, '127.0.0.0/8')) {
          return true;
        }
      }
      if (r === 'lan' || r === 'private') {
        if (this.isPrivateOrLocal(cleanIp)) {
          return true;
        }
      }
      // Check CIDR or single IP
      const cidr = r.includes('/') ? r : `${r}/32`;
      if (this.matchesCidr(cleanIp, cidr)) {
        return true;
      }
    }

    return false;
  }
}
