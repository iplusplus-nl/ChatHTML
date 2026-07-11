import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type RetrievalUrlPolicyConfig = {
  allowPrivateUrls: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
};

export type RetrievalDnsAddress = {
  address: string;
  family: number;
};

export type RetrievalDnsLookup = (
  hostname: string
) => Promise<readonly RetrievalDnsAddress[]>;

export type RetrievalUrlPolicyDependencies = {
  lookup?: RetrievalDnsLookup;
};

export type ResolvedRetrievalTarget = {
  hostname: string;
  addresses: readonly RetrievalDnsAddress[];
};

export class RetrievalUrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalUrlPolicyError";
  }
}

function normalizedHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

export function getRetrievalHostname(value: string): string | undefined {
  try {
    return normalizedHostname(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

export function matchesRetrievalDomain(
  hostname: string,
  domain: string
): boolean {
  const normalizedHost = normalizedHostname(hostname);
  const normalizedDomain = normalizedHostname(domain);
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

export function isRetrievalDomainPermitted(
  url: string,
  config: RetrievalUrlPolicyConfig
): boolean {
  const hostname = getRetrievalHostname(url);
  if (!hostname) {
    return false;
  }

  if (
    config.blockedDomains?.some((domain) =>
      matchesRetrievalDomain(hostname, domain)
    )
  ) {
    return false;
  }

  return !(
    config.allowedDomains &&
    !config.allowedDomains.some((domain) =>
      matchesRetrievalDomain(hostname, domain)
    )
  );
}

function parseIpv4Bytes(value: string): number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const bytes = parts.map((part) => Number(part));
  if (
    bytes.some(
      (part) =>
        !Number.isInteger(part) || part < 0 || part > 255 || String(part) === "NaN"
    )
  ) {
    return undefined;
  }

  return bytes;
}

function ipv4InCidr(bytes: number[], base: number[], prefixLength: number) {
  let remaining = prefixLength;
  for (let index = 0; index < 4 && remaining > 0; index += 1) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((bytes[index] & mask) !== (base[index] & mask)) {
      return false;
    }
    remaining -= bits;
  }
  return true;
}

const NON_PUBLIC_IPV4_CIDRS: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4]
];

function isPrivateOrReservedIpv4(value: string): boolean {
  const bytes = parseIpv4Bytes(value);
  if (!bytes) {
    return true;
  }

  return NON_PUBLIC_IPV4_CIDRS.some(([base, prefixLength]) =>
    ipv4InCidr(bytes, base, prefixLength)
  );
}

function ipv6Groups(value: string): number[] | undefined {
  const withoutZone = value.split("%", 1)[0].toLowerCase();
  if (isIP(withoutZone) !== 6) {
    return undefined;
  }

  const doubleColonIndex = withoutZone.indexOf("::");
  if (
    doubleColonIndex !== -1 &&
    withoutZone.indexOf("::", doubleColonIndex + 2) !== -1
  ) {
    return undefined;
  }

  const expandSide = (side: string): number[] | undefined => {
    if (!side) {
      return [];
    }

    const tokens = side.split(":");
    const groups: number[] = [];
    for (const token of tokens) {
      if (token.includes(".")) {
        const ipv4 = parseIpv4Bytes(token);
        if (!ipv4) {
          return undefined;
        }
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }

      const parsed = Number.parseInt(token, 16);
      if (!token || token.length > 4 || !Number.isInteger(parsed)) {
        return undefined;
      }
      groups.push(parsed);
    }
    return groups;
  };

  const leftText =
    doubleColonIndex === -1
      ? withoutZone
      : withoutZone.slice(0, doubleColonIndex);
  const rightText =
    doubleColonIndex === -1
      ? ""
      : withoutZone.slice(doubleColonIndex + 2);
  const left = expandSide(leftText);
  const right = expandSide(rightText);
  if (!left || !right) {
    return undefined;
  }

  if (doubleColonIndex === -1) {
    return left.length === 8 ? left : undefined;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return undefined;
  }
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function ipv6Bytes(value: string): number[] | undefined {
  const groups = ipv6Groups(value);
  if (!groups) {
    return undefined;
  }

  return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}

function hasBytePrefix(
  bytes: number[],
  prefix: number[],
  prefixLength: number
): boolean {
  let remaining = prefixLength;
  for (let index = 0; remaining > 0; index += 1) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((bytes[index] & mask) !== ((prefix[index] ?? 0) & mask)) {
      return false;
    }
    remaining -= bits;
  }
  return true;
}

function embeddedIpv4IsPrivate(bytes: number[], startIndex: number): boolean {
  return isPrivateOrReservedIpv4(
    bytes.slice(startIndex, startIndex + 4).join(".")
  );
}

