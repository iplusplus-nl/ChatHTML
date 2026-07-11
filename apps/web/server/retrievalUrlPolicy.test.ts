import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicRetrievalUrl,
  isPrivateOrReservedIpAddress,
  isRetrievalDomainPermitted,
  matchesRetrievalDomain,
  type RetrievalDnsLookup,
  type RetrievalUrlPolicyConfig
} from "./retrievalUrlPolicy.js";

const strictPolicy: RetrievalUrlPolicyConfig = {
  allowPrivateUrls: false
};

const publicLookup: RetrievalDnsLookup = async () => [
  { address: "93.184.216.34", family: 4 },
  { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
];

test("IP policy rejects private, local, reserved, and mapped addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "100:0:0:1::1",
    "2001:db8::1",
    "3fff::1",
    "5f00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
    "::ffff:172.16.0.1",
    "::ffff:192.168.1.1",
    "64:ff9b::127.0.0.1",
    "64:ff9b:1:7f00:1::",
    "::ffff:0:127.0.0.1",
    "2002:7f00:1::"
  ]) {
    assert.equal(isPrivateOrReservedIpAddress(address), true, address);
  }

  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8"
  ]) {
    assert.equal(isPrivateOrReservedIpAddress(address), false, address);
  }
});

test("URL policy rejects private IPv4, IPv6, and IPv4-mapped literals", async () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "http://0177.0.0.1/admin",
    "http://2130706433/admin",
    "http://[::1]/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "http://[::ffff:7f00:1]/admin"
  ]) {
    await assert.rejects(
      assertPublicRetrievalUrl(url, strictPolicy, { lookup: publicLookup }),
      /Private and local URLs/
    );
  }
});

test("URL policy checks every DNS answer and accepts only public results", async () => {
  await assert.doesNotReject(
    assertPublicRetrievalUrl("https://public.example/page", strictPolicy, {
      lookup: publicLookup
    })
  );

  await assert.rejects(
    assertPublicRetrievalUrl("https://mixed.example/page", strictPolicy, {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ]
    }),
    /Private and local URLs/
  );

  await assert.rejects(
    assertPublicRetrievalUrl("https://empty.example/page", strictPolicy, {
      lookup: async () => []
    }),
    /Private and local URLs/
  );

  await assert.rejects(
    assertPublicRetrievalUrl("https://failed.example/page", strictPolicy, {
      lookup: async () => {
        throw new Error("DNS unavailable");
      }
    }),
    /could not be safely resolved/
  );

  for (const address of [
    "64:ff9b:1:7f00:1::",
    "::ffff:0:127.0.0.1"
  ]) {
    await assert.rejects(
      assertPublicRetrievalUrl("https://translated.example/page", strictPolicy, {
        lookup: async () => [{ address, family: 6 }]
      }),
      /Private and local URLs/
    );
  }
});

test("URL policy rejects local names, credentials, and non-HTTP protocols", async () => {
  for (const url of [
    "http://localhost/",
    "http://service.local/",
    "file:///etc/passwd",
    "https://user:secret@public.example/"
  ]) {
    await assert.rejects(
      assertPublicRetrievalUrl(url, strictPolicy, { lookup: publicLookup })
    );
  }
});

test("domain controls normalize subdomains and trailing dots", async () => {
  assert.equal(matchesRetrievalDomain("www.Example.com.", "example.com"), true);
  assert.equal(matchesRetrievalDomain("notexample.com", "example.com"), false);

  const policy: RetrievalUrlPolicyConfig = {
    allowPrivateUrls: false,
    allowedDomains: ["example.com"],
    blockedDomains: ["blocked.example.com"]
  };
  assert.equal(isRetrievalDomainPermitted("https://www.example.com/", policy), true);
  assert.equal(
    isRetrievalDomainPermitted("https://blocked.example.com/", policy),
    false
  );
  assert.equal(isRetrievalDomainPermitted("https://example.net/", policy), false);

  await assert.rejects(
    assertPublicRetrievalUrl("https://blocked.example.com/", policy, {
      lookup: publicLookup
    }),
    /domain controls/
  );
});

test("private URLs are allowed only behind the explicit opt-in", async () => {
  await assert.doesNotReject(
    assertPublicRetrievalUrl("http://127.0.0.1/", {
      allowPrivateUrls: true
    })
  );
});
