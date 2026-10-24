function attributes(line) {
  return Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=((?:"[^"]*")|(?:[^,]*))/g)]
    .map(([, key, value]) => [key, value.replace(/^"|"$/g, '')]));
}

export function parsePlaylist(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('无效 HLS 播放清单');
  if (lines.some((line) => line.startsWith('#EXT-X-KEY'))) throw new Error('不支持加密 HLS 视频');
  const variants = [];
  const segments = [];
  let initSegmentUrl = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('#EXT-X-STREAM-INF')) {
      const uri = lines.slice(index + 1).find((line) => !line.startsWith('#'));
      if (uri) variants.push({ url: new URL(uri, baseUrl).toString(), bandwidth: Number(attributes(lines[index]).BANDWIDTH ?? 0) });
    }
    if (lines[index].startsWith('#EXT-X-MAP')) {
      const uri = attributes(lines[index]).URI;
      if (uri) initSegmentUrl = new URL(uri, baseUrl).toString();
    }
    if (!lines[index].startsWith('#')) segments.push(new URL(lines[index], baseUrl).toString());
  }
  return variants.length ? { type: 'master', variants, segments: [], initSegmentUrl: null } : { type: 'media', variants: [], segments, initSegmentUrl };
}

export function selectHighestVariant(variants = []) {
  return [...variants].sort((left, right) => right.bandwidth - left.bandwidth)[0] ?? null;
}
