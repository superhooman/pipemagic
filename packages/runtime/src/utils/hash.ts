/** Create a deterministic cache key from params and input revisions. */
export function computeCacheKey(nodeId: string, params: Record<string, unknown>, inputRevisions: number[]): string {
  const paramsStr = JSON.stringify(params, Object.keys(params).sort())
  const inputStr = inputRevisions.join(',')
  return `${nodeId}:${simpleHash(paramsStr)}:${simpleHash(inputStr)}`
}

/** Fast non-cryptographic string hash (djb2). */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
