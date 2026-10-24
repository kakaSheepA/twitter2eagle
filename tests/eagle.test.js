import { expect, it } from 'vitest';
import { eagleImportPayload, isEagleImportable, tweetSourceUrl } from '../src/shared/eagle.js';

it('uses the owning X status as the Eagle website URL', () => {
  expect(tweetSourceUrl('2087157654173087879')).toBe('https://x.com/i/status/2087157654173087879');
});

it('builds a direct Eagle import payload with source tweet and media tags', () => {
  expect(eagleImportPayload({ tweetId: '123', kind: 'image', url: 'https://pbs.twimg.com/media/a.jpg', filename: 'alice/2026-08-16_01_短标题.jpg', tweetText: '完整推文正文' }, 'alice'))
    .toEqual({
      url: 'https://pbs.twimg.com/media/a.jpg',
      name: '2026-08-16_01_短标题.jpg',
      website: 'https://x.com/i/status/123',
      tags: ['X', 'alice', '图片'],
      annotation: '完整推文正文',
      kind: 'image',
      requiresLocalImport: false
    });
});

it('does not expose an image content hash as an Eagle tag', () => {
  expect(eagleImportPayload({ tweetId: '123', kind: 'image', url: 'https://pbs.twimg.com/media/a.jpg', filename: 'alice/2026-08-16_01.jpg', contentHash: 'abc123' }, 'alice').tags)
    .toEqual(['X', 'alice', '图片']);
});

it('includes HLS playlists for local import and flags them as requiring local import', () => {
  expect(isEagleImportable({ kind: 'hls', url: 'https://video.twimg.com/playlist.m3u8' })).toBe(true);
  expect(eagleImportPayload({ kind: 'hls', url: 'https://video.twimg.com/playlist.m3u8', filename: 'alice/video.m3u8' }, 'alice').requiresLocalImport).toBe(true);
  expect(eagleImportPayload({ kind: 'hls', url: 'https://video.twimg.com/playlist.m3u8', filename: 'alice/video.m3u8' }, 'alice').name).toBe('video.m3u8');
  expect(isEagleImportable({ kind: 'video', url: 'https://video.twimg.com/video.mp4' })).toBe(true);
  expect(eagleImportPayload({ kind: 'video', url: 'https://video.twimg.com/video.mp4' }, 'alice').requiresLocalImport).toBe(false);
});

it('does not re-import an Eagle item already marked as saved', () => {
  expect(isEagleImportable({ kind: 'image', url: 'https://pbs.twimg.com/a.jpg', eagleStatus: 'imported' })).toBe(false);
});

it('allows an already-saved item when the user explicitly requests a re-import', () => {
  expect(isEagleImportable({ kind: 'image', url: 'https://pbs.twimg.com/a.jpg', eagleStatus: 'imported' }, true)).toBe(true);
});
