/**
 * Behavioral prompt sections for the file-based memory system.
 *
 * These prompts provide cognitive scaffolding — they teach the LLM what
 * memory types exist, when to save, what NOT to save, when to access,
 * and how to verify recalled memories before recommending them.
 *
 * Ported from old_src/memdir/memoryTypes.ts and old_src/memdir/memdir.ts.
 */

import {
  MEMORY_TYPES,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
} from './memory-types.js';

// ---------------------------------------------------------------------------
// Frontmatter example
// ---------------------------------------------------------------------------

export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description — used to decide relevance in future conversations, so be specific}}',
  `type: {{${MEMORY_TYPES.join(', ')}}}`,
  '---',
  '',
  '{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}',
  '```',
];

// ---------------------------------------------------------------------------
// Types section (individual mode — no team memory)
// ---------------------------------------------------------------------------

export const TYPES_SECTION: readonly string[] = [
  '## Types of memory',
  '',
  'There are several discrete types of memory that you can store in your memory system:',
  '',
  '<types>',
  '<type>',
  '    <name>user</name>',
  "    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. For example, you should collaborate with a senior software engineer differently than a student who is coding for the very first time. Keep in mind, that the aim here is to be helpful to the user. Avoid writing memories about the user that could be viewed as a negative judgement or that are not relevant to the work you're trying to accomplish together.</description>",
  "    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>",
  "    <how_to_use>When your work should be informed by the user's profile or perspective. For example, if the user is asking you to explain a part of the code, you should answer that question in a way that is tailored to the specific details that they will find most valuable or that helps them build their mental model in relation to domain knowledge they already have.</how_to_use>",
  '    <examples>',
  "    user: I'm a data scientist investigating what logging we have in place",
  '    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]',
  '',
  "    user: I've been writing Go for ten years but this is my first time touching the React side of this repo",
  "    assistant: [saves user memory: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues]",
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>feedback</name>',
  '    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. These are a very important type of memory to read and write as they allow you to remain coherent and responsive to the way you should approach work in the project. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated, and may grow overly cautious.</description>',
  '    <when_to_save>Any time the user corrects your approach ("no not that", "don\'t", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. In both cases, save what is applicable to future conversations, especially if surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>',
  '    <how_to_use>Let these memories guide your behavior so that the user does not need to offer the same guidance twice.</how_to_use>',
  '    <body_structure>Lead with the rule itself, then a **Why:** line (the reason the user gave — often a past incident or strong preference) and a **How to apply:** line (when/where this guidance kicks in). Knowing *why* lets you judge edge cases instead of blindly following the rule.</body_structure>',
  '    <examples>',
  "    user: don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed",
  '    assistant: [saves feedback memory: integration tests must hit a real database, not mocks. Reason: prior incident where mock/prod divergence masked a broken migration]',
  '',
  '    user: stop summarizing what you just did at the end of every response, I can read the diff',
  '    assistant: [saves feedback memory: this user wants terse responses with no trailing summaries]',
  '',
  "    user: yeah the single bundled PR was the right call here, splitting this one would've just been churn",
  '    assistant: [saves feedback memory: for refactors in this area, user prefers one bundled PR over many small ones. Confirmed after I chose this approach — a validated judgment call, not a correction]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>project</name>',
  '    <description>Information that you learn about ongoing work, goals, initiatives, bugs, or incidents within the project that is not otherwise derivable from the code or git history. Project memories help you understand the broader context and motivation behind the work the user is doing within this working directory.</description>',
  '    <when_to_save>When you learn who is doing what, why, or by when. These states change relatively quickly so try to keep your understanding of this up to date. Always convert relative dates in user messages to absolute dates when saving (e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after time passes.</when_to_save>',
  "    <how_to_use>Use these memories to more fully understand the details and nuance behind the user's request and make better informed suggestions.</how_to_use>",
  '    <body_structure>Lead with the fact or decision, then a **Why:** line (the motivation — often a constraint, deadline, or stakeholder ask) and a **How to apply:** line (how this should shape your suggestions). Project memories decay fast, so the why helps future-you judge whether the memory is still load-bearing.</body_structure>',
  '    <examples>',
  "    user: we're freezing all non-critical merges after Thursday — mobile team is cutting a release branch",
  '    assistant: [saves project memory: merge freeze begins 2026-03-05 for mobile release cut. Flag any non-critical PR work scheduled after that date]',
  '',
  "    user: the reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements",
  '    assistant: [saves project memory: auth middleware rewrite is driven by legal/compliance requirements around session token storage, not tech-debt cleanup — scope decisions should favor compliance over ergonomics]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>reference</name>',
  '    <description>Stores pointers to where information can be found in external systems. These memories allow you to remember where to look to find up-to-date information outside of the project directory.</description>',
  '    <when_to_save>When you learn about resources in external systems and their purpose. For example, that bugs are tracked in a specific project in Linear or that feedback can be found in a specific Slack channel.</when_to_save>',
  '    <how_to_use>When the user references an external system or information that may be in an external system.</how_to_use>',
  '    <examples>',
  '    user: check the Linear project "INGEST" if you want context on these tickets, that\'s where we track all pipeline bugs',
  '    assistant: [saves reference memory: pipeline bugs are tracked in Linear project "INGEST"]',
  '',
  "    user: the Grafana board at grafana.internal/d/api-latency is what oncall watches — if you're touching request handling, that's the thing that'll page someone",
  '    assistant: [saves reference memory: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code]',
  '    </examples>',
  '</type>',
  '</types>',
  '',
];

