import { createHash } from "node:crypto";

export const FIREFOX_EXTENSION_ID = "browser-bridge@agenthost.local";
export const CHROMIUM_EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu0w9O4zMBh5dCX9RxuFAv/QvgbSFhmsGTkw4lE1HpEmzxWnaMdkIrjFlv+MVw4fPcqOov6V0s6ys5XU0RmyWcjd1W5P7rF3Zl5ZjIIr2LJP0Yab+3EMZ/ME/y/6swbvCktVLn/tOWtsNgg/cSSz/WSdsiHeK3WQVzPFsi+XKHYDqNfXCGbRv1PB8LTC0z5yoVtfTqFiyJWBRjj1lAo4apbgSZjs4nZ2VSyNu2wlsAnveOfwE2DYkr1Mn94JqktbB/GUo1d6FkeVhIIQg26Xsw3O34R8J7ySZekBlMXOgGVa1wlVcVwDyZ1coMnAM6RHkTPeKW9Ut+WwAIVHEtMLn0QIDAQAB";

export function chromiumExtensionId(publicKey = CHROMIUM_EXTENSION_PUBLIC_KEY): string {
  const digest = createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest()
    .subarray(0, 16);
  return [...digest]
    .map((value) => String.fromCharCode(97 + (value >> 4), 97 + (value & 15)))
    .join("");
}

export const CHROMIUM_EXTENSION_ID = chromiumExtensionId();

export function expectedExtensionId(family: "firefox" | "chromium"): string {
  return family === "firefox" ? FIREFOX_EXTENSION_ID : CHROMIUM_EXTENSION_ID;
}
