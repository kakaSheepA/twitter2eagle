importScripts('../../node_modules/mux.js/dist/mux-mp4.min.js');

function parse(text, baseUrl) {
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

async function mediaPlaylist(url) {
  const first = parse(await (await fetch(url)).text(), url);
  if (!first.variants.length) return first;
  const highest = [...first.variants].sort((left, right) => right.bandwidth - left.bandwidth)[0];
  return parse(await (await fetch(highest.url)).text(), highest.url);
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'DOWNLOAD_HLS') return;
  try {
    const playlist = await mediaPlaylist(data.url);
    if (!playlist.segments.length) throw new Error('播放清单没有媒体分片');
    const chunks = [];
    let transmuxer = null;
    if (playlist.initSegmentUrl) {
      const initResponse = await fetch(playlist.initSegmentUrl);
      if (!initResponse.ok) throw new Error(`视频初始化分片请求失败（HTTP ${initResponse.status}）`);
      chunks.push(await initResponse.arrayBuffer());
    } else {
      transmuxer = new self.muxjs.Transmuxer({ remux: true });
      let sentInit = false;
      transmuxer.on('data', (segment) => {
        if (!sentInit && segment.initSegment?.byteLength) { chunks.push(segment.initSegment.buffer); sentInit = true; }
        if (segment.data?.byteLength) chunks.push(segment.data.buffer);
      });
    }
    for (let index = 0; index < playlist.segments.length; index += 1) {
      const response = await fetch(playlist.segments[index]);
      if (!response.ok) throw new Error(`视频分片请求失败（HTTP ${response.status}）`);
      const bytes = await response.arrayBuffer();
      if (playlist.initSegmentUrl) chunks.push(bytes);
      else { transmuxer.push(new Uint8Array(bytes)); transmuxer.flush(); }
      self.postMessage({ type: 'HLS_PROGRESS', requestId: data.requestId, completed: index + 1, total: playlist.segments.length });
    }
    if (!chunks.length) throw new Error('该 HLS 分片格式暂不支持导出 MP4');
    self.postMessage({ type: 'HLS_COMPLETE', requestId: data.requestId, chunks }, chunks);
  } catch (error) {
    self.postMessage({ type: 'HLS_ERROR', requestId: data.requestId, error: error.message });
  }
};
