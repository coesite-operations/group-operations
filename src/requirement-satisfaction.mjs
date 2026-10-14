/**
 * Operational completion law for one existing signed requirement.
 *
 * The FOUR evidence charge is a paraconsistent reading of testimony, NOT a
 * conjunction of acceptance conditions. A requirement is behaviorally
 * satisfied only if its originating claim is uncontested and every declared
 * condition was executed as behavior, with positive and no contrary evidence.
 * Missing conditions, observations or author corroboration never imply work
 * completed. This pure predicate neither admits work nor signs acceptance.
 */
export function metWhenSatisfied(conditions, requirementCharge) {
  if (!Array.isArray(conditions)) throw new TypeError("requirement conditions must be a list");
  return requirementCharge === "held" && conditions.length > 0 && conditions.every((condition) =>
    condition?.exercises === "behavior" && condition.charge === "held" &&
    Array.isArray(condition.told?.for) && condition.told.for.length > 0 &&
    Array.isArray(condition.told?.against) && condition.told.against.length === 0);
}
