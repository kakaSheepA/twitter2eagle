import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import '../src/content/content-script.js';

const { articleFromAddedNode, coalesceMediaRecords, findTweets, recordsFromTweet, autoScrollTick, autoScrollSettings, shouldFinishAutoScroll, probeVideoSilently, profileNameFromPage } = globalThis.XMediaContent;

it('emits an original image record from an X tweet result', () => {
  const tweet = {
    rest_id: '10',
    legacy: {
      created_at: 'Sat Aug 16 14:32:05 +0000 2026', full_text: '这是原推文内容',
      extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a?format=jpg&name=small' }] }
    }
  };
  expect(recordsFromTweet(tweet, 'alice')).toMatchObject([{ tweetId: '10', mediaIndex: 0, kind: 'image', tweetText: '这是原推文内容', url: 'https://pbs.twimg.com/media/a?format=jpg&name=orig' }]);
});

it('marks video without both MP4 and HLS variants unavailable', () => {
  const tweet = { rest_id: '11', legacy: { created_at: 'Sat Aug 16 14:32:05 +0000 2026', extended_entities: { media: [{ type: 'video', video_info: { variants: [{ content_type: 'application/octet-stream', url: 'unknown.bin' }] } }] } } };
  expect(recordsFromTweet(tweet, 'alice')[0]).toMatchObject({ kind: 'video', status: 'unavailable' });
});

it('keeps an HLS playlist downloadable when no MP4 variant exists', () => {
  const tweet = { rest_id: 'hls', legacy: { created_at: 'Sat Aug 16 14:32:05 +0000 2026', extended_entities: { media: [{ type: 'video', video_info: { variants: [{ content_type: 'application/x-mpegURL', url: 'stream.m3u8' }] } }] } } };
  expect(recordsFromTweet(tweet, 'alice')[0]).toMatchObject({ kind: 'hls', url: 'stream.m3u8', extension: 'm3u8', status: 'pending' });
});

it('selects the highest bitrate MP4 from a tweet video', () => {
  const tweet = { rest_id: '12', legacy: { created_at: 'Sat Aug 16 14:32:05 +0000 2026', extended_entities: { media: [{ type: 'video', video_info: { variants: [
    { content_type: 'video/mp4', url: 'low.mp4', bitrate: 256000 },
    { content_type: 'video/mp4', url: 'high.mp4', bitrate: 2176000 }
  ] } }] } } };
  expect(recordsFromTweet(tweet, 'alice')[0]).toMatchObject({ kind: 'video', url: 'high.mp4', bitrate: 2176000, status: 'pending' });
});

it('filters tweet records by requested media type at collection time', () => {
  const tweet = { rest_id: 'typed', legacy: { created_at: 'Sat Aug 16 14:32:05 +0000 2026', extended_entities: { media: [
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a?format=jpg' },
    { type: 'video', video_info: { variants: [{ content_type: 'video/mp4', url: 'video.mp4', bitrate: 1 }] } }
  ] } } };
  expect(recordsFromTweet(tweet, 'alice', 'image').map((record) => record.kind)).toEqual(['image']);
  expect(recordsFromTweet(tweet, 'alice', 'video').map((record) => record.kind)).toEqual(['video']);
});

it('finds timeline tweets that expose media through legacy entities instead of extended entities', () => {
  const tweet = { rest_id: 'entities', legacy: { entities: { media: [{ type: 'photo' }] } } };
  expect(findTweets({ tweet })).toEqual([tweet]);
});

it('reads the display name from an X profile header', () => {
  const { document } = new JSDOM('<div data-testid="UserName"><span>Alice Example</span><span>@alice</span></div>').window;
  expect(profileNameFromPage(document)).toBe('Alice Example');
});

it('moves one viewport fraction during an automatic scroll tick', () => {
  const page = { scrollY: 0, innerHeight: 100, scrollBy: () => { page.scrollY = 80; }, document: { body: { scrollHeight: 500 } } };
  expect(autoScrollTick(page, 500)).toEqual({ moved: true, heightChanged: false });
});

it('uses smaller, more frequent automatic-scroll steps for steadier collection', () => {
  expect(autoScrollSettings(1000)).toEqual({ top: 400, behavior: 'auto', delay: 400 });
});

it('finishes automatic scanning only after repeated bottom-of-page checks', () => {
  expect(shouldFinishAutoScroll(9)).toBe(false);
  expect(shouldFinishAutoScroll(10)).toBe(true);
});

it('submits discovered media to the background in batches', () => {
  expect(readFileSync('src/content/content-script.js', 'utf8')).toContain("type: 'MEDIA_DISCOVERED_BATCH'");
});

it('coalesces repeated media discoveries before writing a batch to extension storage', () => {
  expect(coalesceMediaRecords([{ key: 'a' }, { key: 'a' }, { key: 'b' }]))
    .toEqual([{ key: 'a' }, { key: 'b' }]);
});

it('never auto-pauses scanning after idle scroll rounds', () => {
  expect(readFileSync('src/content/content-script.js', 'utf8')).not.toContain("type: 'AUTO_SCROLL_PAUSED'");
});

