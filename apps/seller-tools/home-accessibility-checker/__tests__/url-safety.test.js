const {
  LISTING_HOST_SUFFIXES,
  assertPublicHttpsUrl,
  isPublicIpAddress,
  parseSafeHttpsUrl,
} = require("../services/url-safety");

describe("remote URL safety", () => {
  test("accepts supported HTTPS listing hosts with public DNS", async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    await expect(
      assertPublicHttpsUrl("https://www.zillow.com/homedetails/123", {
        allowedHostSuffixes: LISTING_HOST_SUFFIXES,
        lookup,
      }),
    ).resolves.toBe("https://www.zillow.com/homedetails/123");
  });

  test("rejects host spoofing, credentials, HTTP, and nonstandard ports", () => {
    for (const url of [
      "https://zillow.com.attacker.example/listing",
      "https://user:password@www.zillow.com/listing",
      "http://www.zillow.com/listing",
      "https://www.zillow.com:8443/listing",
    ]) {
      expect(() =>
        parseSafeHttpsUrl(url, {
          allowedHostSuffixes: LISTING_HOST_SUFFIXES,
        }),
      ).toThrow(expect.objectContaining({ code: "UNSAFE_REMOTE_URL" }));
    }
  });

  test("rejects direct private and reserved IP addresses", async () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      const host = address.includes(":") ? `[${address}]` : address;
      await expect(
        assertPublicHttpsUrl(`https://${host}/image.jpg`),
      ).rejects.toMatchObject({ code: "UNSAFE_REMOTE_URL" });
    }
  });

  test("accepts a public IPv6 literal without attempting DNS lookup", async () => {
    const lookup = jest.fn();

    await expect(
      assertPublicHttpsUrl("https://[2606:4700:4700::1111]/image.jpg", {
        lookup,
      }),
    ).resolves.toBe("https://[2606:4700:4700::1111]/image.jpg");
    expect(lookup).not.toHaveBeenCalled();
  });

  test("rejects a hostname when any DNS answer is private", async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      assertPublicHttpsUrl("https://images.example.com/image.jpg", { lookup }),
    ).rejects.toMatchObject({
      code: "UNSAFE_REMOTE_URL",
      statusCode: 400,
    });
  });

  test("classifies public and private IPs conservatively", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("192.168.0.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("not-an-ip")).toBe(false);
  });
});
