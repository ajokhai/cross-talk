/**
 * Subnet and Network Boundary Isolation Utility
 * Enforces CIDR restrictions so sockets never spill data over unauthorized networks.
 * Zero external dependencies.
 */
export declare class SubnetGuard {
    /**
     * Normalizes an IP string (unwraps IPv6 mapped IPv4 like ::ffff:192.168.1.10)
     */
    static normalizeIp(rawIp: string): string;
    /**
     * Converts IPv4 string to 32-bit unsigned integer
     */
    private static ipv4ToInt;
    /**
     * Checks if an IPv4 address is inside an IPv4 CIDR block (e.g. 192.168.1.0/24)
     */
    static matchesCidr(ip: string, cidr: string): boolean;
    /**
     * Checks if an IP is within private RFC1918 LAN space (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
     */
    static isPrivateOrLocal(ip: string): boolean;
    /**
     * Validates whether a client IP is allowed by a list of allowed subnets / rules
     * Supported rule presets:
     *  - 'any' | '*' | 'global' -> allow any IP
     *  - 'local' | 'localhost'  -> allow 127.0.0.0/8 only
     *  - 'lan' | 'private'      -> allow RFC1918 LAN ranges
     *  - CIDR like '192.168.1.0/24' or '10.50.0.0/16'
     *  - Single IP like '192.168.1.45'
     */
    static isAllowed(clientIp: string, allowedRules?: string[]): boolean;
}
