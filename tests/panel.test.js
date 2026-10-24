// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { autoScrollButton, downloadSelected, downloadTargets, eagleImportSummary, eagleTargets, filterMediaItems, mediaTabs, outputFilename, primaryButton, renderMediaList, taskStateView, writeHlsFile, writeMediaFile } from '../src/panel/panel.js';

it('defaults the panel scroll choice to manual', () => {
  const markup = readFileSync('src/panel/panel.html', 'utf8');
  expect(markup).toMatch(/name="scroll-mode" value="manual" checked/);
  expect(markup).not.toMatch(/name="scroll-mode" value="auto" checked/);
});

it('keeps collection settings collapsed until its heading is opened', () => {
  document.body.innerHTML = readFileSync('src/panel/panel.html', 'utf8');
  const settings = document.querySelector('details.settings-card');
  expect(settings).not.toBeNull();
  expect(settings.open).toBe(false);
  expect(settings.querySelector('summary')?.textContent).toContain('采集设置');
});

it('keeps the media list collapsed until its heading is opened', () => {
  document.body.innerHTML = readFileSync('src/panel/panel.html', 'utf8');
  const downloads = document.querySelector('details.download-card');
  expect(downloads).not.toBeNull();
  expect(downloads.open).toBe(false);
  expect(downloads.querySelector('summary')?.textContent).toContain('媒体列表');
  expect(readFileSync('src/panel/panel.css', 'utf8')).toContain('.download-card:not([open]) > #media-details { display: none; }');
});

it('places Eagle immediately below the scan actions and before the media list', () => {
  document.body.innerHTML = readFileSync('src/panel/panel.html', 'utf8');
  const sections = [...document.querySelector('.panel-shell').children];
  expect(sections.indexOf(document.querySelector('.action-stack'))).toBeLessThan(sections.indexOf(document.querySelector('.eagle-card')));
  expect(sections.indexOf(document.querySelector('.eagle-card'))).toBeLessThan(sections.indexOf(document.querySelector('.download-card')));
});

it('offers all, image-only, and video-only collection filters', () => {
  const panel = readFileSync('src/panel/panel.html', 'utf8');
  expect(panel).toContain('name="media-type" value="all" checked');
  expect(panel).toContain('name="media-type" value="image"');
  expect(panel).toContain('name="media-type" value="video"');
});

it('uses Eagle URL imports without exposing the unreliable local-file import mode', () => {
  expect(readFileSync('src/panel/panel.html', 'utf8')).not.toContain('eagle-local');
  expect(readFileSync('src/panel/panel.js', 'utf8')).not.toContain('IMPORT_EAGLE_LOCAL_ITEMS');
});

it('uses a two-column layout when the side panel is wide', () => {
  expect(readFileSync('src/panel/panel.css', 'utf8'))
    .toContain('@media (min-width: 760px)');
});

it('keeps an expanded wide media list scrollable inside its disclosure panel', () => {
  expect(readFileSync('src/panel/panel.css', 'utf8'))
    .toContain('#media-details { grid-template-rows: auto auto auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; }');
});

it('gives the wide media list its own vertical scroll area', () => {
  expect(readFileSync('src/panel/panel.css', 'utf8'))
    .toContain('height: calc(100vh - 76px); overflow: hidden;');
});

it('uses page controls so a large media collection is not rendered at once', () => {
  const panel = readFileSync('src/panel/panel.html', 'utf8');
  expect(panel).toContain('id="media-page"');
  expect(panel).toContain('id="media-prev"');
  expect(panel).toContain('id="media-next"');
});

it('renders compact task statistics from the current status', () => {
  expect(taskStateView({ phase: 'scanning', total: 12, pending: 9, completed: 2, unavailable: 1 }))
    .toEqual({ label: '扫描中', tone: 'scanning', total: 12, pending: 9, completed: 2, unavailable: 1 });
});

