import type { SDKCustomTool, SDKCustomToolResult, SDKJsonValue } from "@cursor/sdk"
import type { PermissionSystem } from "./types.js"

/** One write an agent wants to make. The host asks a person before running it. */
export type ToolRequest = {
  system: PermissionSystem
  action: string
  target: string
  payloadSummary: string
  params: Record<string, string>
}

/** Given to a runner for one role run. `request` resolves to text the model reads back. */
export type RuntimeTools = {
  request: (input: ToolRequest) => Promise<string>
  /** Read-only tools (no approval). Omit to expose write tools only. */
  read?: (name: ReadToolName, args: Record<string, string>) => Promise<SDKCustomToolResult>
}

type ReadToolSpec = {
  description: string
  properties: Record<string, JsonSchema>
  required: string[]
}

const FIGMA_FILE_ARG: JsonSchema = {
  type: "string",
  description: "Optional Figma file URL. Defaults to the room's Figma file from Setup.",
}

/** Read tools run immediately: they only read, so they never ask the person. */
export const READ_TOOLS = {
  design_annotate: {
    description:
      "Mark issues on an exported Figma screen: draws numbered red boxes on a copy of the image (the original is unchanged) and returns it so you can check the boxes. " +
      "Give each box in percent of the image: x,y = top-left corner, width,height = size (0-100). If a box misses its target, call again with corrected numbers.",
    properties: {
      image: { type: "string", description: "Image file name from the Figma exports folder, e.g. 'Growing Together/Directory Home.png'" },
      boxes: {
        type: "array",
        description: "Issue areas, numbered in this order",
        items: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            label: { type: "string", description: "Short issue text, e.g. 'Casablanca address on a Tanzania screen'" },
          },
          required: ["x", "y", "width", "height", "label"],
        },
      },
    },
    required: ["image", "boxes"],
  },
  jira_list_sprints: {
    description: "List the active and future sprints on the room's Jira board, with their ids and dates.",
    properties: {},
    required: [],
  },
  confluence_read_comments: {
    description:
      "Read the footer comments on the room's Confluence BRS page, e.g. to check that a comment you posted is there before posting again.",
    properties: {},
    required: [],
  },
  figma_list_frames: {
    description: "List the pages of the Figma file and the frames on each, with node ids for the other Figma tools.",
    properties: {
      page: { type: "string", description: "Optional page name (or part of it) to list only that page" },
      file_url: FIGMA_FILE_ARG,
    },
    required: [],
  },
  figma_read_frame: {
    description: "Read one Figma frame: its layer outline and all text on it (labels, copy, statuses). Use node ids from figma_list_frames.",
    properties: {
      node_id: { type: "string", description: "Frame node id, e.g. 13397:1590" },
      file_url: FIGMA_FILE_ARG,
    },
    required: ["node_id"],
  },
  figma_frame_image: {
    description: "See one Figma frame as a PNG image, to check layout and visual states. Use node ids from figma_list_frames.",
    properties: {
      node_id: { type: "string", description: "Frame node id, e.g. 13397:1590" },
      file_url: FIGMA_FILE_ARG,
    },
    required: ["node_id"],
  },
} satisfies Record<string, ReadToolSpec>

export type ReadToolName = keyof typeof READ_TOOLS

type JsonSchema = { [key: string]: SDKJsonValue }

type ToolSpec = {
  description: string
  properties: Record<string, JsonSchema>
  required: string[]
  toRequest: (args: Record<string, string>) => ToolRequest
}

const ISSUE_TYPES = ["Epic", "Story", "Subtask", "Task", "Bug"]