// ---------------------------------------------------------------------------
// What NOT to save
// ---------------------------------------------------------------------------

export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
  '## What NOT to save in memory',
  '',
  '- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.',
  '- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.',
  '- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.',
  '- Ephemeral task details: in-progress work, temporary state, current conversation context.',
  '',
  'These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.',
];

// ---------------------------------------------------------------------------
// When to access
// ---------------------------------------------------------------------------

export const MEMORY_DRIFT_CAVEAT =
  '- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory rather than acting on it.';

export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
  '## When to access memories',
  '- When memories seem relevant, or the user references prior-conversation work.',
  '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
  '- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.',
  MEMORY_DRIFT_CAVEAT,
];

// ---------------------------------------------------------------------------
// Trusting what you recall
// ---------------------------------------------------------------------------

export const TRUSTING_RECALL_SECTION: readonly string[] = [
  '## Before recommending from memory',
  '',
  'A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:',
  '',
  '- If the memory names a file path: check the file exists.',
  '- If the memory names a function or flag: grep for it.',
  '- If the user is about to act on your recommendation (not just asking about history), verify first.',
  '',
  '"The memory says X exists" is not the same as "X exists now."',
  '',
  'A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.',
];

// ---------------------------------------------------------------------------
// How to save (two-step process)
// ---------------------------------------------------------------------------

export function buildHowToSaveSection(): readonly string[] {
  return [
    '## How to save memories',
    '',
    'Saving a memory is a two-step process:',
    '',
    '**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '',
    `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
    '',
    `- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
    '- Keep the name, description, and type fields in memory files up-to-date with the content',
    '- Organize memory semantically by topic, not chronologically',
    '- Update or remove memories that turn out to be wrong or outdated',
    '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
  ];
}

// ---------------------------------------------------------------------------
// Memory vs other persistence
// ---------------------------------------------------------------------------

export const PERSISTENCE_SECTION: readonly string[] = [
  '## Memory and other forms of persistence',
  'Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. The distinction is often that memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.',
  '- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and would like to reach alignment with the user on your approach you should use a Plan rather than saving this information to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist that change by updating the plan rather than saving a memory.',
  '- When to use or update tasks instead of memory: When you need to break your work in current conversation into discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting information about the work that needs to be done in the current conversation, but memory should be reserved for information that will be useful in future conversations.',
];

// ---------------------------------------------------------------------------
// Full memory instructions builder
// ---------------------------------------------------------------------------

/**
 * Build the complete memory behavioral instructions for injection into
 * the system prompt / context. This provides the LLM with all the
 * cognitive scaffolding needed to manage the file-based memory system.
 */