it('shows only stop while collecting', () => {
  expect(primaryButton({ phase: 'scanning', collecting: true, downloading: 0, completed: 0 }))
    .toEqual({ label: '停止扫描', disabled: false, action: 'STOP_SCAN' });
});

it('disables the primary button during downloads', () => {
  expect(primaryButton({ collecting: false, downloading: 2, completed: 0 }))
    .toEqual({ label: '正在下载…', disabled: true, action: null });
});

it('keeps scan completion separate from batch download', () => {
  expect(primaryButton({ phase: 'scan_complete', total: 2 }))
    .toEqual({ label: '开始新任务', disabled: false, action: 'START' });
});

it('shows a resume action only for paused automatic scrolling', () => {
  expect(autoScrollButton({ phase: 'scanning', scrollMode: 'auto', autoScrollPaused: true }))
    .toEqual({ label: '继续自动滚动', action: 'RESUME_AUTO_SCROLL' });
});

it('writes a fetched media blob inside the username directory', async () => {
  const writable = { write: vi.fn(), close: vi.fn() };
  const file = { createWritable: vi.fn().mockResolvedValue(writable) };
  const userDirectory = { getFileHandle: vi.fn().mockResolvedValue(file) };
  const directory = { getDirectoryHandle: vi.fn().mockResolvedValue(userDirectory) };
  await writeMediaFile(directory, { username: 'alice', filename: 'alice/2026-08-16_01.jpg', url: 'https://pbs.twimg.com/a.jpg' }, async () => new Response(new Blob(['image'])));
  expect(directory.getDirectoryHandle).toHaveBeenCalledWith('alice', { create: true });
  expect(userDirectory.getFileHandle).toHaveBeenCalledWith('2026-08-16_01.jpg', { create: true });
  expect(writable.close).toHaveBeenCalledOnce();
});

it('separates unavailable media from media with a download URL', () => {
  expect(mediaTabs([
    { key: 'image', url: 'image.jpg', status: 'pending' },
    { key: 'video', status: 'unavailable', error: '没有 MP4' }
  ])).toMatchObject({ downloadable: [{ key: 'image' }], unavailable: [{ key: 'video' }] });
});

it('filters the displayed media list by image or video without excluding HLS videos', () => {
  const items = [{ key: 'image', kind: 'image' }, { key: 'video', kind: 'video' }, { key: 'hls', kind: 'hls' }];
  expect(filterMediaItems(items, 'all').map((item) => item.key)).toEqual(['image', 'video', 'hls']);
  expect(filterMediaItems(items, 'image').map((item) => item.key)).toEqual(['image']);
  expect(filterMediaItems(items, 'video').map((item) => item.key)).toEqual(['video', 'hls']);
});

it('offers media-list image and video display filters', () => {
  const panel = readFileSync('src/panel/panel.html', 'utf8');
  expect(panel).toContain('data-media-filter="all"');
  expect(panel).toContain('data-media-filter="image"');
  expect(panel).toContain('data-media-filter="video"');
});

it('selects only pending items with a direct URL for batch download', () => {
  expect(downloadTargets([
    { key: 'pending', url: 'a.jpg', status: 'pending' },
    { key: 'done', url: 'b.jpg', status: 'completed' },
    { key: 'missing', status: 'pending' }
  ])).toEqual([{ key: 'pending', url: 'a.jpg', status: 'pending' }]);
});

it('allows an individual completed item to be downloaded again by stable key', () => {
  expect(downloadTargets([{ key: 'done', tweetId: '42', mediaIndex: 1, url: 'b.jpg', status: 'completed' }], '42:1'))
    .toEqual([{ key: 'done', tweetId: '42', mediaIndex: 1, url: 'b.jpg', status: 'completed' }]);
});

