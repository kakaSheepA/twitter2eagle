const { createWriteStream, promises: fs } = require('node:fs');
const { basename, join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const muxjs = require('../node_modules/mux.js/dist/mux-mp4.min.js');

let input = Buffer.alloc(0);
let job = null;

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([size, body]));
}

function safeFilename(value, index) {
  const name = basename(String(value || `image-${index + 1}.jpg`)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  return name || `image-${index + 1}.jpg`;
}

function parseM3u8(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('无效 HLS 播放清单');
  if (lines.some((line) => line.startsWith('#EXT-X-KEY'))) throw new Error('不支持加密 HLS 视频');
  const variants = [];
  const segments = [];
  let initSegmentUrl = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('#EXT-X-STREAM-INF')) {
      const bandwidth = Number(lines[index].match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
      const uri = lines.slice(index + 1).find((line) => !line.startsWith('#'));
      if (uri) variants.push({ url: new URL(uri, baseUrl).toString(), bandwidth });
    }
    if (lines[index].startsWith('#EXT-X-MAP')) {
      const uri = lines[index].match(/URI=(?:"([^"]+)"|([^,]+))/)?.[1] ?? lines[index].match(/URI=(?:"([^"]+)"|([^,]+))/)?.[2];
      if (uri) initSegmentUrl = new URL(uri, baseUrl).toString();
    }
    if (!lines[index].startsWith('#')) segments.push(new URL(lines[index], baseUrl).toString());
  }
  return { variants, segments, initSegmentUrl };
}

async function mediaPlaylist(url, fetchImpl) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://x.com/' };
  const first = parseM3u8(await (await fetchImpl(url, { headers })).text(), url);
  if (!first.variants.length) return first;
  const highest = [...first.variants].sort((left, right) => right.bandwidth - left.bandwidth)[0];
  return parseM3u8(await (await fetchImpl(highest.url, { headers })).text(), highest.url);
}

async function downloadHls(item, directory, index, { fetchImpl = fetch } = {}) {
  const playlist = await mediaPlaylist(item.url, fetchImpl);
  if (!playlist.segments.length) throw new Error('播放清单没有媒体分片');
  const chunks = [];
  let transmuxer = null;
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://x.com/' };
  if (playlist.initSegmentUrl) {
    const initResponse = await fetchImpl(playlist.initSegmentUrl, { headers });
    if (!initResponse.ok) throw new Error(`视频初始化分片请求失败（HTTP ${initResponse.status}）`);
    chunks.push(Buffer.from(await initResponse.arrayBuffer()));
  } else {
    transmuxer = new muxjs.Transmuxer({ remux: true });
    let sentInit = false;
    transmuxer.on('data', (segment) => {
      if (!sentInit && segment.initSegment?.byteLength) { chunks.push(Buffer.from(segment.initSegment.buffer)); sentInit = true; }
      if (segment.data?.byteLength) chunks.push(Buffer.from(segment.data.buffer));
    });
  }
  for (let i = 0; i < playlist.segments.length; i += 1) {
    const response = await fetchImpl(playlist.segments[i], { headers });
    if (!response.ok) throw new Error(`视频分片请求失败（HTTP ${response.status}）`);
    const bytes = await response.arrayBuffer();
    if (playlist.initSegmentUrl) chunks.push(Buffer.from(bytes));
    else { transmuxer.push(new Uint8Array(bytes)); transmuxer.flush(); }
  }
  if (!chunks.length) throw new Error('该 HLS 分片格式暂不支持导出 MP4');
  const baseName = safeFilename(item.filename, index).replace(/\.[^.\\/?]+($|\?)/i, '.mp4');
  const path = join(directory, `${String(index).padStart(5, '0')}-${baseName}`);
  await fs.writeFile(path, Buffer.concat(chunks));
  return { item, path, external: false };
}

