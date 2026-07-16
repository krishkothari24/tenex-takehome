import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentChatRequestSchema, agentStreamEventSchema } from '@inbox-concierge/shared';

// Validates the one wire boundary this feature adds beyond the rest of the app: a client-held,
// client-resent conversation history the server must trust enough to feed into a real Anthropic
// call every turn. Colocated here rather than in packages/shared since only apps/server's test
// runner (`npm run test`) is wired up in this monorepo.

test('accepts a well-formed request with empty history', () => {
  const parsed = agentChatRequestSchema.parse({ message: 'Find emails from Sarah about the contract', history: [] });
  assert.equal(parsed.message, 'Find emails from Sarah about the contract');
});

test('accepts a well-formed request with a prior text + tool_use + tool_result turn', () => {
  const parsed = agentChatRequestSchema.parse({
    message: 'the one about the lease',
    history: [
      { role: 'user', content: 'email from John' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'There are two Johns — which one did you mean?' },
          { type: 'tool_use', id: 'call_1', name: 'search_emails', input: { keyword: null, sender: 'John', bucket: null, is_unread: null, limit: null } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"count":2,"results":[]}' }],
      },
    ],
  });
  assert.equal(parsed.history.length, 3);
});

test('rejects an empty message', () => {
  assert.throws(() => agentChatRequestSchema.parse({ message: '', history: [] }));
});

test('rejects a message over the length cap', () => {
  assert.throws(() => agentChatRequestSchema.parse({ message: 'x'.repeat(4001), history: [] }));
});

test('rejects history longer than the cap', () => {
  const history = Array.from({ length: 41 }, () => ({ role: 'user' as const, content: 'x' }));
  assert.throws(() => agentChatRequestSchema.parse({ message: 'hi', history }));
});

test('rejects an unknown content block type — only text/tool_use/tool_result are ever produced', () => {
  assert.throws(() =>
    agentChatRequestSchema.parse({
      message: 'hi',
      history: [{ role: 'assistant', content: [{ type: 'image', source: 'x' }] }],
    }),
  );
});

test('rejects a role outside user/assistant', () => {
  assert.throws(() =>
    agentChatRequestSchema.parse({ message: 'hi', history: [{ role: 'system', content: 'x' }] }),
  );
});

test('rejects an oversized tool_result content blob', () => {
  assert.throws(() =>
    agentChatRequestSchema.parse({
      message: 'hi',
      history: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'x'.repeat(8001) }],
        },
      ],
    }),
  );
});

test('stream event union: accepts every documented event type', () => {
  const events = [
    { type: 'started' },
    { type: 'status', message: 'Searching your inbox…' },
    { type: 'draft', threadId: 'thread-1', draftText: 'Sounds good, see you then.' },
    { type: 'done', reply: 'Done.', history: [], toolCalls: [], hitIterationCap: false },
    { type: 'error', code: 'AGENT_CHAT_FAILED', message: 'Something went wrong.' },
  ];
  for (const event of events) {
    assert.doesNotThrow(() => agentStreamEventSchema.parse(event));
  }
});

test('stream event union rejects an unrecognized type', () => {
  assert.throws(() => agentStreamEventSchema.parse({ type: 'progress', message: 'x' }));
});
