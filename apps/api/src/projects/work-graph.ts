import { DomainError } from '../common/api-error';

/** Edges point from work to what must finish first, including a parent's children. */
export function assertWorkGraph(
  nodes: {
    id: string;
    parentId: string | null;
    dependencies: { dependsOnId: string }[];
  }[],
) {
  const edges = new Map(
    nodes.map((n) => [n.id, new Set(n.dependencies.map((d) => d.dependsOnId))]),
  );
  for (const node of nodes) {
    if (node.parentId) {
      const parent = edges.get(node.parentId);
      if (!parent)
        throw new DomainError(
          'INVALID_PARENT',
          'Parent must be in this project',
          400,
        );
      parent.add(node.id);
    }
  }
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  for (const targets of edges.values())
    for (const target of targets) {
      if (!incoming.has(target))
        throw new DomainError(
          'INVALID_DEPENDENCY',
          'Dependencies must be in this project',
          400,
        );
      incoming.set(target, incoming.get(target)! + 1);
    }
  const ready = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const next of edges.get(ready[index]!)!) {
      const count = incoming.get(next)! - 1;
      incoming.set(next, count);
      if (count === 0) ready.push(next);
    }
  }
  if (visited !== nodes.length)
    throw new DomainError(
      'DEPENDENCY_CYCLE',
      'Task dependencies and parent/child relations must not form a cycle',
    );
}