async function downloadOne(item, directory, index, { fetchImpl = fetch } = {}) {
  if (item.localPath) {
    await fs.access(item.localPath);
    return { item, path: item.localPath, external: true };
  }
  if (item.kind === 'hls' || String(item.url).match(/\.m3u8(?:[?#]|$)/i)) {
    return downloadHls(item, directory, index, { fetchImpl });
  }
  const response = await fetchImpl(item.url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://x.com/' } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const path = join(directory, `${String(index).padStart(5, '0')}-${safeFilename(item.filename, index)}`);
  await pipeline(response.body, createWriteStream(path));
  return { item, path, external: false };
}

async function runPool(items, directory, concurrency = 8, { fetchImpl = fetch } = {}) {
  const complete = [];
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { complete.push(await downloadOne(items[index], directory, index, { fetchImpl })); }
      catch (error) { failures.push({ key: items[index].key, error: error.message }); }
      send({ type: 'PROGRESS', downloaded: complete.length, failed: failures.length, total: items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { complete, failures };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  await pipeline(require('node:fs').createReadStream(path), hash);
  return hash.digest('hex');
}

function eaglePayloadItem({ item, path }, job) {
  const type = item.kind === 'image' ? '图片' : '视频';
  const name = safeFilename(item.filename).replace(/\.[^.\\/?]+($|\?)/i, '.mp4');
  if (item.localPath) {
    return {
      path,
      name,
      ...(item.website ? { website: item.website } : {}),
      ...(Array.isArray(item.tags) ? { tags: item.tags.filter(Boolean) } : {}),
      ...(item.annotation ? { annotation: item.annotation } : {})
    };
  }
  return {
    path,
    name,
    website: `https://x.com/i/status/${encodeURIComponent(String(item.tweetId || ''))}`,
    tags: ['X', job.username, type].filter(Boolean),
    ...(item.tweetText ? { annotation: item.tweetText } : {})
  };
}

async function commitJob(job, fetchImpl = fetch) {
  const items = job.items.filter((item) => item?.localPath || (['image', 'video', 'hls'].includes(item?.kind) && item?.url));
  const directory = join(tmpdir(), 'x-media-eagle', job.taskId || randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const { complete, failures } = await runPool(items, directory, 8, { fetchImpl });
  const unique = [];
  const hashes = new Set();
  for (const entry of complete) {
    if (!job.strictContentDedup) { unique.push(entry); continue; }
    const hash = await hashFile(entry.path);
    if (!hashes.has(hash)) { hashes.add(hash); unique.push(entry); }
  }
  if (unique.length) {
    const payload = {
      folderId: job.folderId,
      items: unique.map((entry) => eaglePayloadItem(entry, job))
    };
    const response = await fetchImpl('http://localhost:41595/api/item/addFromPaths', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success') throw new Error(result.message || `Eagle HTTP ${response.status}`);
  }
  await fs.rm(directory, { recursive: true, force: true });
  return { imported: unique.length, deduplicated: complete.length - unique.length, failed: failures };
}

async function commit() {
  if (!job) throw new Error('未初始化导入任务');
  const result = await commitJob(job);
  send({ type: 'COMPLETE', ...result });
  job = null;
}

async function handle(message) {
  if (message.type === 'PING') return send({ type: 'PONG' });
  if (message.type === 'START') { job = { taskId: message.taskId || randomUUID(), folderId: message.folderId, username: message.username, strictContentDedup: Boolean(message.strictContentDedup), items: [] }; return send({ type: 'READY' }); }
  if (message.type === 'CHUNK') { if (!job) throw new Error('未初始化导入任务'); job.items.push(...(message.items || [])); return; }
  if (message.type === 'COMMIT') return commit();
  throw new Error('未知命令');
}

if (require.main === module) {
  process.stdin.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4) {
      const size = input.readUInt32LE(0);
      if (input.length < size + 4) return;
      const raw = input.subarray(4, size + 4); input = input.subarray(size + 4);
      Promise.resolve(handle(JSON.parse(raw.toString('utf8')))).catch((error) => send({ type: 'ERROR', error: error.message }));
    }
  });
}

module.exports = { downloadOne, commitJob };
