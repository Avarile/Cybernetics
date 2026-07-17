"use client";

import { useCallback } from "react";
import {
  addEdge,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import { nanoid } from "nanoid";

import { Canvas } from "@/components/ai-elements/workflow/canvas";
import { Connection as ConnectionLine } from "@/components/ai-elements/workflow/connection";
import { Controls } from "@/components/ai-elements/workflow/controls";
import { Edge } from "@/components/ai-elements/workflow/edge";
import {
  Node as WorkflowShell,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/workflow/node";
import { Panel } from "@/components/ai-elements/workflow/panel";
import { Toolbar } from "@/components/ai-elements/workflow/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  IconBolt,
  IconBrain,
  IconCopy,
  IconGitBranch,
  IconGripVertical,
  IconPlayerPlay,
  IconSquareCheck,
  IconTrash,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

// ─── Domain types ──────────────────────────────────────────────────────────────

type NodeStatus = "idle" | "running" | "done" | "error";
type FlowNodeType = "trigger" | "process" | "decision" | "action" | "terminal";

interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  nodeType: FlowNodeType;
  status: NodeStatus;
  handles: { target: boolean; source: boolean };
}

// ─── Visual config maps ────────────────────────────────────────────────────────

const NODE_CFG: Record<
  FlowNodeType,
  {
    icon: ComponentType<{ className?: string }>;
    iconColor: string;
    badgeClass: string;
    label: string;
    miniMapColor: string;
  }
> = {
  trigger: {
    icon: IconBolt,
    iconColor: "text-emerald-500",
    badgeClass:
      "border-emerald-200 bg-emerald-500/10 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400",
    label: "Trigger",
    miniMapColor: "#10b981",
  },
  process: {
    icon: IconBrain,
    iconColor: "text-blue-500",
    badgeClass:
      "border-blue-200 bg-blue-500/10 text-blue-600 dark:border-blue-800 dark:text-blue-400",
    label: "Process",
    miniMapColor: "#3b82f6",
  },
  decision: {
    icon: IconGitBranch,
    iconColor: "text-purple-500",
    badgeClass:
      "border-purple-200 bg-purple-500/10 text-purple-600 dark:border-purple-800 dark:text-purple-400",
    label: "Decision",
    miniMapColor: "#a855f7",
  },
  action: {
    icon: IconPlayerPlay,
    iconColor: "text-amber-500",
    badgeClass:
      "border-amber-200 bg-amber-500/10 text-amber-600 dark:border-amber-800 dark:text-amber-400",
    label: "Action",
    miniMapColor: "#f59e0b",
  },
  terminal: {
    icon: IconSquareCheck,
    iconColor: "text-slate-500",
    badgeClass:
      "border-slate-200 bg-slate-500/10 text-slate-600 dark:border-slate-700 dark:text-slate-400",
    label: "Terminal",
    miniMapColor: "#64748b",
  },
};

const STATUS_CFG: Record<NodeStatus, { dot: string; label: string }> = {
  idle:    { dot: "bg-slate-300",                label: "Idle"    },
  running: { dot: "bg-yellow-400 animate-pulse", label: "Running" },
  done:    { dot: "bg-emerald-400",              label: "Done"    },
  error:   { dot: "bg-red-400",                  label: "Error"   },
};

// ─── WorkflowNode ──────────────────────────────────────────────────────────────
// Rendered by React Flow for every node of type "workflow".
// Uses useReactFlow for delete / duplicate so changes flow through onNodesChange.

function WorkflowNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: WorkflowNodeData;
  selected?: boolean;
}) {
  const { deleteElements, addNodes, getNode } = useReactFlow();
  const cfg    = NODE_CFG[data.nodeType];
  const status = STATUS_CFG[data.status];
  const Icon   = cfg.icon;

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [id, deleteElements]);

  const handleDuplicate = useCallback(() => {
    const source = getNode(id);
    if (!source) return;
    addNodes({
      ...source,
      id: nanoid(),
      selected: false,
      position: { x: source.position.x + 40, y: source.position.y + 40 },
    });
  }, [id, addNodes, getNode]);

  return (
    <>
      {/* NodeToolbar — rendered outside the node frame, visible when selected */}
      <Toolbar>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleDuplicate}
          title="Duplicate"
        >
          <IconCopy className="h-3.5 w-3.5" />
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={handleDelete}
          title="Delete"
        >
          <IconTrash className="h-3.5 w-3.5" />
        </Button>
      </Toolbar>

      {/* Node card shell — provides handles and Card layout */}
      <WorkflowShell
        handles={data.handles}
        className={cn(
          "transition-shadow",
          selected && "ring-2 ring-primary ring-offset-1"
        )}
      >
        <NodeHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon className={cn("h-4 w-4 shrink-0", cfg.iconColor)} />
              <NodeTitle className="truncate text-sm">{data.label}</NodeTitle>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  status.dot
                )}
                title={status.label}
              />
              <Badge
                variant="outline"
                className={cn(
                  "h-4 px-1.5 py-0 text-[10px] font-normal",
                  cfg.badgeClass
                )}
              >
                {cfg.label}
              </Badge>
            </div>
          </div>
        </NodeHeader>

        <NodeContent>
          <NodeDescription className="text-xs leading-relaxed">
            {data.description}
          </NodeDescription>
        </NodeContent>

        <NodeFooter>
          <span className="font-mono text-[10px] text-muted-foreground">
            {id.slice(0, 8)}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {status.label}
          </span>
        </NodeFooter>
      </WorkflowShell>
    </>
  );
}

