import { localeDir, localizedPath, toPageHref } from '../urls';

// The test config (src/test/virtual-plinto-config.ts) is a prefixed
// three-locale site — sv (default), no, en — with trailingSlash 'always'.

describe('localeDir', () => {
  it('gives every locale its own segment when the default is prefixed', () => {
    expect(localeDir('sv')).toBe('sv');
    expect(localeDir('en')).toBe('en');
  });
});

describe('localizedPath', () => {
  it('swaps the locale segment, keeping the page path', () => {
    expect(localizedPath('/sv/support/', 'en')).toBe('/en/support/');
    expect(localizedPath('/en/docs/getting-started/', 'no')).toBe('/no/docs/getting-started/');
  });

  it('maps a locale home page to the other locale home page', () => {
    expect(localizedPath('/sv/', 'no')).toBe('/no/');
  });

  it('keeps the site root at the target locale root', () => {
    expect(localizedPath('/', 'en')).toBe('/en/');
  });

  it('preserves the absence of a trailing slash', () => {
    expect(localizedPath('/sv/support', 'en')).toBe('/en/support');
  });

  it('treats a first segment that is not a locale as page path', () => {
    // An unprefixed site's page, read by a prefixed site's rule: the segment
    // stays, because only a real locale segment is replaced.
    expect(localizedPath('/support/', 'no')).toBe('/no/support/');
  });
});

describe('toPageHref', () => {
  it('maps a page content path to its URL', () => {
    expect(toPageHref('page/support', 'sv')).toBe('/sv/support/');
  });

  it('maps the home page to the locale root', () => {
    expect(toPageHref('page/', 'en')).toBe('/en/');
  });

  // The site says trailingSlash: 'always', so a URL without one is a 404 on
  // the dev server — which is what "Exit preview" used to navigate to, while
  // the admin's View link appended a slash of its own. The setting decides it
  // now, in one place.
  it("honours the site's trailingSlash", () => {
    expect(toPageHref('page/docs/intro', 'no')).toBe('/no/docs/intro/');
  });
});
