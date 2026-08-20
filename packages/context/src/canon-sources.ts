import {
  canAccessFact,
  type CanonAccess,
  type CanonEntity,
  type CanonFact,
} from "@narrative-lantern/domain";

import type { ContextSource } from "./types.js";

export function canonContextSources(
  entities: readonly CanonEntity[],
  facts: readonly CanonFact[],
  access: CanonAccess,
): ContextSource[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const visibleFacts = facts.filter((fact) => canAccessFact(fact, access));
  const grouped = new Map<string, CanonFact[]>();
  for (const fact of visibleFacts) {
    const group = grouped.get(fact.subjectId) ?? [];
    group.push(fact);
    grouped.set(fact.subjectId, group);
  }
  return [...grouped.entries()]
    .map(([subjectId, subjectFacts]): ContextSource | null => {
      const entity = byId.get(subjectId);
      if (!entity) return null;
      const factLines = subjectFacts
        .sort((left, right) => left.predicate.localeCompare(right.predicate))
        .map((fact) => {
          const object = fact.objectEntityId
            ? (byId.get(fact.objectEntityId)?.name ??
              `[entity:${fact.objectEntityId}]`)
            : JSON.stringify(fact.value);
          return `- [fact:${fact.id}] ${fact.predicate}: ${object} [${fact.authority}; ${fact.knowledgeScope}]`;
        });
      return {
        id: `canon:${entity.id}`,
        kind: "canon",
        label: `${entity.type} · ${entity.name}`,
        content: [`# ${entity.name}`, entity.description ?? "", ...factLines]
          .filter(Boolean)
          .join("\n"),
        authority: subjectFacts.some((fact) => fact.authority === "locked")
          ? "locked"
          : "confirmed",
        priority: 80,
        sourceType: "canon_entity",
        sourceId: entity.id,
        metadata: {
          entityType: entity.type,
          factIds: subjectFacts.map((fact) => fact.id),
        },
      };
    })
    .filter((source): source is ContextSource => source !== null);
}
