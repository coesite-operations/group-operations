import { enterpriseOperations, enterpriseRoots, enterpriseStore } from "@red-cup-engineering/organizing/enterprise";
import { agencyAt, agencyRootOf, bearerTestimonyOf, boardDeedsOf, handedAgency, officesOfAccount, repositoryRootOf } from "@red-cup-engineering/metroplat/offices";
import { LAND_PROCEDURE } from "@red-cup-engineering/land-contracts-services-section/pipeline";
import { HEIR_PROCEDURE } from "@red-cup-engineering/heir-search-services-section/operations";
import { CLAIMS_PROCEDURE } from "@red-cup-engineering/structural-claims-register-services-section/register";
import { REPRESENTATION_PROCEDURE } from "@red-cup-engineering/us-representation-services-section/operations";
import { groupBusinessReadoutOperation } from "./group-business-readout.mjs";
import { groupComputeResourceOperation } from "./group-compute-operation.mjs";

/** The Group's micro-enterprises as one operation source: each business's procedure, the agency's offices as who may act. */
export function groupEnterpriseOperations(binding) {
  // The agency may be read from a release; enterprises keep their roots in the working tree.
  const roots = enterpriseRoots(() => agencyAt(agencyRootOf(binding)), { repositoryRoot: repositoryRootOf(binding) });
  const operations = enterpriseOperations(binding, {
    agency: () => agencyAt(agencyRootOf(binding)),
    store: enterpriseStore(binding, { roots }),
    procedures: {
      "land-contracts": LAND_PROCEDURE,
      "heir-search": HEIR_PROCEDURE,
      "structural-claims-register": CLAIMS_PROCEDURE,
      "us-representation": REPRESENTATION_PROCEDURE,
    },
    holds: (subject, office) => officesOfAccount(binding, subject).some((held) => held.office === office || held.office.endsWith(`#${office}`)),
    // An enterprise's governing acts are its doers' (organizing/agency governing): who the caller is, the
    // deeds on the work board that make a doer, and each bearer's carrier testimony.
    handedAgency: () => handedAgency(binding),
    deedsOf: boardDeedsOf(binding),
    testimony: () => bearerTestimonyOf(binding),
  });
  const readEnterprises = operations.find((entry) => entry.verb === "enterprises");
  const readBoard = operations.find((entry) => entry.verb === "enterprise-board");
  if (!readEnterprises || !readBoard) throw new Error("group enterprise operations require enterprises and enterprise-board");
  return Object.freeze([...operations, groupComputeResourceOperation({ now: binding.now }), groupBusinessReadoutOperation({
    readEnterprises: () => readEnterprises.execute({}),
    readBoard: () => readBoard.execute({ at: binding.now() }),
    clock: binding.now,
  })]);
}
