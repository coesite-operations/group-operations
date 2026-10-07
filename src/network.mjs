import { createMcpClient, mcpInProcessTransport } from "@red-cup-engineering/mcp-engineering-services-section/client";
import { openWorkspaceAnalysisMcp } from "@red-cup-engineering/computer-code-development-engine/analysis/mcp-host";
import { openInferenceDispatchMcp } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-dispatch-mcp";
import { openFabricationMcp } from "@red-cup-engineering/computer-code-development-engine/fabrication/mcp-host";
import { openAnchoredKnowledgeMcp } from "@red-cup-engineering/computer-code-development-engine/knowledge/mcp-host";

/** Group-selected work tools; the MetroPlat runner knows none of these domains. */
export function groupNetworkSources({ config, environment, configuration = {} }) {
  const enabled = configuration.enabled ?? ["workspace", "knowledge", "inference", "fabrication"];
  if (!Array.isArray(enabled) || enabled.some((name) => !["workspace", "knowledge", "inference", "fabrication"].includes(name))) {
    throw new TypeError("Group network sources must select known work tools");
  }
  const client = (handle) => createMcpClient({
    transport: mcpInProcessTransport(handle),
    clientInfo: { name: config.instance.name, version: "1.0.0" },
  });
  const inference = enabled.includes("inference")
    ? client(openInferenceDispatchMcp({ environment }).handle)
    : undefined;
  return [
    ...(enabled.includes("workspace") ? [{
      prefix: "workspace", description: "Workspace analysis of the house repository",
      client: client(openWorkspaceAnalysisMcp({ root: config.repositoryRoot }).handle),
    }] : []),
    ...(enabled.includes("knowledge") ? [{
      prefix: "knowledge", description: "Anchored knowledge of the house repository, shared by every agent",
      client: client(openAnchoredKnowledgeMcp({ root: config.repositoryRoot, dataRoot: config.metroplatDataRoot }).handle),
    }] : []),
    ...(enabled.includes("inference") ? [{
      prefix: "inference", description: "Inference dispatch",
      client: inference,
    }] : []),
    ...(enabled.includes("fabrication") ? [{
      prefix: "fabrication", description: "JavaScript package fabrication",
      client: client(openFabricationMcp({
        root: config.repositoryRoot,
        environment,
        ...configuration.fabrication,
        inference: enabled.includes("inference"),
        // Reuse this host's inference service and its purchase checks. The
        // fabrication consumer must not construct a second customer from env.
        ...(inference === undefined ? {} : {
          inferenceCall: ({ tool, input }) => inference.call(tool.replace(/^inference_/, ""), input),
        }),
      }).handle),
    }] : []),
  ];
}
