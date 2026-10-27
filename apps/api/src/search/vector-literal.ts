/**
 * pgvector's text form for a vector value: `'[0.1,0.2,...]'`. Used as a
 * bound parameter in raw SQL — cast at the call site (`${literal}::vector`)
 * so Postgres applies the vector input function to it.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
