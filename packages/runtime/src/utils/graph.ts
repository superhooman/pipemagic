import type { NodeDef, EdgeDef } from '../types/pipeline'

export interface ValidationError {
  nodeId?: string
  message: string
}

/** Kahn's algorithm topological sort. Returns ordered node IDs or throws on cycle. */
export function topoSort(nodes: NodeDef[], edges: EdgeDef[]): string[] {
  const nodeIds = new Set(nodes.map(n => n.id))
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    adjacency.get(edge.source)!.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)
    for (const neighbor of adjacency.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== nodeIds.size) {
    throw new Error('Pipeline contains a cycle')
  }

  return sorted
}

/** DFS-based cycle detection. Returns true if a cycle exists. */
export function hasCycle(nodes: NodeDef[], edges: EdgeDef[]): boolean {
  try {
    topoSort(nodes, edges)
    return false
  } catch {
    return true
  }
}

/** Validate the pipeline and return any errors. */
export function validatePipeline(nodes: NodeDef[], edges: EdgeDef[]): ValidationError[] {
  const errors: ValidationError[] = []

  const inputNodes = nodes.filter(n => n.type === 'input')
  const outputNodes = nodes.filter(n => n.type === 'output')

  if (inputNodes.length === 0) {
    errors.push({ message: 'Pipeline needs at least one Input node' })
  }
  if (outputNodes.length === 0) {
    errors.push({ message: 'Pipeline needs at least one Output node' })
  }

  if (hasCycle(nodes, edges)) {
    errors.push({ message: 'Pipeline contains a cycle' })
  }

  // Check for disconnected processing nodes
  const targetIds = new Set(edges.map(e => e.target))
  const sourceIds = new Set(edges.map(e => e.source))

  for (const node of nodes) {
    if (node.type === 'input' && !sourceIds.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Input node "${node.id}" has no outgoing connection` })
    }
    if (node.type === 'output' && !targetIds.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Output node "${node.id}" has no incoming connection` })
    }
    if (node.type !== 'input' && node.type !== 'output') {
      if (!targetIds.has(node.id)) {
        errors.push({ nodeId: node.id, message: `Node "${node.id}" has no input connection` })
      }
      if (!sourceIds.has(node.id)) {
        errors.push({ nodeId: node.id, message: `Node "${node.id}" has no output connection` })
      }
    }
  }

  return errors
}

/** Get upstream node IDs for a given node. */
export function getUpstreamNodes(nodeId: string, edges: EdgeDef[]): string[] {
  return edges.filter(e => e.target === nodeId).map(e => e.source)
}

/** Get all downstream node IDs (transitive) for a given node. */
export function getDownstreamNodes(nodeId: string, edges: EdgeDef[]): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const queue = edges.filter(e => e.source === nodeId).map(e => e.target)

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    result.push(id)
    for (const edge of edges) {
      if (edge.source === id) queue.push(edge.target)
    }
  }

  return result
}
