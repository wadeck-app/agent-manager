import { describe, expect, it, vi } from 'vitest';
import { prepareImage, type Reencode } from './imagePipeline.js';

const file = (size: number, type = 'image/png', name = 'shot.png'): File => new File([new Uint8Array(size)], name, { type });

describe('prepareImage', () => {
  it('attaches an image that fits as it is', async () => {
    const result = await prepareImage(file(300), 1000);
    expect(result).toMatchObject({ ok: true, image: { name: 'shot.png', mime: 'image/png', bytes: 300 } });
    expect(result.ok && result.image.note).toBeUndefined();
  });

  it('refuses an unsupported type and says which are accepted', async () => {
    const result = await prepareImage(file(10, 'image/bmp', 'a.bmp'), 1000);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/only PNG, JPEG, GIF and WebP/);
  });

  it('shrinks a large image and tells the user', async () => {
    const reencode: Reencode = vi.fn((_file, side) => Promise.resolve(new Blob([new Uint8Array(side > 1500 ? 90_000 : 30_000)])));
    const result = await prepareImage(file(200_000), 50_000, reencode);
    expect(result).toMatchObject({ ok: true, image: { mime: 'image/jpeg', name: 'shot.jpg', bytes: 30_000 } });
    expect(result.ok && result.image.note).toMatch(/Shrunk from .* to 29 KB/);
  });

  it('refuses when even the smallest size stays too big', async () => {
    const reencode: Reencode = () => Promise.resolve(new Blob([new Uint8Array(90_000)]));
    const result = await prepareImage(file(200_000), 50_000, reencode);
    expect(!result.ok && result.message).toMatch(/Crop it/);
  });

  it('reports a failing canvas instead of dropping the image silently', async () => {
    const reencode: Reencode = () => Promise.reject(new Error('no canvas'));
    const result = await prepareImage(file(200_000), 50_000, reencode);
    expect(!result.ok && result.message).toMatch(/re-encoding failed \(no canvas\)/);
  });

  it('does not shrink a GIF (the animation would be lost)', async () => {
    const result = await prepareImage(file(200_000, 'image/gif', 'a.gif'), 50_000);
    expect(!result.ok && result.message).toMatch(/GIF/);
  });
});
