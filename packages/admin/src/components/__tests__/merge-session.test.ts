/**
 * Who resolves a merge's conflicts, and what happens when they cannot.
 *
 * An editor got stuck because a failed resolution simply ended the merge, with
 * nothing on screen saying so. The rule now: a failure falls back to the editor
 * choosing, and only the editor cancelling ends it.
 */
import { resolveWithFallback, CANCELLED } from '../merge-session';

const MINE = [{ path: 'src/pages/index.mdx', content: 'mine' }];
const CLAUDES = [{ path: 'src/pages/index.mdx', content: 'merged' }];

/** A promise that never settles: the editor never asked, never cancelled. */
const never = <T,>() => new Promise<T>(() => {});

function setup(overrides: Partial<Parameters<typeof resolveWithFallback>[0]> = {}) {
  const decideByHand = vi.fn(async (_reason: string) => MINE);
  const claude = vi.fn(async () => CLAUDES);
  const onClaude = vi.fn();
  const run = () => resolveWithFallback({
    hasKey: true,
    claude,
    manualRequested: never(),
    cancelled: never(),
    onClaude,
    decideByHand,
    ...overrides,
  });
  return { decideByHand, claude, onClaude, run };
}

describe('resolveWithFallback', () => {
  it('without an API key, the editor decides and Claude is never called', async () => {
    const { decideByHand, claude, run } = setup({ hasKey: false });

    await expect(run()).resolves.toEqual(MINE);
    expect(claude).not.toHaveBeenCalled();
    expect(decideByHand.mock.calls[0][0]).toMatch(/No Claude API key/);
  });

  it('with a key, Claude resolves it', async () => {
    const { decideByHand, onClaude, run } = setup();

    await expect(run()).resolves.toEqual(CLAUDES);
    expect(onClaude).toHaveBeenCalled();
    expect(decideByHand).not.toHaveBeenCalled();
  });

  it('a Claude failure falls back to the editor, saying why', async () => {
    const { decideByHand, run } = setup({ claude: async () => { throw new Error('overloaded'); } });

    await expect(run()).resolves.toEqual(MINE);
    expect(decideByHand.mock.calls[0][0]).toMatch(/Claude could not resolve this \(overloaded\)/);
  });

  it('the editor can stop waiting for Claude and decide instead', async () => {
    const { decideByHand, run } = setup({
      claude: () => never(),
      manualRequested: Promise.resolve(),
    });

    await expect(run()).resolves.toEqual(MINE);
    expect(decideByHand.mock.calls[0][0]).toMatch(/You chose/);
  });

  it('cancelling Claude\'s question is a cancel, not a failure to fall back from', async () => {
    const { decideByHand, run } = setup({ claude: async () => { throw new Error(CANCELLED); } });

    await expect(run()).rejects.toThrow(CANCELLED);
    expect(decideByHand).not.toHaveBeenCalled();
  });

  it('cancelling while Claude works ends it', async () => {
    const { run } = setup({ claude: () => never(), cancelled: Promise.reject(new Error(CANCELLED)) });

    await expect(run()).rejects.toThrow(CANCELLED);
  });

  it('cancelling while the editor chooses ends it', async () => {
    const { run } = setup({
      hasKey: false,
      decideByHand: () => never(),
      cancelled: Promise.reject(new Error(CANCELLED)),
    });

    await expect(run()).rejects.toThrow(CANCELLED);
  });
});