it('reports completion for a selected download item', async () => {
  const writable = { write: vi.fn(), close: vi.fn() };
  const directory = { getDirectoryHandle: vi.fn().mockResolvedValue({ getFileHandle: vi.fn().mockResolvedValue({ createWritable: vi.fn().mockResolvedValue(writable) }) }) };
  const sendMessage = vi.fn().mockResolvedValue({});
  await downloadSelected(directory, [{ key: 'one', url: 'one.jpg', username: 'alice', filename: 'alice/one.jpg' }], sendMessage, async () => new Response(new Blob(['x'])));
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DOWNLOAD_ITEM_STATUS', key: 'one', status: 'completed' }));
});

it('renders an original URL and single-download action for downloadable media', () => {
  const output = renderMediaList([{ key: 'video', kind: 'video', createdAt: '2026-08-16T00:00:00Z', url: 'https://video.twimg.com/a.mp4', status: 'pending' }], 'downloadable');
  expect(output).toContain('原始链接');
  expect(output).not.toContain('<code>');
});

it('labels a captured HLS playlist as video in the downloadable list', () => {
  expect(renderMediaList([{ key: 'hls', kind: 'hls', createdAt: '2026-08-16T00:00:00Z', url: 'https://video.twimg.com/master.m3u8', status: 'pending' }], 'downloadable'))
    .toContain('<strong>HLS 视频</strong>');
});

it('writes captured HLS media with an MP4 filename', () => {
  expect(outputFilename({ kind: 'hls', filename: 'alice/2026-08-16_01.m3u8' })).toBe('alice/2026-08-16_01.mp4');
});

it('selects only direct resources for Eagle imports', () => {
  expect(eagleTargets([
    { key: 'image', kind: 'image', url: 'image.jpg' },
    { key: 'mp4', kind: 'video', url: 'video.mp4' },
    { key: 'hls', kind: 'hls', url: 'playlist.m3u8' }
  ]).map((item) => item.key)).toEqual(['image', 'mp4', 'hls']);
});

it('reports HLS items included in the Eagle import count', () => {
  expect(eagleImportSummary([
    { kind: 'image', url: 'image.jpg' },
    { kind: 'video', url: 'video.mp4' },
    { kind: 'hls', url: 'playlist.m3u8' }
  ])).toEqual({ importable: 3, imported: 0, hls: 1 });
});

it('renders a per-item Eagle action using the stable tweetId:mediaIndex key', () => {
  expect(renderMediaList([{ key: 'image', kind: 'image', tweetId: '123', mediaIndex: 0, createdAt: '2026-08-16T00:00:00Z', url: 'https://pbs.twimg.com/a.jpg', status: 'pending' }], 'downloadable'))
    .toContain('data-eagle-key="123:0"');
});

it('offers a re-import action for an Eagle-saved item when skipping is disabled', () => {
  expect(renderMediaList([{ key: 'image', kind: 'image', createdAt: '2026-08-16T00:00:00Z', url: 'https://pbs.twimg.com/a.jpg', eagleStatus: 'imported', status: 'pending' }], 'downloadable', false))
    .toContain('重新保存 Eagle');
});

it('does not offer a skip-saved Eagle import setting', () => {
  expect(readFileSync('src/panel/panel.html', 'utf8')).not.toContain('eagle-skip-saved');
});

it('defaults Eagle import validation to off for fast bulk imports', () => {
  expect(readFileSync('src/panel/panel.html', 'utf8')).not.toContain('eagle-deduplicate');
});

it('uses the creator folder automatically instead of presenting a manual Eagle folder picker', () => {
  const panel = readFileSync('src/panel/panel.html', 'utf8');
  expect(panel).toContain('id="eagle-target"');
  expect(panel).not.toContain('id="eagle-folder"');
});

it('fails and terminates an HLS worker that never responds', async () => {
  const worker = { postMessage: vi.fn(), terminate: vi.fn() };
  await expect(writeHlsFile({}, { url: 'https://video.twimg.com/stuck.m3u8' }, () => {}, { workerFactory: () => worker, timeoutMs: 1 }))
    .rejects.toThrow('HLS 下载超时');
  expect(worker.terminate).toHaveBeenCalledOnce();
});
