import { describe, expect, it } from 'vitest';
import encodeQR from 'qr';
import decodeQR from 'qr/decode.js';
import { biliQrImage } from '../src/main/bili-qr';

describe('TypeScript Bilibili QR renderer', () => {
  it('renders a local image and round-trips the exact official URL', () => {
    const url = 'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=isolated-fixture';
    expect(biliQrImage(url)).toBe(encodeQR(url, 'data-url', { border: 4, scale: 5 }));
    const image = Buffer.from(biliQrImage(url).split(',')[1], 'base64');
    expect(image.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
    const raw = encodeQR(url, 'raw', { border: 4, scale: 5 });
    const width = raw[0].length, height = raw.length, data = new Uint8Array(width * height * 4);
    for (const [y, row] of raw.entries()) for (const [x, black] of row.entries()) {
      const offset = (y * width + x) * 4;
      data.set([black ? 0 : 255, black ? 0 : 255, black ? 0 : 255, 255], offset);
    }
    expect(decodeQR({ data, width, height })).toBe(url);
  });
  it.each(['https://example.com/login', 'http://passport.bilibili.com/', 'https://passport.bilibili.com:444/', 'https://user:password@passport.bilibili.com/', 'not a URL', 'https://passport.bilibili.com/' + 'a'.repeat(2001)])('rejects an untrusted QR URL %s', url => {
    expect(() => biliQrImage(url)).toThrow('扫码地址无效');
  });
});
