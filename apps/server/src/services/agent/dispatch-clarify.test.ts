import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { dispatchToolCall } from './loop.js';
import { ASK_CLARIFYING_QUESTION_TOOL_NAME } from './tools.js';

// dispatchToolCall's ask_clarifying_question branch does no DB/API call — pure validation plus a
// tool_result acknowledgement — so it's unit-tested directly here, same "construct the real
// tool_use shape rather than mock the network" convention as decide.test.ts. The real inbox this
// app was tested against has no genuine two-distinct-people-same-first-name case (verified via
// scripts/agent-dev.ts live queries), so this is how the mechanism itself gets deterministic
// coverage independent of what happens to be in any given inbox.

function toolUseCall(id: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name: ASK_CLARIFYING_QUESTION_TOOL_NAME, input } as Anthropic.ToolUseBlock;
}

test('a well-formed ask_clarifying_question call produces a clarify uiEvent and an acknowledging tool_result', async () => {
  const call = toolUseCall('call_1', {
    question: 'Which John did you mean?',
    options: ['John Smith <js@example.com>', 'John Doe <jd@example.com>'],
  });
  const outcome = await dispatchToolCall(call, 'user-1', ['Important']);

  assert.equal(outcome.uiEvent?.type, 'clarify');
  if (outcome.uiEvent?.type === 'clarify') {
    assert.equal(outcome.uiEvent.question, 'Which John did you mean?');
    assert.deepEqual(outcome.uiEvent.options, ['John Smith <js@example.com>', 'John Doe <jd@example.com>']);
  }

  assert.equal(outcome.toolResultBlock.tool_use_id, 'call_1');
  assert.equal(outcome.toolResultBlock.is_error, undefined);
  assert.deepEqual(JSON.parse(outcome.toolResultBlock.content as string), { presented: true });
});

test('fewer than 2 options is rejected as a tool_result error, not a crash — the turn keeps going', async () => {
  const call = toolUseCall('call_2', { question: 'Which one?', options: ['only one'] });
  const outcome = await dispatchToolCall(call, 'user-1', []);

  assert.equal(outcome.uiEvent, undefined);
  assert.equal(outcome.toolResultBlock.is_error, true);
});

test('more than 6 options is rejected the same way (bounds the client-resent history payload)', async () => {
  const call = toolUseCall('call_3', { question: 'Which one?', options: Array.from({ length: 7 }, (_, i) => `Option ${i}`) });
  const outcome = await dispatchToolCall(call, 'user-1', []);

  assert.equal(outcome.uiEvent, undefined);
  assert.equal(outcome.toolResultBlock.is_error, true);
});

test('an empty question is rejected', async () => {
  const call = toolUseCall('call_4', { question: '', options: ['a', 'b'] });
  const outcome = await dispatchToolCall(call, 'user-1', []);

  assert.equal(outcome.uiEvent, undefined);
  assert.equal(outcome.toolResultBlock.is_error, true);
});

test('an unrecognized tool name never crashes the loop', async () => {
  const call = { type: 'tool_use', id: 'call_5', name: 'not_a_real_tool', input: {} } as Anthropic.ToolUseBlock;
  const outcome = await dispatchToolCall(call, 'user-1', []);

  assert.equal(outcome.toolResultBlock.is_error, true);
  assert.equal(outcome.uiEvent, undefined);
});
