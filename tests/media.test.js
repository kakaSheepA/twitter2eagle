import { describe, expect, it } from 'vitest';
import { downloadFilename, highestBitrateMp4, mediaKey, originalImageUrl } from '../src/shared/media.js';

describe('media helpers', () => {
  it('requests an original image', () => {
    expect(originalImageUrl('https://pbs.twimg.com/media/a?format=jpg&name=small'))
      .toBe('https://pbs.twimg.com/media/a?format=jpg&name=orig');
  });

  it('chooses the largest MP4 bitrate', () => {
    expect(highestBitrateMp4([
      { url: 'low.mp4', content_type: 'video/mp4', bitrate: 256000 },
      { url: 'high.mp4', content_type: 'video/mp4', bitrate: 2176000 }
    ])).toEqual({ url: 'high.mp4', bitrate: 2176000 });
  });

  it('formats a collision-safe filename', () => {
    expect(downloadFilename('alice', '2026-08-16T14:32:05Z', 2, 'jpg', 1))
      .toBe('alice/2026-08-16_02_01.jpg');
  });

  it('adds a safe shortened tweet title after the media sequence number', () => {
    expect(downloadFilename('alice', '2026-08-16T14:32:05Z', 2, 'jpg', 0, '发布：Hello / world?  '))
      .toBe('alice/2026-08-16_02_发布：Hello _ world_.jpg');
  });

  it('creates a stable media key', () => {
    expect(mediaKey('1', 0, 'https://pbs.twimg.com/media/a?name=orig')).toBe('1:0:https://pbs.twimg.com/media/a?name=orig');
  });
});
