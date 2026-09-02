/**
 * The failure paths, which are the ones that matter here: when talking to
 * Claude goes wrong, the admin has to say so rather than go quiet.
 */

describe('claudeErrorMessage', () => {
  it('works before the SDK has ever loaded', async () => {
    // It used to await the SDK to get APIError, so when *loading* the SDK was
    // the failure, describing it threw too — the caller's catch never reached
    // its setState and the user saw nothing at all.
    vi.resetModules();
    const { claudeErrorMessage } = await import('../client');
    expect(claudeErrorMessage(new Error('chunk load failed'))).toBe('chunk load failed');
    expect(claudeErrorMessage('a bare string')).toBe('a bare string');
    expect(claudeErrorMessage(null)).toBe('null');
  });

  it('is synchronous, so a catch block cannot lose it', async () => {
    vi.resetModules();
    const { claudeErrorMessage } = await import('../client');
    expect(claudeErrorMessage(new Error('x'))).not.toBeInstanceOf(Promise);
  });
});

describe('claudeClient', () => {
  it('asks for a key in words a content editor can act on', async () => {
    // Without this the SDK answers "Could not resolve authentication method.
    // Expected one of apiKey, authToken, credentials, config, or profile…",
    // which lands mid-merge in front of someone editing text.
    vi.resetModules();
    const { claudeClient } = await import('../client');
    await expect(claudeClient('')).rejects.toThrow(/API key/i);
    await expect(claudeClient('')).rejects.not.toThrow(/authToken|profile/);
  });

  it('does not remember a failed load, so the next attempt retries', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('@anthropic-ai/sdk', () => {
      attempts++;
      if (attempts === 1) throw new Error('network down');
      class FakeAnthropic {
        constructor(public opts: unknown) {}
      }
      return { default: FakeAnthropic, APIError: class extends Error {} };
    });

    const { claudeClient } = await import('../client');
    await expect(claudeClient('sk-test')).rejects.toThrow();
    // A remembered rejection would keep every Claude feature broken until the
    // page was reloaded, long after the network came back.
    await expect(claudeClient('sk-test')).resolves.toBeDefined();
    expect(attempts).toBe(2);
    vi.doUnmock('@anthropic-ai/sdk');
  });
});
