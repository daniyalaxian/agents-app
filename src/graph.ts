/**
 * An automation is a graph of agent nodes joined by edges (AU-1). The engine still runs an ordered list, so a graph is
 * compiled to that list. Today a graph must be one straight chain; branches and merges (AU-7) are rejected with a clear
 * message instead of being silently flattened.
 */

export type GraphNode = {
  id: string
  /** Agent name from the catalog. */
  agent: string
  /** Pause for the person's OK after this agent finishes. */
  approval: boolean
  /** Joins the kickoff discussion (a group chat) instead of running alone. */
  swarm?: boolean
  /** Run this agent on the high-reasoning model (costs more). */
  reasoning?: boolean
  x: number
  y: number
}

export type GraphEdge = { from: string; to: string }

export type AutomationGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export const NODE_SPACING = 220

/** A chain laid out left to right. Used for teams that were made as plain lists, and by the Axian import. */
export function linearGraph(agentNames: string[], approvalMap: Record<string, boolean> = {}): AutomationGraph {
  const nodes = agentNames.map((agent, index) => ({
    id: `n${index + 1}`,
    agent,
    approval: approvalMap[agent] === true,
    x: 40 + index * NODE_SPACING,
    y: 60,
  }))
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }))
  return { nodes, edges }
}

/** Cleans untrusted input into a graph. Throws on a shape that is not a graph at all. */
export function parseGraph(value: unknown): AutomationGraph {
  const raw = value as { nodes?: unknown; edges?: unknown } | null
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("A graph needs nodes and edges")
  if (raw.nodes.length > 40) throw new Error("A graph can have at most 40 nodes")
  const nodes: GraphNode[] = raw.nodes.map((item: Record<string, unknown>) => {
    const id = typeof item?.id === "string" ? item.id.slice(0, 40) : ""
    const agent = typeof item?.agent === "string" ? item.agent : ""
    if (!id || !agent) throw new Error("Every node needs an id and an agent")
    return {
      id,
      agent,
      approval: item.approval === true,
      swarm: item.swarm === true,
      reasoning: item.reasoning === true,
      x: Number.isFinite(item.x) ? Number(item.x) : 0,
      y: Number.isFinite(item.y) ? Number(item.y) : 0,
    }
  })
  const edges: GraphEdge[] = raw.edges.map((item: Record<string, unknown>) => ({
    from: typeof item?.from === "string" ? item.from : "",
    to: typeof item?.to === "string" ? item.to : "",
  }))
  return { nodes, edges }
}

/**
 * Turns a graph into the ordered agent list the engine runs.
 * Rules: at least one node, unique node ids, one node per agent, edges only between known nodes, no loops,
 * and a single straight chain (each node has at most one way in and one way out).
 */
export function compileGraph(graph: AutomationGraph): {
  agentNames: string[]
  approvalMap: Record<string, boolean>
  swarmNames: string[]
} {
  const { nodes, edges } = graph
  if (!nodes.length) throw new Error("Add at least one agent to the automation")
  const byId = new Map<string, GraphNode>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Two nodes share the id ${node.id}`)
    byId.set(node.id, node)
  }
  const agents = new Set<string>()
  for (const node of nodes) {
    if (agents.has(node.agent)) throw new Error(`${node.agent} appears twice. Each agent can be in an automation once.`)
    agents.add(node.agent)
  }

  const next = new Map<string, string>()
  const hasIn = new Set<string>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error("An edge points at a node that does not exist")
    if (edge.from === edge.to) throw new Error("An agent cannot be connected to itself")
    if (next.has(edge.from)) throw new Error("Branches are not supported yet: an agent can lead to only one next agent")
    if (hasIn.has(edge.to)) throw new Error("Merges are not supported yet: an agent can follow only one agent")
    next.set(edge.from, edge.to)
    hasIn.add(edge.to)
  }

  const starts = nodes.filter((node) => !hasIn.has(node.id))
  if (starts.length === 0) throw new Error("The automation loops back on itself")
  if (starts.length > 1) throw new Error("Connect every agent into one chain. Found separate pieces: " + starts.map((node) => node.agent).join(", "))

  const order: GraphNode[] = []
  const seen = new Set<string>()
  for (let id: string | undefined = starts[0].id; id; id = next.get(id)) {
    if (seen.has(id)) throw new Error("The automation loops back on itself")
    seen.add(id)
    order.push(byId.get(id)!)
  }
  if (order.length !== nodes.length) throw new Error("Connect every agent into one chain")

  // The discussion hands off to the agents after it, so its members must be the first ones in the chain.
  const swarmNames = order.filter((node) => node.swarm).map((node) => node.agent)
  if (swarmNames.length === 1) throw new Error("A discussion needs at least two agents. Mark another, or untick this one.")
  if (swarmNames.length > 1 && !order.slice(0, swarmNames.length).every((node) => node.swarm)) {
    throw new Error("Agents in the discussion must come first in the chain, one after another.")
  }

  return {
    swarmNames,
    agentNames: order.map((node) => node.agent),
    approvalMap: Object.fromEntries(order.map((node) => [node.agent, node.approval])),
  }
}
