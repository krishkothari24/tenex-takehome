# Agentic Chat Layer — Inbox Concierge

**This is a separate track from `docs/BUILD_GUIDE.md`'s phases, not one of them.** It has its own scope discipline (see §3) and should be built once the core app (dashboard, classification, bucket board) is solid — this file assumes that's already true, and doesn't get folded into the numbered phase list in `BUILD_GUIDE.md`.

---

## 1. What this is and why it exists

A chat panel added alongside the existing dashboard + bucket board, backed by a real multi-step **agent** — not a single LLM call — that can search the user's already-classified inbox, pull detail on a specific thread, and draft (never send) a reply.

**Why this is worth building:** the core Inbox Concierge app is a classification *pipeline*. It's excellent at what it does, but it doesn't, by default, demonstrate multi-turn tool-use, autonomous decision-making, or handling ambiguity mid-task — which are explicitly things Tenex evaluates ("agent reliability and failure modes," "how errors compound in autonomous workflows"). This closes that gap directly instead of working around it.

**Example interactions this should handle:**
- "What's my most urgent unread thing today?"
- "Find emails from Sarah about the contract"
- "Draft a reply to John declining tomorrow's meeting"
- "Summarize what's in my Newsletter bucket this week"

---

## 2. Where this sits in the existing architecture

This is an **addition**, not a redesign. It reuses everything already built:
- Reads from the **same Postgres data** the classification pipeline already populated — no new data source.
- Runs as a **new route** on the existing Fastify server (e.g., `POST /api/agent/chat`, streamed via SSE like the classification results already are).
- Rendered as a **new panel in the existing React app**, alongside the dashboard and bucket board — not a replacement for either.
- Uses the **same Anthropic API key and SDK** already configured for classification. No new provider, no new auth.

---

## 3. Scope discipline (read this before building anything)

This is the single most important section in this file.
- **Read-only and draft-only. No send capability, ever.** The app's entire security posture is built on `gmail.readonly`. Do not request a broader OAuth scope (`gmail.compose`, `gmail.send`) to make this feature "more impressive." Drafting text in the UI for the user to review and copy themselves is the correct, defensible design — state this as a deliberate trade-off on camera, not an apology.
- **This does not replace the eval harness or rate-limit handling requirements from the core build.** Same rigor bar applies here — see §7.

---

## 4. The agent harness (the loop, concretely)

This is a real agent loop, not a single prompt-and-response:

```
User message arrives
   │
   ▼
Claude receives: conversation history + tool menu + system prompt
   │
   ▼
Claude either:
   (a) answers directly (no tool needed), OR
   (b) emits a tool call request
   │
   ▼ (if b)
Server executes the real tool (query Postgres, etc.) — Claude never touches the DB directly
   │
   ▼
Tool result appended to conversation, sent back to Claude
   │
   ▼
Claude either asks for another tool, or produces a final answer
   │
   ▼
Repeat until Claude returns a final answer (cap at ~5 tool calls per turn — see §7)
```

Implementation: Anthropic Messages API with `tools` defined (tool-use / function calling), looped server-side. This is the same "model asks, code executes, result feeds back" pattern from the rest of this project's architecture — just applied at the chat layer instead of the classification layer.

---

## 5. Tool definitions

Keep the tool set deliberately small — three tools, each with a narrow, clear job. A bigger tool surface increases the chance of the model picking the wrong one or overlapping tools' scopes (the "double-claiming" problem), which is a real failure mode worth avoiding here just like in the classification pipeline.

### 5.1 `search_emails`
Searches the **already-classified, already-synced** email data in Postgres. No live Gmail call — fast, free, no extra API cost.

```ts
{
  name: "search_emails",
  description: "Search the user's classified inbox by keyword, sender, bucket, or date range. Returns matching emails with subject, sender, snippet, bucket, and thread id.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keyword search across subject and snippet" },
      bucket: { type: "string", description: "Filter to a specific bucket, e.g. 'Important'" },
      sender: { type: "string", description: "Filter by sender name or email" },
      unread_only: { type: "boolean" },
      limit: { type: "integer", default: 10 }
    }
  }
}
```

### 5.2 `get_thread_detail`
Pulls fuller content for one specific thread — used when the snippet isn't enough to answer or draft from.

```ts
{
  name: "get_thread_detail",
  description: "Get the full content of a specific email thread by id, for drafting a reply or answering a detailed question.",
  input_schema: {
    type: "object",
    properties: {
      thread_id: { type: "string" }
    },
    required: ["thread_id"]
  }
}
```

