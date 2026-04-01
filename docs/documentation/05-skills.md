# Skills

Skills are modular behaviors that activate based on user input. When a skill matches, it injects instructions and optional tools into the conversation context.

---

## Defining a Skill

```typescript
import type { AgentSkill } from 'pure-agent';

const codeReviewSkill: AgentSkill = {
  name: 'code-review',
  description: 'Reviews code for quality, bugs, and best practices',
  instructions: `You are now in code review mode.
    - Analyze the code for bugs, security issues, and performance
    - Suggest improvements with code examples
    - Rate the code quality from 1-10`,
  triggerPrefix: '/review',
};
```

### Registering

```typescript
const agent = Agent.create({ apiKey: '...' });
agent.addSkill(codeReviewSkill);

// Activates automatically when user starts with "/review"
await agent.chat('/review function add(a, b) { return a + b; }');
```

---

## Matching Strategies

Skills are matched against user input in 3 levels, from most to least specific:

### 1. Prefix Match (highest priority)

```typescript
const skill: AgentSkill = {
  name: 'translate',
  description: 'Translates text',
  instructions: 'Translate the following text...',
  triggerPrefix: '/translate',  // Matches when input starts with "/translate"
};
```

### 2. Custom Match Function

```typescript
const skill: AgentSkill = {
  name: 'sql-helper',
  description: 'Helps write SQL queries',
  instructions: 'Help the user write efficient SQL queries...',
  match: (input) => {
    return input.toLowerCase().includes('sql') ||
           input.toLowerCase().includes('query') ||
           input.toLowerCase().includes('database');
  },
};
```

### 3. Semantic Match (lowest priority)

When an `EmbeddingService` is available, skills that don't match via prefix or custom function are compared semantically. If the cosine similarity between the user input and the skill description exceeds **0.7**, the skill activates.

This happens automatically — no extra configuration needed.

---

## Priority and Exclusive Mode

### Priority

When multiple skills match, they're sorted by priority (descending):

```typescript
agent.addSkill({
  name: 'general-helper',
  description: 'General assistance',
  instructions: '...',
  match: () => true,
  priority: 1,          // Lower priority
});

agent.addSkill({
  name: 'expert-coder',
  description: 'Expert coding assistance',
  instructions: '...',
  match: (input) => input.includes('code'),
  priority: 10,         // Higher priority — injected first
});
```

### Exclusive Mode

An exclusive skill blocks all other skills when active:

```typescript
agent.addSkill({
  name: 'focus-mode',
  description: 'Deep focus on a single task',
  instructions: 'Focus exclusively on the current task...',
  triggerPrefix: '/focus',
  exclusive: true,       // No other skills activate
});
```

### Max Active Skills

By default, a maximum of **3 skills** can be active simultaneously. This is configurable at the `SkillManager` level.

---

## Skills with Tools

Skills can include their own tools that are only available when the skill is active:

```typescript
import { z } from 'zod';

agent.addSkill({
  name: 'file-manager',
  description: 'File management operations',
  instructions: 'You can read and write files using the provided tools.',
  triggerPrefix: '/files',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const fs = await import('fs/promises');
        return await fs.readFile(path, 'utf-8');
      },
    },
    {
      name: 'write_file',
      description: 'Write to a file',
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const fs = await import('fs/promises');
        await fs.writeFile(path, content);
        return `Written to ${path}`;
      },
    },
  ],
});
```

---

## How Skills Work in the Pipeline

1. User sends input via `stream()` / `chat()`
2. `SkillManager.match()` evaluates all registered skills against the input
3. Matching skills (up to 3) are sorted by match type and priority
4. Each active skill's `instructions` are injected into the system context as `ContextInjection` with priority 8
5. The LLM receives the injected instructions and adapts its behavior

Skills are re-evaluated on every call — they don't persist across turns.
