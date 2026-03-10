/** FNV-1a 32-bit hash — fast, non-cryptographic, good distribution. */
export function fnv1aHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned 32-bit
}
