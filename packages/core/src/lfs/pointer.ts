const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1\n';

export function isLfsPointer(content: string): boolean {
  return content.startsWith(LFS_POINTER_PREFIX);
}

export function parsePointer(content: string): { oid: string; size: number } {
  if (!isLfsPointer(content)) throw new Error('Not an LFS pointer');
  const oidMatch = content.match(/^oid sha256:([0-9a-f]{64})$/m);
  const sizeMatch = content.match(/^size (\d+)$/m);
  if (!oidMatch || !sizeMatch) throw new Error('Malformed LFS pointer');
  return { oid: oidMatch[1], size: parseInt(sizeMatch[1], 10) };
}

export function formatPointer(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}
