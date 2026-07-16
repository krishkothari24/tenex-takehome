import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { decideNextStep } from './loop.js';

/** Constructs a plain Message-shaped object directly rather than mocking the network call — same
 *  convention as ../classifier/anthropic.test.ts constructing a real Anthropic.APIError. Only the
 *  fields decideNextStep reads (`stop_reason`, `content`) are populated. */
function makeMessage(stopReason: Anthropic.StopReason, content: Anthropic.ContentBlock[]): Anthropic.Message {
  return { stop_reason: stopReason, content } as Anthropic.Message;
}

function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null };
}

function toolUseBlock(id: string, name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock;
}

test('end_turn extracts and joins text blocks, trimmed', () => {
  const message = makeMessage('end_turn', [textBlock('  Here is the answer.  ')]);
  const step = decideNextStep(message);
  assert.deepEqual(step, { type: 'end_turn', text: 'Here is the answer.' });
});

test('end_turn with multiple text blocks joins them with a newline', () => {
  const message = makeMessage('end_turn', [textBlock('Part one.'), textBlock('Part two.')]);
  const step = decideNextStep(message);
  assert.deepEqual(step, { type: 'end_turn', text: 'Part one.\nPart two.' });
});

test('tool_use extracts a single tool_use block', () => {
  const call = toolUseBlock('call_1', 'search_emails', { keyword: 'contract' });
  const message = makeMessage('tool_use', [call]);
  const step = decideNextStep(message);
  assert.equal(step.type, 'tool_use');
  if (step.type === 'tool_use') {
    assert.equal(step.calls.length, 1);
    assert.equal(step.calls[0]!.id, 'call_1');
  }
});

test('tool_use extracts multiple tool_use blocks (parallel tool calls)', () => {
  const calls = [
    toolUseBlock('call_1', 'search_emails', { keyword: 'a' }),
    toolUseBlock('call_2', 'search_emails', { keyword: 'b' }),
  ];
  const message = makeMessage('tool_use', calls);
  const step = decideNextStep(message);
  assert.equal(step.type, 'tool_use');
  if (step.type === 'tool_use') {
    assert.equal(step.calls.length, 2);
  }
});

test('tool_use stop_reason with no actual tool_use blocks is unrecognized, not a crash', () => {
  const message = makeMessage('tool_use', []);
  const step = decideNextStep(message);
  assert.deepEqual(step, { type: 'unrecognized' });
});

test('max_tokens stop_reason is a graceful unrecognized stop, not a crash', () => {
  const message = makeMessage('max_tokens', [textBlock('cut off mid-')]);
  const step = decideNextStep(message);
  assert.deepEqual(step, { type: 'unrecognized' });
});
