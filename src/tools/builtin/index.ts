/**
 * Builtin tools — opt-in tools that ship with the SDK.
 *
 * Usage:
 *   import { builtinTools } from 'agentx-sdk';
 *   agent.addTool(builtinTools.fileRead());
 *   // or: builtinTools.all().forEach(t => agent.addTool(t));
 */

import type { AgentTool } from '../../contracts/entities/agent-tool.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createBashTool } from './bash.js';
import { createWebFetchTool } from './web-fetch.js';
import { createAskUserTool, type AskUserOptions as _AskUserOptions } from './ask-user.js';

export const builtinTools = {
  /** File pattern search (**, *, ?) */
  glob: createGlobTool,
  /** Content search via regex */
  grep: createGrepTool,
  /** Read file contents with line numbers */
  fileRead: createFileReadTool,
  /** Write/create files */
  fileWrite: createFileWriteTool,
  /** Find/replace edit in files */
  fileEdit: createFileEditTool,
  /** Shell command execution */
  bash: createBashTool,
  /** Fetch URL content */
  webFetch: createWebFetchTool,
  /** Ask user a question (requires callback) */
  askUser: createAskUserTool,

  /** All tools except askUser (which needs a callback) */
  all(workingDir?: string): AgentTool[] {
    return [
      createGlobTool(),
      createGrepTool(),
      createFileReadTool(),
      createFileWriteTool(workingDir),
      createFileEditTool(workingDir),
      createBashTool(),
      createWebFetchTool(),
    ];
  },

  /** File operation tools: read + write + edit + glob + grep */
  fileOps(workingDir?: string): AgentTool[] {
    return [
      createFileReadTool(),
      createFileWriteTool(workingDir),
      createFileEditTool(workingDir),
      createGlobTool(),
      createGrepTool(),
    ];
  },
};

export { createGlobTool } from './glob.js';
export { createGrepTool } from './grep.js';
export { createFileReadTool } from './file-read.js';
export { createFileWriteTool } from './file-write.js';
export { createFileEditTool } from './file-edit.js';
export { createBashTool } from './bash.js';
export { createWebFetchTool } from './web-fetch.js';
export { createAskUserTool } from './ask-user.js';
export type { AskUserOptions } from './ask-user.js';