/** Write tools exposed to Cursor agents. Every call pauses for a person's approval. */
export const WRITE_TOOLS: Record<string, ToolSpec> = {
  jira_create_issue: {
    description:
      "Create a Jira issue (Epic, Story, Subtask, Task or Bug) in the room's Jira project. The person is asked to approve before it is created. Returns the new issue key.",
    properties: {
      issue_type: { type: "string", enum: ISSUE_TYPES },
      summary: { type: "string", description: "Issue title, under 255 characters" },
      description: { type: "string", description: "Issue body: user story, acceptance criteria, source cites" },
      parent_key: { type: "string", description: "Optional parent Epic/Story key, e.g. ORD-12" },
    },
    required: ["issue_type", "summary", "description"],
    toRequest: (args) => ({
      system: "jira",
      action: `Create ${args.issue_type}`,
      target: args.parent_key ? `under ${args.parent_key}` : "room Jira project",
      payloadSummary: `${args.summary}\n\n${args.description}`,
      params: args,
    }),
  },
  jira_add_comment: {
    description: "Add a comment to an existing Jira issue, e.g. test cases or review findings. The person is asked to approve first.",
    properties: {
      issue_key: { type: "string", description: "e.g. ORD-12" },
      body: { type: "string" },
    },
    required: ["issue_key", "body"],
    toRequest: (args) => ({
      system: "jira",
      action: "Comment",
      target: args.issue_key,
      payloadSummary: args.body,
      params: args,
    }),
  },
  jira_update_issue: {
    description:
      "Change the summary and/or description of an existing Jira issue (e.g. to correct a story). It cannot set the sprint or status. The person is asked to approve first.",
    properties: {
      issue_key: { type: "string", description: "e.g. SMETZ-114" },
      summary: { type: "string", description: "New title (optional)" },
      description: { type: "string", description: "New full description, replacing the old one (optional)" },
      reason: { type: "string", description: "Why this change is needed, shown to the person" },
    },
    required: ["issue_key", "reason"],
    toRequest: (args) => ({
      system: "jira",
      action: "Update",
      target: args.issue_key,
      payloadSummary: [
        `Reason: ${args.reason}`,
        args.summary ? `New summary: ${args.summary}` : "",
        args.description ? `New description:\n${args.description}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      params: args,
    }),
  },
  jira_attach_image: {
    description:
      "Attach an annotated screen (a file returned by design_annotate) to a Jira issue, with an optional comment listing the numbered issues. The person is asked to approve first.",
    properties: {
      issue_key: { type: "string", description: "e.g. SMETZ-114" },
      image: { type: "string", description: "Annotated file name returned by design_annotate" },
      comment: { type: "string", description: "Optional comment, e.g. the numbered issue list" },
    },
    required: ["issue_key", "image"],
    toRequest: (args) => ({
      system: "jira",
      action: "Attach image",
      target: args.issue_key,
      payloadSummary: [`![annotated screen](/api/annotations/${args.image})`, args.comment ?? ""].filter(Boolean).join("\n\n"),
      params: args,
    }),
  },
  jira_move_to_sprint: {
    description:
      "Move one or more Jira issues into a sprint on the room's Jira board (e.g. 'Sprint 6'). Use jira_list_sprints first to get the exact sprint. The person is asked to approve first.",
    properties: {
      issue_keys: { type: "string", description: "Comma-separated issue keys, e.g. SMETZ-114, SMETZ-115" },
      sprint: { type: "string", description: "Sprint id or exact sprint name from jira_list_sprints" },
    },
    required: ["issue_keys", "sprint"],
    toRequest: (args) => ({
      system: "jira",
      action: "Move to sprint",
      target: args.sprint,
      payloadSummary: `Move ${args.issue_keys} into sprint "${args.sprint}"`,
      params: args,
    }),
  },
  confluence_add_comment: {
    description: "Add a footer comment on the room's Confluence BRS page that points at a gap or issue. The person is asked to approve first.",
    properties: { body: { type: "string" } },
    required: ["body"],
    toRequest: (args) => ({
      system: "confluence",
      action: "Comment on BRS",
      target: "room Confluence page",
      payloadSummary: args.body,
      params: args,
    }),
  },
  figma_add_comment: {
    description: "Add a comment on the room's Figma file that points at a design gap. Name the frame in the text. The person is asked to approve first.",
    properties: { body: { type: "string" } },
    required: ["body"],
    toRequest: (args) => ({
      system: "figma",
      action: "Comment on design",
      target: "room Figma file",
      payloadSummary: args.body,
      params: args,
    }),
  },
  github_open_pr: {
    description: "Open a pull request on one of the room's repos. The person is asked to approve first.",
    properties: {
      repo: { type: "string", description: "owner/repo from the room's repo list" },
      title: { type: "string" },
      summary: { type: "string", description: "What changes and which Jira keys it covers" },
    },
    required: ["repo", "title", "summary"],
    toRequest: (args) => ({
      system: "github",
      action: `Open PR: ${args.title}`,
      target: args.repo,
      payloadSummary: args.summary,
      params: args,
    }),
  },
  jenkins_trigger_deploy: {
    description: "Trigger the room's Jenkins deploy job for one environment (Dev, Testing, Preprod, Prod). The person is asked to approve first.",
    properties: {
      env: { type: "string", enum: ["Dev", "Testing", "Preprod", "Prod"] },
      deploy_url: { type: "string" },
      build_ref: { type: "string" },
    },
    required: ["env"],
    toRequest: (args) => ({
      system: "jenkins",
      action: `Deploy to ${args.env}`,
      target: "room Jenkins job",
      payloadSummary: ["env", "deploy_url", "build_ref"]
        .filter((key) => args[key])
        .map((key) => `${key}=${args[key]}`)
        .join("; "),
      params: args,
    }),
  },
}

/** Build the `customTools` map for @cursor/sdk from the write tools. */
export function cursorCustomTools(tools: RuntimeTools): Record<string, SDKCustomTool> {
  const writes = Object.entries(WRITE_TOOLS).map(([name, spec]): [string, SDKCustomTool] => [
    name,
    {
      description: spec.description,
      inputSchema: { type: "object", properties: spec.properties, required: spec.required },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      execute: async (args) => {
        const strings = stringArgs(args)
        const missing = missingArgs(spec.required, strings)
        if (missing) return missing
        return tools.request(spec.toRequest(strings))
      },
    },
  ])
  const read = tools.read
  const reads = read
    ? Object.entries(READ_TOOLS).map(([name, spec]): [string, SDKCustomTool] => [
        name,
        {
          description: spec.description,
          inputSchema: { type: "object", properties: spec.properties, required: spec.required },
          annotations: { readOnlyHint: true, openWorldHint: true },
          execute: async (args) => {
            const strings = stringArgs(args)
            const missing = missingArgs(spec.required, strings)
            if (missing) return missing
            return read(name as ReadToolName, strings)
          },
        },
      ])
    : []
  return Object.fromEntries([...writes, ...reads])
}

function stringArgs(args: Record<string, SDKJsonValue>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([, value]) => value !== null && value !== undefined)
      // Arrays and objects (e.g. annotation boxes) travel as JSON text.
      .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]),
  )
}

function missingArgs(required: string[], args: Record<string, string>): SDKCustomToolResult | null {
  const missing = required.filter((key) => !args[key]?.trim())
  return missing.length ? { content: [{ type: "text", text: `Missing: ${missing.join(", ")}` }], isError: true } : null
}

export const TOOL_RULES = [
  "# Tools",
  `Read tools (no approval needed): ${Object.keys(READ_TOOLS).join(", ")}.`,
  "Before you comment on a design or write a story about a screen, look at it: list the frames, read the frame, and view its image. Cite frame names and node ids.",
  "To show design issues, call design_annotate on the exported screen, check the returned image, fix any box that misses, and put the returned ![…](/api/annotations/…) line in your message so the person sees it.",
  `Write tools: ${Object.keys(WRITE_TOOLS).join(", ")}.`,
  "Each write call pauses until the person allows or denies it. Call them when your role needs that write, one write per call.",
  "If a call returns DENIED, do not repeat it. Note it in your reply and continue.",
  "If a read tool returns FAILED, say what failed and do not guess the design.",
  "Do not also emit a Write plan table for writes you already made through tools.",
].join("\n")
