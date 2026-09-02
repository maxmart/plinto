import { isLfsPointer, parsePointer, formatPointer } from '../pointer';

const VALID_OID = 'a'.repeat(64);
const VALID_POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${VALID_OID}\nsize 1234\n`;

describe('isLfsPointer', () => {
  it('returns true for a valid LFS pointer', () => {
    expect(isLfsPointer(VALID_POINTER)).toBe(true);
  });

  it('returns false for regular text content', () => {
    expect(isLfsPointer('Hello, world!\nThis is not a pointer.')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLfsPointer('')).toBe(false);
  });

  it('returns false for binary-like content', () => {
    expect(isLfsPointer('\x00\x01\x02\x03')).toBe(false);
  });

  it('returns false when prefix is present but not at start', () => {
    expect(isLfsPointer('prefix\nversion https://git-lfs.github.com/spec/v1\n')).toBe(false);
  });
});

describe('parsePointer', () => {
  it('extracts oid and size from a valid pointer', () => {
    const result = parsePointer(VALID_POINTER);
    expect(result.oid).toBe(VALID_OID);
    expect(result.size).toBe(1234);
  });

  it('throws on non-pointer content', () => {
    expect(() => parsePointer('not a pointer')).toThrow('Not an LFS pointer');
  });

  it('throws when oid line is missing', () => {
    const noOid = `version https://git-lfs.github.com/spec/v1\nsize 1234\n`;
    expect(() => parsePointer(noOid)).toThrow('Malformed LFS pointer');
  });

  it('throws when size line is missing', () => {
    const noSize = `version https://git-lfs.github.com/spec/v1\noid sha256:${VALID_OID}\n`;
    expect(() => parsePointer(noSize)).toThrow('Malformed LFS pointer');
  });

  it('throws when oid is not 64 hex chars', () => {
    const badOid = `version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 1234\n`;
    expect(() => parsePointer(badOid)).toThrow('Malformed LFS pointer');
  });

  it('parses size as integer', () => {
    const result = parsePointer(VALID_POINTER);
    expect(typeof result.size).toBe('number');
    expect(Number.isInteger(result.size)).toBe(true);
  });
});

describe('formatPointer', () => {
  it('produces a valid LFS pointer string', () => {
    const result = formatPointer(VALID_OID, 1234);
    expect(result).toBe(VALID_POINTER);
  });

  it('round-trips with parsePointer', () => {
    const formatted = formatPointer(VALID_OID, 9999);
    const parsed = parsePointer(formatted);
    expect(parsed.oid).toBe(VALID_OID);
    expect(parsed.size).toBe(9999);
  });

  it('isLfsPointer returns true for formatted output', () => {
    const result = formatPointer(VALID_OID, 42);
    expect(isLfsPointer(result)).toBe(true);
  });
});