// ─── Node & Edge type registries ───────────────────────────────────────────────

const nodeTypes = { workflow: WorkflowNode };
const edgeTypes = { animated: Edge.Animated, dashed: Edge.Temporary };

// ─── Initial graph — Customer Support AI Pipeline ─────────────────────────────

function node(
  id: string,
  label: string,
  description: string,
  nodeType: FlowNodeType,
  status: NodeStatus,
  x: number,
  y: number,
  handles: { target: boolean; source: boolean }
) {
  return { id, type: "workflow", position: { x, y }, data: { label, description, nodeType, status, handles } };
}

const IDS = {
  trigger:  "n-trigger",
  classify: "n-classify",
  route:    "n-route",
  faq:      "n-faq",
  escalate: "n-escalate",
  archive:  "n-archive",
  send:     "n-send",
  ticket:   "n-ticket",
};

const INITIAL_NODES = [
  node(IDS.trigger,  "Webhook Trigger",   "Incoming customer message received via REST webhook",      "trigger",  "done",    0,    175, { target: false, source: true  }),
  node(IDS.classify, "Classify Intent",   "NLP model scores intent: FAQ · human · spam",              "process",  "done",    480,  175, { target: true,  source: true  }),
  node(IDS.route,    "Route Decision",    "Branch on the highest-confidence intent class",             "decision", "running", 960,  175, { target: true,  source: true  }),
  node(IDS.faq,      "FAQ Response",      "Retrieve nearest-match answer from vector knowledge-base",  "action",   "idle",    1440, 0,   { target: true,  source: true  }),
  node(IDS.escalate, "Escalate to Agent", "Assign conversation to an available human support agent",   "action",   "idle",    1440, 175, { target: true,  source: true  }),
  node(IDS.archive,  "Log & Archive",     "Tag as spam and store for abuse-pattern analysis",          "action",   "idle",    1440, 350, { target: true,  source: false }),
  node(IDS.send,     "Send Reply",        "Deliver auto-response and mark ticket as resolved",         "terminal", "idle",    1920, 0,   { target: true,  source: false }),
  node(IDS.ticket,   "Create Ticket",     "Open a support ticket and notify the assigned agent",       "terminal", "idle",    1920, 175, { target: true,  source: false }),
];

const INITIAL_EDGES = [
  { id: nanoid(), source: IDS.trigger,  target: IDS.classify, type: "animated" },
  { id: nanoid(), source: IDS.classify, target: IDS.route,    type: "animated" },
  { id: nanoid(), source: IDS.route,    target: IDS.faq,      type: "animated", label: "FAQ"   },
  { id: nanoid(), source: IDS.route,    target: IDS.escalate, type: "dashed",   label: "Human" },
  { id: nanoid(), source: IDS.route,    target: IDS.archive,  type: "dashed",   label: "Spam"  },
  { id: nanoid(), source: IDS.faq,      target: IDS.send,     type: "animated" },
  { id: nanoid(), source: IDS.escalate, target: IDS.ticket,   type: "animated" },
];

// ─── Sidebar palette ───────────────────────────────────────────────────────────

const PALETTE: Array<{
  nodeType: FlowNodeType;
  defaultLabel: string;
  defaultDesc: string;
  handles: { target: boolean; source: boolean };
}> = [
  { nodeType: "trigger",  defaultLabel: "Trigger",   defaultDesc: "Entry point for the workflow",          handles: { target: false, source: true  } },
  { nodeType: "process",  defaultLabel: "Process",   defaultDesc: "Transform or analyze incoming data",    handles: { target: true,  source: true  } },
  { nodeType: "decision", defaultLabel: "Decision",  defaultDesc: "Branch based on a condition",           handles: { target: true,  source: true  } },
  { nodeType: "action",   defaultLabel: "Action",    defaultDesc: "Perform a side-effect or API call",     handles: { target: true,  source: true  } },
  { nodeType: "terminal", defaultLabel: "Terminal",  defaultDesc: "End state — success or failure",        handles: { target: true,  source: false } },
];

