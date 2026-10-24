import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parsePlaylist, selectHighestVariant } from '../src/shared/hls.js';

it('selects the highest-bandwidth variant from an HLS master playlist', () => {
  const playlist = parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\nhigh.m3u8', 'https://video.twimg.com/a/master.m3u8');
  expect(selectHighestVariant(playlist.variants).url).toBe('https://video.twimg.com/a/high.m3u8');
});

it('rejects encrypted HLS playlists before downloading segments', () => {
  expect(() => parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\npart.ts', 'https://video.twimg.com/a/stream.m3u8'))
    .toThrow('不支持加密 HLS 视频');
});

it('keeps the fMP4 initialization segment required to export an HLS video', () => {
  const playlist = parsePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nsegment-1.m4s', 'https://video.twimg.com/a/stream.m3u8');
  expect(playlist).toMatchObject({
    initSegmentUrl: 'https://video.twimg.com/a/init.mp4',
    segments: ['https://video.twimg.com/a/segment-1.m4s']
  });
});

it('uses the mux.js 6 Transmuxer export in the HLS worker', () => {
  expect(readFileSync('src/panel/hls-worker.js', 'utf8'))
    .toContain('new self.muxjs.Transmuxer');
});