function isPrivateOrReservedIpv6(value: string): boolean {
  const bytes = ipv6Bytes(value);
  if (!bytes) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96) must inherit the IPv4 policy.
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return embeddedIpv4IsPrivate(bytes, 12);
  }

  // IPv4-compatible addresses are deprecated and should never be used to
  // bypass direct IPv4 validation.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return true;
  }

  // The well-known NAT64 prefix embeds an IPv4 destination in the final bits.
  if (hasBytePrefix(bytes, [0x00, 0x64, 0xff, 0x9b], 96)) {
    return embeddedIpv4IsPrivate(bytes, 12);
  }

  // The local-use NAT64 prefix permits several embedding layouts. Block the
  // complete range because a host-local translator can map it to private IPv4.
  if (hasBytePrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)) {
    return true;
  }

  // IPv4-translated addresses used by SIIT can likewise route to an embedded
  // private IPv4 destination. Treat the complete translation prefix as local.
  if (
    bytes.slice(0, 8).every((byte) => byte === 0) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  ) {
    return true;
  }

  // 6to4 embeds an IPv4 relay destination after the 2002::/16 prefix.
  if (hasBytePrefix(bytes, [0x20, 0x02], 16) && embeddedIpv4IsPrivate(bytes, 2)) {
    return true;
  }

  return (
    hasBytePrefix(bytes, [0xfc], 7) || // unique-local
    hasBytePrefix(bytes, [0xfe, 0x80], 10) || // link-local
    hasBytePrefix(bytes, [0xfe, 0xc0], 10) || // deprecated site-local
    hasBytePrefix(bytes, [0xff], 8) || // multicast
    hasBytePrefix(bytes, [0x01, 0, 0, 0, 0, 0, 0, 0], 64) || // discard-only
    hasBytePrefix(bytes, [0x01, 0, 0, 0, 0, 0, 0, 0x01], 64) || // dummy
    hasBytePrefix(bytes, [0x3f, 0xff, 0x00], 20) || // documentation
    hasBytePrefix(bytes, [0x5f, 0x00], 16) || // segment-routing SIDs
    hasBytePrefix(bytes, [0x20, 0x01, 0x00, 0x00], 32) || // Teredo
    hasBytePrefix(bytes, [0x20, 0x01, 0x00, 0x02, 0x00, 0x00], 48) || // benchmark
    hasBytePrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) || // documentation
    hasBytePrefix(bytes, [0x20, 0x01, 0x00, 0x10], 28) || // ORCHID
    hasBytePrefix(bytes, [0x20, 0x01, 0x00, 0x20], 28) // ORCHIDv2
  );
}

export function isPrivateOrReservedIpAddress(ip: string): boolean {
  const normalized = normalizedHostname(ip).split("%", 1)[0];
  const version = isIP(normalized);
  if (version === 4) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (version === 6) {
    return isPrivateOrReservedIpv6(normalized);
  }
  return true;
}

const defaultLookup: RetrievalDnsLookup = async (hostname) =>
  nodeLookup(hostname, { all: true, verbatim: true });

export async function resolveRetrievalUrlTarget(
  url: string,
  config: RetrievalUrlPolicyConfig,
  dependencies: RetrievalUrlPolicyDependencies = {}
): Promise<ResolvedRetrievalTarget> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RetrievalUrlPolicyError("Retrieval URL is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RetrievalUrlPolicyError(
      "Only http and https URLs can be retrieved."
    );
  }

  if (parsed.username || parsed.password) {
    throw new RetrievalUrlPolicyError(
      "URLs containing credentials cannot be retrieved."
    );
  }

  if (!isRetrievalDomainPermitted(parsed.toString(), config)) {
    throw new RetrievalUrlPolicyError(
      "URL is blocked by retrieval domain controls."
    );
  }

  if (config.allowPrivateUrls) {
    return {
      hostname: normalizedHostname(parsed.hostname),
      addresses: []
    };
  }

  const hostname = normalizedHostname(parsed.hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new RetrievalUrlPolicyError(
      "Private and local URLs are disabled for retrieval."
    );
  }

  if (isIP(hostname)) {
    if (isPrivateOrReservedIpAddress(hostname)) {
      throw new RetrievalUrlPolicyError(
        "Private and local URLs are disabled for retrieval."
      );
    }
    return {
      hostname,
      addresses: [{ address: hostname, family: isIP(hostname) }]
    };
  }

  let addresses: readonly RetrievalDnsAddress[];
  try {
    addresses = await (dependencies.lookup ?? defaultLookup)(hostname);
  } catch {
    throw new RetrievalUrlPolicyError(
      "Retrieval hostname could not be safely resolved."
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) =>
      isPrivateOrReservedIpAddress(address.address)
    )
  ) {
    throw new RetrievalUrlPolicyError(
      "Private and local URLs are disabled for retrieval."
    );
  }

  return {
    hostname,
    addresses: addresses.map(({ address }) => ({
      address: normalizedHostname(address).split("%", 1)[0],
      family: isIP(normalizedHostname(address).split("%", 1)[0])
    }))
  };
}

export async function assertPublicRetrievalUrl(
  url: string,
  config: RetrievalUrlPolicyConfig,
  dependencies: RetrievalUrlPolicyDependencies = {}
): Promise<void> {
  await resolveRetrievalUrlTarget(url, config, dependencies);
}