function SidebarPalette() {
  const onDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    item: (typeof PALETTE)[number]
  ) => {
    e.dataTransfer.setData("wf/type",   item.nodeType);
    e.dataTransfer.setData("wf/label",  item.defaultLabel);
    e.dataTransfer.setData("wf/desc",   item.defaultDesc);
    e.dataTransfer.setData("wf/target", String(item.handles.target));
    e.dataTransfer.setData("wf/source", String(item.handles.source));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2 border-r bg-card p-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Node Palette
      </p>

      {PALETTE.map((item) => {
        const cfg  = NODE_CFG[item.nodeType];
        const Icon = cfg.icon;
        return (
          <div
            key={item.nodeType}
            draggable
            onDragStart={(e) => onDragStart(e, item)}
            className="flex cursor-grab select-none items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm hover:bg-accent active:cursor-grabbing"
          >
            <IconGripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
            <Icon className={cn("h-4 w-4 shrink-0", cfg.iconColor)} />
            <span className="font-medium">{cfg.label}</span>
          </div>
        );
      })}

      {/* Edge legend */}
      <div className="mt-1 space-y-1.5 rounded-md border bg-muted/30 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Edge Types
        </p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <svg width="28" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="28" y2="3" stroke="var(--color-primary)" strokeWidth="1.5" />
          </svg>
          Primary flow
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <svg width="28" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="28" y2="3" stroke="var(--color-ring)" strokeWidth="1" strokeDasharray="4 3" />
          </svg>
          Alternative path
        </div>
      </div>

      {/* Usage hint */}
      <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
        Drag a node onto the canvas. Connect nodes by dragging between handles. Select a node to reveal toolbar actions.
      </p>
    </aside>
  );
}

// ─── Inner flow component — requires ReactFlowProvider above it ────────────────

function FlowInner() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES as RFNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES as RFEdge[]);
  const { screenToFlowPosition, addNodes } = useReactFlow();

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, type: "animated" }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData("wf/type") as FlowNodeType;
      if (!nodeType) return;

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodes({
        id: nanoid(),
        type: "workflow",
        position,
        data: {
          label:       e.dataTransfer.getData("wf/label") || "New Node",
          description: e.dataTransfer.getData("wf/desc")  || "",
          nodeType,
          status:      "idle" as NodeStatus,
          handles: {
            target: e.dataTransfer.getData("wf/target") !== "false",
            source: e.dataTransfer.getData("wf/source") !== "false",
          },
        } satisfies WorkflowNodeData,
      });
    },
    [screenToFlowPosition, addNodes]
  );

  return (
    <Canvas
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      connectionLineComponent={ConnectionLine}
      fitView
    >
      <Controls />

      {/* Minimap — each node type gets its own colour */}
      <MiniMap
        className="overflow-hidden rounded-md border"
        nodeColor={(n) =>
          NODE_CFG[(n.data as WorkflowNodeData).nodeType]?.miniMapColor ??
          "#64748b"
        }
        maskColor="var(--sidebar)"
        zoomable
        pannable
      />

      {/* Stats panel */}
      <Panel position="top-right">
        <div className="flex items-center gap-3 px-1 py-0.5 text-xs text-muted-foreground">
          <span>
            <strong className="font-semibold text-foreground">
              {nodes.length}
            </strong>{" "}
            nodes
          </span>
          <span>
            <strong className="font-semibold text-foreground">
              {edges.length}
            </strong>{" "}
            edges
          </span>
        </div>
      </Panel>

      {/* Status legend panel */}
      <Panel position="bottom-right">
        <div className="space-y-1 px-1 py-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          {(Object.entries(STATUS_CFG) as [NodeStatus, (typeof STATUS_CFG)[NodeStatus]][]).map(
            ([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full", cfg.dot)} />
                {cfg.label}
              </div>
            )
          )}
        </div>
      </Panel>
    </Canvas>
  );
}

// ─── Public export ─────────────────────────────────────────────────────────────

export default function CanvasExample() {
  return (
    // ReactFlowProvider makes useReactFlow() available in FlowInner (which renders
    // <ReactFlow>) AND in WorkflowNode components rendered inside the flow.
    <ReactFlowProvider>
      <div className="flex flex-1 overflow-hidden">
        <SidebarPalette />
        <div className="relative flex-1">
          <FlowInner />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
