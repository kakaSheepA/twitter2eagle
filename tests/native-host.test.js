import { spawn } from 'node:child_process';
import { access, writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { commitJob, downloadOne } = require('../native-host/x-media-eagle-host.js');

it('answers a native messaging ping without writing non-protocol output', async () => {
  const child = spawn(process.execPath, ['native-host/x-media-eagle-host.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const payload = Buffer.from(JSON.stringify({ type: 'PING' }));
  const frame = Buffer.alloc(payload.length + 4); frame.writeUInt32LE(payload.length, 0); payload.copy(frame, 4);
  const reply = await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve); child.once('error', reject); child.stdin.write(frame);
  });
  const size = reply.readUInt32LE(0);
  expect(JSON.parse(reply.subarray(4, 4 + size).toString())).toEqual({ type: 'PONG' });
  child.kill();
});

it('uses a browser-downloaded local file without making another network request', async () => {
  const path = join(tmpdir(), `x-media-local-${Date.now()}.jpg`);
  await writeFile(path, 'image');
  const fetchImpl = () => { throw new Error('network should not be used'); };
  await expect(downloadOne({ key: 'one', localPath: path, filename: 'one.jpg' }, tmpdir(), 0, { fetchImpl }))
    .resolves.toMatchObject({ item: { key: 'one' }, path });
});

it('imports an externally downloaded Telegram video with caller metadata', async () => {
  const localPath = join(tmpdir(), `telegram-local-${Date.now()}.mp4`);
  await writeFile(localPath, 'video');
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'success' }) }));
  const item = {
    key: 'telegram:1:2:video',
    kind: 'video',
    localPath,
    filename: '2.mp4',
    tags: ['Telegram', '视频'],
    annotation: 'Telegram 消息 ID：2'
  };

  await expect(commitJob({ folderId: 'folder-1', items: [item] }, fetchImpl))
    .resolves.toEqual({ imported: 1, deduplicated: 0, failed: [] });
  await expect(access(localPath)).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://localhost:41595/api/item/addFromPaths',
    expect.objectContaining({ body: expect.stringContaining('Telegram 消息 ID：2') })
  );
});

it('continues to build the existing X image payload when no caller metadata is supplied', async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url === 'https://pbs.twimg.com/a.jpg') return new Response('image', { status: 200 });
    return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
  });
  const item = { key: 'x:1', kind: 'image', url: 'https://pbs.twimg.com/a.jpg', filename: 'a.jpg', tweetId: '1' };

  await expect(commitJob({ folderId: 'folder-1', username: 'alice', items: [item] }, fetchImpl))
    .resolves.toMatchObject({ imported: 1 });
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://localhost:41595/api/item/addFromPaths',
    expect.objectContaining({ body: expect.stringContaining('https://x.com/i/status/1') })
  );
});

it('downloads an HLS playlist and imports the merged MP4 through Eagle', async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url === 'https://video.twimg.com/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8\n', { status: 200 });
    if (url === 'https://video.twimg.com/variant.m3u8') return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1.0,\nseg1.m4s\n#EXTINF:1.0,\nseg2.m4s\n#EXT-X-ENDLIST\n', { status: 200 });
    if (url === 'https://video.twimg.com/init.mp4') return new Response('init', { status: 200 });
    if (url === 'https://video.twimg.com/seg1.m4s') return new Response('seg1', { status: 200 });
    if (url === 'https://video.twimg.com/seg2.m4s') return new Response('seg2', { status: 200 });
    return { ok: true, status: 200, json: async () => ({ status: 'success' }) };
  });
  const item = { key: 'x:hls', kind: 'hls', url: 'https://video.twimg.com/master.m3u8', filename: 'video.m3u8', tweetId: '1' };

  await expect(commitJob({ folderId: 'folder-1', username: 'alice', items: [item] }, fetchImpl))
    .resolves.toMatchObject({ imported: 1, failed: [] });
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://localhost:41595/api/item/addFromPaths',
    expect.objectContaining({ body: expect.stringContaining('video.mp4') })
  );
});

it('forces an .mp4 output when the stored HLS filename is a jpg placeholder', async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url === 'https://video.twimg.com/master.m3u8') return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8\n', { status: 200 });
    if (url === 'https://video.twimg.com/variant.m3u8') return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1.0,\nseg1.m4s\n#EXT-X-ENDLIST\n', { status: 200 });
    if (url === 'https://video.twimg.com/init.mp4') return new Response(Buffer.from([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), { status: 200 });
    if (url === 'https://video.twimg.com/seg1.m4s') return new Response(Buffer.from([0x6d, 0x6f, 0x6f, 0x66]), { status: 200 });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  const directory = await mkdtemp(join(tmpdir(), 'x-media-hls-'));
  const item = { key: 'x:hls', kind: 'hls', url: 'https://video.twimg.com/master.m3u8', filename: '2026-08-16_01_标题.jpg', tweetId: '1' };

  const result = await downloadOne(item, directory, 0, { fetchImpl });
  expect(result.path.toLowerCase().endsWith('.mp4')).toBe(true);
  const bytes = await readFile(result.path);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('ftyp');
});