it('silently probes a paused video once so X requests its media playlist', async () => {
  const video = { dataset: {}, paused: true, muted: false, play: () => Promise.resolve(), pause: () => {} };
  await probeVideoSilently(video, 0);
  expect(video.dataset.xMediaProbe).toBe('true');
  expect(video.muted).toBe(false);
});

it('is valid classic JavaScript for Chrome content-script injection', () => {
  const source = readFileSync('src/content/content-script.js', 'utf8');
  expect(() => new Script(source)).not.toThrow();
});

it('collects original images from a visible tweet article', () => {
  const { document } = new JSDOM('<article><a href="/alice/status/99"><time datetime="2026-08-16T14:32:05.000Z"></time></a><img src="https://pbs.twimg.com/media/a?format=jpg&name=small"></article>').window;
  expect(globalThis.XMediaContent.recordsFromArticle(document.querySelector('article'), 'alice'))
    .toMatchObject([{ tweetId: '99', kind: 'image', url: 'https://pbs.twimg.com/media/a?format=jpg&name=orig' }]);
});

it('collects every image in an eight-image tweet without a fixed cap', () => {
  const imageTags = Array.from({ length: 8 }, (_, index) => `<img src="https://pbs.twimg.com/media/${index}?format=jpg&name=small">`).join('');
  const { document } = new JSDOM(`<article><a href="/alice/status/102"><time datetime="2026-08-16T14:32:05.000Z"></time></a>${imageTags}</article>`).window;
  expect(globalThis.XMediaContent.recordsFromArticle(document.querySelector('article'), 'alice')).toHaveLength(8);
});

it('does not attribute a quoted tweet image to the surrounding tweet', () => {
  const { document } = new JSDOM('<article><a href="/alice/status/99"><time datetime="2026-08-16T14:32:05.000Z"></time></a><a href="/alice/status/99/photo/1"><img src="https://pbs.twimg.com/media/outer?format=jpg"></a><a href="/bob/status/1/photo/1"><img src="https://pbs.twimg.com/media/quoted?format=jpg"></a></article>').window;
  expect(globalThis.XMediaContent.recordsFromArticle(document.querySelector('article'), 'alice').map((record) => record.url))
    .toEqual(['https://pbs.twimg.com/media/outer?format=jpg&name=orig']);
});

it('does not collect a repost card from the DOM unless reposts are enabled', () => {
  const { document } = new JSDOM('<article><div data-testid="socialContext">转推了</div><a href="/alice/status/99"><time datetime="2026-08-16T14:32:05.000Z"></time></a><img src="https://pbs.twimg.com/media/a?format=jpg"></article>').window;
  const article = document.querySelector('article');
  expect(globalThis.XMediaContent.recordsFromArticle(article, 'alice', { includeReposts: false })).toEqual([]);
  expect(globalThis.XMediaContent.recordsFromArticle(article, 'alice', { includeReposts: true })).toHaveLength(1);
});

it('filters a DOM reply once its timeline metadata is known', () => {
  const { document } = new JSDOM('<article><a href="/alice/status/99"><time datetime="2026-08-16T14:32:05.000Z"></time></a><img src="https://pbs.twimg.com/media/a?format=jpg"></article>').window;
  const eligibility = new Map([['99', { isReply: true, isRepost: false }]]);
  expect(globalThis.XMediaContent.recordsFromArticle(document.querySelector('article'), 'alice', { includeReplies: false }, eligibility)).toEqual([]);
});

it('finds the parent tweet when an image is inserted after its article exists', () => {
  const { document } = new JSDOM('<article id="tweet"><div><img id="late" src="https://pbs.twimg.com/media/a?format=jpg"></div></article>').window;
  expect(articleFromAddedNode(document.querySelector('#late'))?.id).toBe('tweet');
});

it('discovers a video candidate from a visible tweet article for deferred resolution', () => {
  const { document } = new JSDOM('<article><a href="/alice/status/101"><time datetime="2026-08-16T14:32:05.000Z"></time></a><video poster="https://pbs.twimg.com/amplify_video_thumb/a.jpg"></video></article>').window;
  expect(globalThis.XMediaContent.recordsFromArticle(document.querySelector('article'), 'alice')).toMatchObject([{ tweetId: '101', kind: 'video', status: 'pending', needsResolve: true }]);
});

it('rescans articles that existed before collection began', () => {
  const { document } = new JSDOM('<main><article><a href="/alice/status/100"><time datetime="2026-08-16T14:32:05.000Z"></time></a><img src="https://pbs.twimg.com/media/b?format=png&name=small"></article></main>').window;
  expect(globalThis.XMediaContent.recordsFromVisibleArticles(document, 'alice')).toHaveLength(1);
});

it('reports how many articles and media records a visible scan found', () => {
  const { document } = new JSDOM('<main><article><a href="/alice/status/100"><time datetime="2026-08-16T14:32:05.000Z"></time></a><img src="https://pbs.twimg.com/media/b?format=png&name=small"></article></main>').window;
  expect(globalThis.XMediaContent.visibleScanDiagnostics(document, 'alice')).toEqual({ articles: 1, records: 1 });
});
