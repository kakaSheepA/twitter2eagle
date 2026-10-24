import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

describe('manifest', () => {
  it('declares MV3, native messaging, downloads and the X host permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['downloads', 'storage', 'nativeMessaging', 'alarms']));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(['https://x.com/*', 'https://twitter.com/*']));
    expect(manifest.host_permissions).toContain('https://cdn.syndication.twimg.com/*');
    expect(manifest.host_permissions).toContain('https://web.telegram.org/*');
    expect(manifest.host_permissions).toContain('http://localhost:41595/*');
  });

  it('registers Telegram controls only for Web K without changing X content scripts', () => {
    const telegram = manifest.content_scripts.find((entry) => entry.matches.includes('https://web.telegram.org/k/*'));
    expect(telegram).toEqual(expect.objectContaining({ js: ['src/content/telegram-content-script.js'], css: ['src/content/telegram-content.css'] }));
    expect(manifest.content_scripts.filter((entry) => entry.matches.includes('https://x.com/*'))).toHaveLength(2);
  });
});