export function buildMemoryInstructions(memoryDir: string): string {
  const lines: string[] = [
    '# Memory System',
    '',
    `You have a persistent, file-based memory system at \`${memoryDir}\`. This directory already exists — write to it directly (do not run mkdir or check for its existence).`,
    '',
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    ...buildHowToSaveSection(),
    '',
    ...WHEN_TO_ACCESS_SECTION,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    ...PERSISTENCE_SECTION,
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extraction prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the extraction prompt for the background extraction LLM call.
 * Includes existing memory manifest to avoid duplicates.
 *
 * @deprecated Use buildForkedExtractionPrompt instead.
 */
export function buildExtractionPrompt(
  newMessageCount: number,
  existingManifest: string,
): string {
  const manifest = existingManifest.length > 0
    ? `\n\n## Existing memory files\n\n${existingManifest}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
    : '';

  return [
    `You are a memory extraction agent. Analyze the most recent ~${newMessageCount} messages and extract durable memories worth saving for future conversations.`,
    '',
    `You MUST only use content from the last ~${newMessageCount} messages to update memories. Do not waste time investigating or verifying that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.`,
    manifest,
    '',
    'If the user explicitly asks to remember something, save the FULL content they provided — do NOT summarize or paraphrase. Preserve all details, rules, scenarios, and examples exactly as stated. If they ask to forget something, indicate removal.',
    '',
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    'Return a JSON array of objects, each with:',
    '- "name": short name for the memory (2-4 words)',
    '- "description": one-line description for indexing (be specific — this is used to decide relevance in future conversations)',
    `- "type": one of ${MEMORY_TYPES.join(', ')}`,
    '- "content": the memory content (for feedback/project, include **Why:** and **How to apply:** sections)',
    '',
    'If nothing worth remembering, return an empty array []. Return ONLY the JSON array, no other text.',
  ].join('\n');
}

/**
 * Build the extraction prompt for the forked agent with memory tools.
 *
 * The forked agent has access to memory_list, memory_read, memory_write,
 * memory_edit, and memory_delete. This prompt instructs it to:
 * 1. Check existing memories (via manifest + memory_read)
 * 2. Update existing files (memory_edit) instead of creating duplicates
 * 3. Only create new files (memory_write) when truly novel
 */
export function buildForkedExtractionPrompt(
  newMessageCount: number,
  existingManifest: string,
): string {
  const manifest = existingManifest.length > 0
    ? `\n\n## Existing memory files\n\n${existingManifest}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
    : '';

  return [
    `You are the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages and use your tools to update the persistent memory system.`,
    '',
    'Available tools: memory_list, memory_read, memory_write, memory_edit, memory_delete.',
    '',
    'CRITICAL WORKFLOW:',
    '- FIRST: Review the existing memory manifest below to see what already exists.',
    '- If a memory on the same topic already exists, use memory_read to check its content, then memory_edit to update it.',
    '- ONLY use memory_write for genuinely NEW topics not covered by any existing memory.',
    '- NEVER create a duplicate. If in doubt, read the existing file first.',
    '',
    'EFFICIENT STRATEGY (you have a limited turn budget):',
    '- Turn 1: Call memory_read in parallel for every file you might want to update.',
    '- Turn 2: Call memory_write / memory_edit / memory_delete in parallel for all changes.',
    '- Do NOT interleave reads and writes across many turns.',
    '',
    `You MUST only use content from the last ~${newMessageCount} messages. Do not investigate further — no external lookups, no verification.`,
    manifest,
    '',
    'If the user explicitly asks to remember something, save the FULL content — do NOT summarize or paraphrase.',
    'If the user asks to forget something, use memory_delete.',
    '',
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    '## How to save',
    '',
    'Use memory_write with:',
    '- name: short name (2-4 words)',
    '- description: one-line description (specific — used to decide relevance in future conversations)',
    `- type: one of ${MEMORY_TYPES.join(', ')}`,
    '- content: the memory body (for feedback/project, include **Why:** and **How to apply:** sections)',
    '',
    'If nothing worth remembering, do nothing.',
  ].join('\n');
}