### 5.3 `draft_reply`
Produces a draft — returned to the UI, never sent. This is the tool that gives the "wow" without the risk.

```ts
{
  name: "draft_reply",
  description: "Draft a reply to a specific email thread based on the user's stated intent. Returns draft text for the user to review — this tool never sends anything.",
  input_schema: {
    type: "object",
    properties: {
      thread_id: { type: "string" },
      intent: { type: "string", description: "What the user wants the reply to say, e.g. 'decline politely, suggest next week'" }
    },
    required: ["thread_id", "intent"]
  }
}
```

**Enforce this in code, not just in the description:** the `draft_reply` handler must have no code path that calls Gmail's send endpoint. This should be true even if the model somehow asked it to send — the tool physically cannot do it. Same "models emit intent, code enforces the boundary" principle as the rest of this project.

---

## 6. Ambiguity handling (this is where your real depth shows)

This is the same class of problem as resolving "the Marriott building" in a property search — a reference that could match more than one real thing.

**The "three Johns" problem:** if `search_emails(sender: "John")` returns multiple distinct people, the agent must **ask which one**, not silently pick the most recent or most frequent. Enforce this via the system prompt *and* verify it in testing — don't just hope the model does the right thing:

> "If a search returns matches from more than one distinct sender that could reasonably be who the user meant, ask a clarifying question before proceeding. Do not guess."

**Grounding requirement — answers must cite what the tool actually returned.** If the agent says "you have 3 urgent unread emails," those 3 must be traceable to an actual `search_emails` result, not free-associated from the conversation. This is your evidence-gate pattern again: the agent's claims about the inbox must be backed by real tool output, the same way your classification pipeline's justifications must be backed by real evidence in the email text.

**No result found → say so.** If `search_emails` returns nothing, the agent must say the inbox has nothing matching, not fabricate a plausible-sounding email. This is the single most important behavior to verify before demoing.

---

## 7. Production-quality requirements (same bar as the classification pipeline)

Don't let this feature get a pass on rigor just because it's a separate track — a reviewer reading the code won't distinguish "core" from "added later" when judging quality.

- **Cap tool-call loops.** Hard limit on iterations per user turn (e.g., 5). If the agent hasn't produced a final answer by then, return a graceful "I wasn't able to fully answer that" rather than looping indefinitely — this is directly your "no stop condition" failure mode from earlier in this whole conversation, now made concrete.
- **Rate-limit handling.** Same backoff/retry discipline as the classification pipeline (§5.8 of `BUILD_GUIDE.md`) applies to every Claude call this feature makes.
- **Tool execution errors handled gracefully.** A DB query failure inside `search_emails` should return a clear error the agent can relay ("I couldn't search right now"), not crash the chat session.
- **Streaming.** Stream the agent's response and any intermediate "searching your inbox…" / "drafting a reply…" status via SSE, consistent with the rest of the app's UX, so the user isn't staring at a blank panel during multi-step tool use.
- **Log tool calls server-side** (which tool, what arguments, what it returned) — useful for debugging, and a nice "I have tracing on my agent's actions" detail to mention on camera.
- **Add real entries to `docs/CORRECTIONS_LOG.md`** for anything caught while building this, same as everywhere else in the project.

---

## 8. UI integration

- A chat panel, not a replacement for the dashboard/bucket board — accessible via a toggle or a persistent side panel.
- Show tool activity transparently: a small "searching inbox…" / "reading thread…" indicator while a tool call is in flight, so the agentic behavior is *visible*, not hidden behind a spinner. This is good UX and also makes the multi-step nature of the agent legible in the demo.
- Draft replies render in a clearly-labeled draft card with a copy button — visually distinct from a "sent" state, reinforcing that nothing was actually sent.

---

## 9. Build checklist

1. Define the three tool schemas + the agent loop (server-side, no UI yet). Test with a script/curl, not the UI first.
2. Verify grounding and ambiguity handling with deliberately tricky test queries (a sender name that matches multiple people; a query with no matches) before writing any frontend.
3. Add the chat panel UI, wire to the streaming endpoint.
4. Add tool-call visibility (the "searching…" indicators).
5. Stress-test the exact queries you intend to demo, several times, for consistency.
6. Only then: consider this demo-ready.

---

## 10. One line for the video, if you build this

*"On top of the classification pipeline, I added a real agentic layer — the chat can search the inbox, pull thread detail, and draft replies, using the same tool-calling pattern as the rest of the system: the model can only ask, the code decides what's actually allowed to happen — which is why it can draft a reply but structurally cannot send one."*
