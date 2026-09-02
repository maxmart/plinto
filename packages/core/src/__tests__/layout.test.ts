import * as layout from '../layout';
import { testConfig } from '../test/config';

// The rules are pure functions of the config; these bind them to the fixture.
const toContentPath = (file: string) => layout.toContentPath(testConfig, file);
const toFilePath = (cp: string, lang: string) => layout.toFilePath(testConfig, cp, lang);

describe('toContentPath', () => {
  it('converts page file paths', () => {
    expect(toContentPath('src/pages/sv/support.mdx')).toEqual({
      contentPath: 'page/support',
      lang: 'sv',
    });
  });

  it('converts root page file paths', () => {
    expect(toContentPath('src/pages/en/index.mdx')).toEqual({
      contentPath: 'page/',
      lang: 'en',
    });
  });

  it('converts collection file paths', () => {
    expect(toContentPath('content/news/no/summer-cup.mdx')).toEqual({
      contentPath: 'news/summer-cup',
      lang: 'no',
    });
  });

  it('converts a declared partial to its name', () => {
    expect(toContentPath('src/partials/sv/TopBar.mdx')).toEqual({
      contentPath: 'topbar',
      lang: 'sv',
    });
    expect(toContentPath('src/partials/en/Footer.mdx')).toEqual({
      contentPath: 'footer',
      lang: 'en',
    });
  });
});

describe('toFilePath', () => {
  it('converts page content paths', () => {
    expect(toFilePath('page/support', 'sv')).toBe('src/pages/sv/support.mdx');
  });

  it('converts root page content path', () => {
    expect(toFilePath('page/', 'en')).toBe('src/pages/en/index.mdx');
  });

  it('converts collection content paths', () => {
    expect(toFilePath('news/summer-cup', 'no')).toBe('content/news/no/summer-cup.mdx');
  });

  it('converts partial names to their file', () => {
    expect(toFilePath('topbar', 'sv')).toBe('src/partials/sv/TopBar.mdx');
    expect(toFilePath('footer', 'en')).toBe('src/partials/en/Footer.mdx');
  });
});

describe('roundtrip', () => {
  it('toContentPath → toFilePath is identity for pages', () => {
    const file = 'src/pages/sv/support.mdx';
    const { contentPath, lang } = toContentPath(file);
    expect(toFilePath(contentPath, lang)).toBe(file);
  });

  it('toContentPath → toFilePath is identity for home pages', () => {
    const file = 'src/pages/sv/index.mdx';
    const { contentPath, lang } = toContentPath(file);
    expect(toFilePath(contentPath, lang)).toBe(file);
  });

  it('toContentPath → toFilePath is identity for partials', () => {
    const file = 'src/partials/no/TopBar.mdx';
    const { contentPath, lang } = toContentPath(file);
    expect(toFilePath(contentPath, lang)).toBe(file);
  });

  it('toContentPath → toFilePath is identity for collections', () => {
    const file = 'content/news/no/summer-cup.mdx';
    const { contentPath, lang } = toContentPath(file);
    expect(toFilePath(contentPath, lang)).toBe(file);
  });
});
