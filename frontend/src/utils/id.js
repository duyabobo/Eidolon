/**
 * 生成 UUID。
 * 公网以 http://IP 访问时不是 Secure Context，crypto.randomUUID 不可用。
 */
export function randomUUID() {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === "function") {
        return webCrypto.randomUUID();
    }
    // getRandomValues 在非 HTTPS 下通常仍可用
    if (typeof webCrypto?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        webCrypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
        const n = (Math.random() * 16) | 0;
        const v = ch === "x" ? n : (n & 0x3) | 0x8;
        return v.toString(16);
    });
}
