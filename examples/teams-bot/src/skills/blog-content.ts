import type { AgentSkill } from 'agentx-sdk';

export const blogContentSkill: AgentSkill = {
  name: 'blog_content',
  description: 'Create blog content and articles',
  instructions: 'Help the user create blog posts and articles.',
  inputSchema: { type: 'object', properties: {} },
};
