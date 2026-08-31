import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedSourceUrl } from "../src/sources.mjs";
import { testing } from "../src/scraper.mjs";

const { isPrivateAddress } = testing;

describe("isPrivateAddress — ochrona przed pobieraniem z sieci wewnętrznej", () => {
  const prywatne = ["127.0.0.1", "10.0.0.5", "172.16.4.1", "192.168.1.10", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fd12::9", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"];
  const publiczne = ["8.8.8.8", "1.1.1.1", "146.59.12.239", "2001:4860:4860::8888"];

  prywatne.forEach((address) => it(`blokuje ${address}`, () => assert.equal(isPrivateAddress(address), true)));
  publiczne.forEach((address) => it(`dopuszcza ${address}`, () => assert.equal(isPrivateAddress(address), false)));
});

describe("isAllowedSourceUrl — allowlista domen źródła", () => {
  const source = { hosts: ["www.rmf24.pl", "rmf24.pl"] };

  it("dopuszcza adres HTTPS z listy", () => {
    assert.equal(isAllowedSourceUrl(source, "https://www.rmf24.pl/fakty/artykul"), true);
  });

  it("odrzuca inną domenę", () => {
    assert.equal(isAllowedSourceUrl(source, "https://podrobka-rmf24.pl/fakty"), false);
  });

  it("odrzuca protokół inny niż HTTPS", () => {
    assert.equal(isAllowedSourceUrl(source, "http://www.rmf24.pl/fakty"), false);
  });

  it("odrzuca nieprawidłowy adres", () => {
    assert.equal(isAllowedSourceUrl(source, "rmf24"), false);
  });
});
