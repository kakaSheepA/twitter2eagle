import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import '../src/content/telegram-content-script.js';

const { recordsFromTelegramRoot, viewerRecord, downloadUrlForSource, networkVideoUrl, telegramViewerDownloadButton } = globalThis.TelegramEagleContent;

it('is a standalone Chrome content script without ES module imports', () => {
  expect(readFileSync('src/content/telegram-content-script.js', 'utf8')).not.toMatch(/^\s*(import|export)\s/m);
});

function root(html) { return new JSDOM(`<body>${html}</body>`).window.document; }

function imageRoot(width, height) {
  const document = root('<div class="bubble photo" data-peer-id="-1" data-mid="9"><img class="media-photo" src="blob:https://web.telegram.org/a"></div>');
  const image = document.querySelector('img');
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  return document;
}

it('does not expose Telegram image records', () => {
  const document = imageRoot(1280, 720);
  expect(recordsFromTelegramRoot(document)).toHaveLength(0);
});

it('does not expose a newly added Telegram image node', () => {
  const document = imageRoot(1280, 720);
  expect(recordsFromTelegramRoot(document.querySelector('img'))).toHaveLength(0);
});

it('uses the real video element instead of a video cover image', () => {
  const document = root('<div class="bubble video" data-peer-id="-1" data-mid="9"><img class="media-photo" src="blob:https://web.telegram.org/cover"><video src="blob:https://web.telegram.org/video"></video></div>');
  expect(recordsFromTelegramRoot(document)).toMatchObject([{ peerId: '-1', messageId: '9', kind: 'video', source: 'blob:https://web.telegram.org/video' }]);
  expect(recordsFromTelegramRoot(document)).toHaveLength(1);
});

it('uses the video within the matching album item rather than the first video in the message', () => {
  const document = root('<div class="bubble video is-album" data-peer-id="-1" data-mid="9"><div class="album-item" data-mid="10"><img class="media-photo" src="blob:https://web.telegram.org/cover-a"><video src="blob:https://web.telegram.org/video-a"></video></div><div class="album-item" data-mid="11"><img class="media-photo" src="blob:https://web.telegram.org/cover-b"><video src="blob:https://web.telegram.org/video-b"></video></div></div>');
  expect(recordsFromTelegramRoot(document)).toMatchObject([
    { messageId: '10', kind: 'video', source: 'blob:https://web.telegram.org/video-a' },
    { messageId: '11', kind: 'video', source: 'blob:https://web.telegram.org/video-b' }
  ]);
});

it('keeps a video save control available while its real video source is still loading', () => {
  const document = root('<div class="bubble video" data-peer-id="-1" data-mid="9"><img class="media-photo" src="blob:https://web.telegram.org/cover"></div>');
  expect(recordsFromTelegramRoot(document)).toMatchObject([{ peerId: '-1', messageId: '9', kind: 'video', source: null }]);
});

it('discovers a normal video bubble before Telegram adds its poster or video element', () => {
  const document = root('<div class="bubble video" data-peer-id="-1" data-mid="9"></div>');
  expect(recordsFromTelegramRoot(document)).toMatchObject([{ peerId: '-1', messageId: '9', kind: 'video', source: null }]);
});

it('builds a save record from the video player source', () => {
  const document = root('<video src="blob:https://web.telegram.org/player-video"></video>');
  expect(viewerRecord(document.querySelector('video'))).toMatchObject({ kind: 'video', source: 'blob:https://web.telegram.org/player-video' });
});

it('turns a Telegram blob video into a downloadable object URL', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => ({ size: 12 }) }));
  await expect(downloadUrlForSource('blob:https://web.telegram.org/video', fetchImpl, () => 'blob:downloadable')).resolves.toEqual({ url: 'blob:downloadable', revoke: true });
  expect(fetchImpl).toHaveBeenCalledWith('blob:https://web.telegram.org/video');
});

it('selects the most recent Telegram CDN media request as a blob fallback', () => {
  const entries = [
    { name: 'https://web.telegram.org/k/main.js', initiatorType: 'script', startTime: 1 },
    { name: 'https://cdn4.telegram-cdn.org/file/abc123', initiatorType: 'fetch', startTime: 2 },
    { name: 'https://cdn4.telegram-cdn.org/file/latest', initiatorType: 'fetch', startTime: 3 }
  ];
  expect(networkVideoUrl(entries)).toBe('https://cdn4.telegram-cdn.org/file/latest');
});

it('finds Telegram’s native download control inside the player', () => {
  const document = root('<div role="dialog"><button title="Download"><span class="icon-download"></span></button><video src="blob:https://web.telegram.org/player-video"></video></div>');
  expect(telegramViewerDownloadButton(document.querySelector('video'))?.getAttribute('title')).toBe('Download');
});

it('ignores protected or unloaded media', () => {
  const document = root('<div class="bubble photo is-album" data-peer-id="-1" data-mid="9"><div class="album-item" data-mid="10"><img class="media-photo" src="blob:https://web.telegram.org/a"></div></div></div><div class="bubble photo is-protected" data-peer-id="-1" data-mid="11"><img class="media-photo" src="blob:https://web.telegram.org/b"></div><div class="bubble video" data-peer-id="-1" data-mid="12"><video class="media-video"></video></div>');
  expect(recordsFromTelegramRoot(document)).toHaveLength(0);
});
