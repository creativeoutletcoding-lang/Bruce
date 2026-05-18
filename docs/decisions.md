# Bruce — Build Decisions Log

This is a living record of every significant architectural and product decision made during the Bruce build. It explains the *why* behind each choice — what was on the table, what was rejected, and what the tradeoffs were. Bruce reads this in the Dev workspace so he can reason about his own codebase with full context.

Format: entries are in reverse-chronological order by phase. Dates are from git history or CLAUDE.md where exact commit dates are available.

---

### Reminders Cron — Exclude /api/cron from Auth Middleware — 2026-05-18

**Decision:** Added `/api/cron` to the `isPublic` bypass list in `middleware.ts`. Without this, the middleware redirected unauthenticated cron requests to `/login` before the `CRON_SECRET` check in the route could run. The route's own `Authorization: Bearer` check is sufficient — no session cookie is needed or appropriate for a machine caller.

---

### Reminders Cron — Switch to Vercel Native Cron — 2026-05-18

**Decision:** Replaced the DigitalOcean/x-cron-secret cron trigger with Vercel's native cron job system. `vercel.json` now includes a `crons` block pointing `/api/cron/reminders` at `* * * * *`. The route method changed from POST to GET (Vercel cron sends GET requests) and auth changed from the `x-cron-secret` custom header to `Authorization: Bearer <CRON_SECRET>`, which Vercel injects automatically on production invocations. `CRON_SECRET` env var is unchanged. The cron logic (find due reminders, fire FCM, set notified_at) is untouched.

**Reason:** The DO droplet is not set up and won't be at this stage. Vercel native cron is zero-infrastructure and visible in the dashboard under Settings > Crons, with manual trigger support for testing.

---

### Reminders — manage_reminders Tool + Situational Context + Cron FCM — 2026-05-17

**Decision:** Added a personal reminders system. Bruce manages reminders via a single `manage_reminders` tool (actions: create, list, complete, snooze). Migration 027 adds a `reminders` table with `user_id`, `content`, `remind_at`, `completed_at`, and `notified_at`. Upcoming reminders (overdue + next 48 hours, max 10) are loaded at request time in `app/api/chat/route.ts` and injected into the system prompt as a `remindersContext` block, giving Bruce passive awareness. A protected cron endpoint at `app/api/cron/reminders/route.ts` (authenticated via `x-cron-secret` header) finds due reminders, fires FCM via `notifyUser`, and sets `notified_at`. Snooze resets `remind_at` and clears `notified_at` so the cron re-fires at the new time.

**Reason:** Jake wanted Bruce to handle "remind me to X at Y" without any extra UI or sidebar. The tool-based approach keeps everything inside the chat and aligns with how Bruce handles Calendar and Gmail. Passive awareness (reminders block in the system prompt) lets Bruce reference upcoming reminders naturally in conversation without the user having to ask.

**Out of scope (for now):** No standalone reminders UI, no sidebar section, no location-based triggers, no recurring reminders. The cron runs on the existing DigitalOcean droplet via PM2 — call `POST /api/cron/reminders` with `x-cron-secret` header on a 1-minute schedule. `CRON_SECRET` must be set in Vercel environment variables and replicated on the droplet.

**Implementation:** `lib/remindersTools.ts` (tool + executor), `lib/chat/streamHandler.ts` (TOOLS_FULL + dispatch), `lib/chat/buildSystemPrompt.ts` (remindersContext field), `app/api/chat/route.ts` (reminders query + context pass), `app/api/cron/reminders/route.ts` (cron handler), migration 027.

---

### Group Chat Awareness — Universal Multi-Member Participation Rules — 2026-05-15

**Decision:** A single `MULTI_MEMBER_PARTICIPATION_RULE` constant in `buildSystemPrompt.ts` now governs participation for every multi-member context: family group chats (`mode: "family"`) and group project chats (`mode: "project"` with more than one member). The rule explicitly prohibits: responding to incidental mentions, reacting when a member says Bruce shouldn't respond, and sending any emoji/reaction/acknowledgment token. Silence is the explicit correct default when intent is ambiguous. The previous `PARTICIPATION_RULE` (simpler, project-only) and `FAMILY_PARTICIPATION_RULE` (stricter, family-only) are replaced by this single unified constant.

**Reason:** Bruce was sending emoji reactions and brief acknowledgments when members talked to each other and mentioned him incidentally. This is worse than silence — it reads as surveillance and intrudes. The same behavioral failure is possible in group project chats, not just family chats. A single prescriptive ruleset with explicit categories (respond / stay silent / reaction rule) closes that gap across all multi-member contexts without requiring two separate rules that could drift out of sync.

The distinction between family and project contexts is retained only where it matters: tone (family: relaxed and personal; project: focused and practical), and context loaded (family memory never enters project context and vice versa — enforced at the data layer, not the prompt layer). Project mode also includes project instructions and file/member roster. These differences remain in the context block that wraps the shared rule; the participation logic itself is identical.

**Alternatives considered:** Adding a new trigger condition to the server-side `shouldBruceRespond` function. Rejected — the API-level trigger already gates most spurious calls; the issue is model-level judgment within the calls that do fire. Per-message sentiment analysis to detect member-to-member conversation. Rejected — overengineering; explicit rules are clearer and cheaper. Keeping separate rules per context. Rejected — the rules were already functionally identical and divergence between them was itself a bug surface.

**Notes:** `MULTI_MEMBER_PARTICIPATION_RULE` is used by mode `"family"` and by mode `"project"` when `memberNames.length > 1` in `buildSystemPrompt.ts`. The "Reaction and emoji rule" section explicitly closes the gap where Bruce would send a single emoji instead of full text.

---

### normalizeMessage + buildSystemPrompt — Extracted May 2026

**Decision:** Two long-standing inline duplication patterns were extracted into single shared utilities:
- `normalizeMessage()` in `lib/chat/normalizeMessage.ts` — the only place that converts a raw Supabase `messages` row or realtime payload into a typed `NormalizedMessage`. All three components (ChatWindow, FamilyChatWindow, ProjectChatView) and their server-side page loaders call it instead of repeating the same nine-field cast-and-coerce inline.
- `buildSystemPrompt()` in `lib/chat/buildSystemPrompt.ts` — the only place that assembles a Bruce system prompt. Accepts a discriminated `SystemPromptContext` with mode `"standalone" | "project" | "family" | "dev"`. All four API routes call it; none concatenate prompt strings directly anymore.

**Reason:** Before extraction, the message field-mapping pattern (with its unsafe `as` casts and nullable coercions) was duplicated across three components, each slightly different. The system prompt was assembled in three separate builder functions plus an inline dev builder, with shared constants copy-pasted between them. Both patterns were single-point-of-failure sites — a field added to the DB schema would need to be updated in 7+ places. Extraction makes the surface area for bugs one function instead of N.

**Alternatives considered:** Keeping the three separate prompt builders and adding a shared wrapper. Rejected — shared constants already existed; the problem was that routes assembled the final string (appending tool blocks, location context) themselves. The new function owns the full assembly. Per-component `normalizeRow` helpers. Rejected — same logic repeated per component; the point is a single authoritative function.

**Notes:** `NormalizedMessage`, `ChatMessage`, and `MessageAttachment` types all live in `lib/chat/types.ts`. The old per-component `FamilyMessage` interface was removed. CLAUDE.md has two enforcement rules: MESSAGE MAPPING RULE and SYSTEM PROMPT RULE.

---

### Chat UI Universal Component Rule — 2026-05-09

**Decision:** All visual rendering (bubble styling, list layout, input bar, top bar shell, dots indicators) lives in shared components under `components/chat/`. Context wrappers (ChatWindow, FamilyChatWindow, ProjectChatView) own data assembly and callbacks only — they never fork or duplicate visual logic. Context variations are handled via props, never by duplicating a component.

**Reason:** Before this rule was made explicit, visual tweaks were sometimes applied in the context wrapper (e.g., different bubble styles for family vs. project) rather than in the shared component. This led to the same visual bug existing in some contexts but not others — exactly what happened with the image-in-group-chat bug (image_url missing from the realtime payload cast). A single rendering path means a visual fix propagates everywhere automatically.

**Alternatives considered:** Per-context visual variants with shared base components. Rejected — the variants always drift. The rule is simpler and more robust: one rendering component, props decide appearance.

**Notes:** Shared components: `MessageBubble.tsx`, `MessageList.tsx`, `MessageInput.tsx`, `ChatTopBar.tsx`. The rule is in CLAUDE.md under Chat Architecture.

---

### Gmail Scope — Switched to Non-Restricted Alternatives — 2026-05-05 (approx)

**Decision:** The Gmail integration uses `gmail.readonly` (read) + `gmail.send` (send) instead of `gmail.modify`. Both are non-restricted OAuth scopes.

**Reason:** `gmail.modify` is a restricted scope requiring Google app verification (a months-long review process for production apps). `gmail.readonly` + `gmail.send` together cover the full use case (read inbox, send new messages, reply) without requiring verification. Verification is not feasible for a private household application.

**Alternatives considered:** Applying for Google workspace verification to use `gmail.modify`. Rejected — the review process requires a privacy policy, a public-facing app, and significant review time. Not appropriate for private household software. `gmail.modify` without verification (dev-only). Rejected — works only for test users added to the OAuth consent screen; does not scale to all family members without verification.

**Notes:** The scope set is defined in `lib/google/calendarTools.ts` and `lib/google/gmailTools.ts`. Archive and delete operations (which `gmail.modify` would enable) are not available; the tool set covers read, send, and label-based filtering only.

---

### Profile Color Mapping — EMAIL_COLOR_MAP with Hash Fallback — 2026-04-27 (approx)

**Decision:** Member profile colors are assigned at first login in `app/auth/callback/route.ts`. Known members are matched by Google account email via `EMAIL_COLOR_MAP` (keyed by `MEMBER_EMAIL_*` env vars). Unknown emails get a deterministic color derived by hashing the email address.

**Reason:** Each member needs a consistent color across all chat contexts for sender identification in group chats. Hardcoding colors in the source would require a code push to add a new member. Env-var-based assignment keeps the mapping configurable without a code change. The hash fallback means any unanticipated account (e.g., a guest login) gets a stable color rather than a random one.

**Alternatives considered:** Admin UI for assigning colors. Rejected — adds a UI surface for a one-time setup that env vars already handle. User self-selection. Considered — deferred; the family accepted assigned colors and the feature wasn't needed.

**Notes:** `color_hex` is stored on the `users` row and read from there at runtime. The hash function maps the email string to one of a fixed palette of accessible colors. The mapping is set once at account creation and not automatically re-evaluated on subsequent logins.

---

### Supabase Anon Key Format — @supabase/ssr Requires JWT Format — 2026-04-27 (approx)

**Decision:** The `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be the JWT-format key (beginning with `eyJ...`), not the newer `sb_publishable_*` format that Supabase now generates for new projects.

**Reason:** `@supabase/ssr` (the server-side Supabase client used for cookie-based auth) validates that the anon key is a valid JWT when creating clients on the server. The `sb_publishable_*` format is not a JWT and causes a runtime error at client construction. New Supabase projects generate `sb_publishable_*` keys by default; the JWT-format key is available separately in the Supabase dashboard under "API keys."

**Alternatives considered:** Migrating to the newer `@supabase/supabase-js` v3 client that accepts both key formats. Not yet viable — `@supabase/ssr` had not updated to support the new format at build time. Self-hosting Supabase. Rejected — operational overhead for household infrastructure.

**Notes:** This is a configuration gotcha. The env var check in the admin health route (when implemented) should validate the key format. If a future Supabase client version accepts both formats, this restriction can be relaxed.

---

### Sidebar Realtime Updates — Set-of-Callbacks Pattern in ChatShell — 2026-04-27 (approx)

**Decision:** `ChatShell.tsx` maintains a `Set<() => void>` of registered refresh callbacks. When a Supabase Realtime event fires (new message, chat update), it calls every registered callback. Individual sidebar consumers (desktop Sidebar and mobile bottom nav) register their refresh function on mount and deregister on unmount.

**Reason:** The app renders two sidebar instances simultaneously: the desktop fixed sidebar and the mobile bottom navigation bar. Both need to update their unread counts when new messages arrive. A single shared subscription that called one component's `refresh` would leave the other stale. The callback-set pattern lets any number of concurrent instances subscribe to the same event without coupling them to each other.

**Alternatives considered:** A shared global Zustand store or React context holding sidebar state. Considered — would work but adds state management overhead for what is a simple "trigger a refresh" signal. Prop drilling the refresh callback from a shared parent. Rejected — ChatShell doesn't directly control both sidebar instances; they're in separate layout subtrees. Each subscribing directly via Supabase Realtime. Rejected — double subscription for the same data, double API calls.

**Notes:** The callback set lives in a `useRef` so registration and deregistration don't trigger re-renders of ChatShell. The Realtime subscription fires `callbacks.current.forEach(fn => fn())`, where each `fn` is the component's own state-setting refresh function.

---

### Universal Tinted Bubble Style — 2026-05-12

**Decision:** All human messages (own and other members') use a consistent tinted bubble style across every chat context: private, group, project, and family. Own messages align right with a right-side accent border; other members' messages align left with a left-side accent border. Bruce's responses render as plain text with no bubble.

**Styling spec:**
- Own messages: `border-right: 2.5px solid <member-color>`, `border-radius: 10px 0 0 10px`, `background: rgba(r,g,b,0.10)`
- Other members: `border-left: 2.5px solid <member-color>`, `border-radius: 0 10px 10px 0`, `background: rgba(r,g,b,0.10)`
- Tint color is each member's `color_hex` from the database, converted via `hexToRgba(hex, 0.10)` (`lib/utils/colors.ts`)
- `maxWidth: "85%"` sits on the `messageGroup` flex container, not the bubble element — avoids the inline-block/flex-context override bug
- Bruce label ("Bruce") appears above every assistant message in all contexts, not just group chats

**Reason:** Prior implementation used `display: inline-block` on bubble elements inside a flex column, which is overridden by the flex formatting context — bubbles stretched full-width. Moving `maxWidth` to the group container fixes this cleanly. The 8-digit hex approach (`color1A`) was also rendering at ~40% opacity in some contexts; `rgba()` with an explicit alpha is more reliable. Consistent style across all contexts reduces visual surprise when switching between chat types.

**Alternatives considered:** Solid color own-message bubble (the previous approach). Rejected — jarring contrast against the lightly-styled app; the tinted style reads more cohesive. Different styles per context. Rejected — adds maintenance burden and visual inconsistency.

**Notes:** Implementation lives in `MessageBubble.tsx` (private, project, group contexts) and `FamilyChatWindow.tsx` (family context). The `hexToRgba` helper is `lib/utils/colors.ts`.

---

### Welcome Screen Redesign — 2026-05-11

**Decision:** The new-chat screen uses a vertically centered layout: time-aware greeting above a centered input box. No suggestion cards, no floating send button. The model picker ("Sonnet 4.6 ▾") sits inside the input bar as a subtle pill, and the selected model is persisted to `localStorage` and synced to `users.preferred_model` in the database.

**Reason:** The previous layout (suggestion cards + floating send button) added visual clutter without measurable benefit. Suggestion cards were unused in practice. The centered input-first layout matches the mental model of a tool you open when you have something to say, not one that's prompting you to act.

**Alternatives considered:** Keep suggestion cards as quick-access shortcuts. Rejected — they clutter the screen and become stale quickly. Separate model picker dropdown outside the input. Rejected — adds a second interactive zone; inside the input bar keeps it discoverable without dominating.

**Notes:** Model selection persists via `localStorage` key `bruce:model` for instant UI feedback, with a background PATCH to `/api/users/me` for database persistence. The welcome screen's `MessageInput` uses `containerStyle` and `modelPicker` props to customize appearance without duplicating input logic. A `.welcome-input-wrapper` CSS class scopes mobile overrides so the flat-bar `!important` rules in `globals.css` don't flatten the centered card layout.

---

### Display Name Rules and Nickname Removal — 2026-05-11

**Decision:** All chat UI labels display first name only (e.g. "Jake", "Laurianne", not "Jake Johnson"). The nickname "Loubi" was removed from all system prompt code and household context.

**Reason:** First names are how the family actually addresses each other. Full names in chat labels are formal and wasteful of space. "Loubi" was a nickname added early in the build that Laurianne does not use; leaving it in the system prompt caused Bruce to occasionally address her by the wrong name.

**Notes:** `senderName.split(" ")[0]` is applied at render time in `MessageBubble.tsx`, `FamilyChatWindow.tsx`, and `ProjectChatView.tsx`. `lib/anthropic/index.ts` `getToneInstruction` function and `LAYER_HOUSEHOLD` constant no longer reference "Loubi".

---

### Bruce Silence Rule — Strengthened 2026-05-11

**Decision:** The `PARTICIPATION_RULE` constant in `lib/anthropic/index.ts` was strengthened to explicitly prohibit any acknowledgment — including "stepping back" comments — when a message is directed at a named member who is not Bruce. The rule now reads: "stay completely silent — no acknowledgment, no stepping-back comment, no 'I'll let you two work that out.' Nothing."

**Reason:** Bruce was occasionally emitting low-stakes filler like "I'll let you two handle that" when a message was clearly between two members. This is worse than silence — it consumes attention, implies Bruce was always listening for an opening, and feels vaguely surveillance-like. Complete silence is the correct behavior.

**Notes:** The silence rule is enforced at two levels: (1) the API route only makes an Anthropic call if the trigger regex fires (`/@bruce\b/i` or direct address); (2) the system prompt instructs Bruce to stay silent even when an Anthropic call does fire (e.g., a message that mentions Bruce's name in passing but isn't directed at him).

---

### Mobile Input Polish — 2026-05-11

**Decision:** Three mobile input bugs fixed: (1) keyboard layout jump solved by adding `minHeight: 0` to the `MessageList` wrapper (allows the flex child to shrink when the keyboard opens, using `100dvh` instead of `100vh`); (2) textarea `WebkitAppearance: "none"` + explicit `borderRadius` applied to suppress iOS default styling; (3) refresh icon removed from the chat topbar (no user-facing value for a chat that updates in real time).

**Notes:** `100dvh` (dynamic viewport height) accounts for iOS's collapsible browser chrome. Without `minHeight: 0` on flex children, they resist shrinking below their content height and the layout jumps when the keyboard opens.

---

### "Continue in New Group Chat" — Deferred, 2026-05-09

**Decision:** Deferred for now. Will evaluate based on actual usage before building.

**Reason:** The use case is valid — using a private chat as a scratchpad before bringing in another member — but the complexity may not be warranted. Option B (summarize + new group chat) was selected as the right approach if built: preserves privacy, gives the new participant context without raw history, no schema changes required. The private chat becomes a referenceable artifact.

**Alternatives considered:** Convert in place with history visible from join date (clean but exposes private scratchpad feel); manual summary copy-paste (works today, zero build). Both remain valid fallbacks.

---

### RLS Privacy: Admin Access Scope — 2026-05-06

**Decision:** The `is_admin()` function may only bypass RLS on `household`, `users`, `invite_tokens`, and `pending_memory`. It was explicitly removed from all policies on `projects`, `project_members`, `chats`, `chat_members`, `messages`, and `files`. The admin memory panel (read/edit/compress another member's memory via service role) was deleted entirely.

**Reason:** The privacy guarantee is architectural, not a configuration option. No member — including the admin — should be able to see content from another member's private space. The original implementation added admin overrides as a debugging convenience that progressively leaked into more tables. Migration 016 and accompanying app-layer fixes close all of them.

**Alternatives considered:** Keeping admin read-only access to other members' chats and projects for moderation purposes. Rejected — Bruce is a household AI, not a platform. There is no moderation use case. Jake's legitimate admin needs (member management, invite tokens, household context, pending memory suggestions) do not require access to private chats or personal projects.

**Notes:** `memory` was correctly protected from the beginning (`memory_owner_only` — no admin exception). The same principle now applies uniformly to all private-space tables.

---

### Named Sessions for Bruce Dev — 2026-05-06

**Decision:** The Bruce Dev workspace stores persistent message history per named session rather than in a single global history. Sessions are created on demand, named by the user, and persist across browser refreshes. Up to 40 messages of history are injected per request.

**Reason:** Multiple concurrent debugging threads (e.g., "RLS audit" vs. "memory system design") need separate context windows. A single global history would mix contexts and degrade response quality as the session grew stale.

**Alternatives considered:** No persistence (stateless dev chat). Rejected — losing context mid-debugging session was painful in early use. Single global session. Rejected — different topics contaminate each other.

**Notes:** Sessions are stored in `admin_dev_sessions` and `admin_dev_messages` tables, accessed exclusively via service role. No RLS — these tables are admin-only infrastructure, not user data.

---

### Bruce Dev as Isolated Admin Workspace — 2026-05-05

**Decision:** Jake's technical workspace for building and debugging Bruce is a separate UI section (`/admin/dev`) with its own chat interface, its own API route (`/api/admin/dev/chat`), and a purpose-built system prompt that injects full technical context: CLAUDE.md, git state, env var status, schema summary, and Jake's personal memory.

**Reason:** The regular chat interface is for household use — Bruce answers in a warm, accessible tone. A technical debugging session needs Bruce to behave as an engineering peer with full knowledge of his own architecture. Mixing the two modes in one interface would degrade both.

**Alternatives considered:** A special mode or toggle inside the regular chat. Rejected — the system prompt assembly is fundamentally different, and the session history is separate. Using Claude.ai or another external tool for Bruce's own development. Rejected — the whole point is that Bruce can reason about himself with live access to his own codebase state.

**Notes:** The route is admin-only (`role === "admin"` check). The four-layer prompt in the dev workspace is: Identity → Household → Jake's memory → Dev framing → Env status → Git state → CLAUDE.md → Decisions log → Live schema.

---

### Four-Layer System Prompt Structure — 2026-05-05

**Decision:** All system prompts are assembled from four composable layers: (1) Identity — who Bruce is and his character constants, (2) Household — the Johnson family roster and context, (3) Member — the current user, tone calibration, timestamp, and injected memory, (4) Situational — what kind of conversation this is (standalone chat, project workspace, family group chat, dev workspace).

**Reason:** Earlier prompts were monolithic strings that duplicated household context and couldn't share components. The layered model lets all three builders (`buildSystemPrompt`, `buildProjectSystemPrompt`, `buildFamilyChatSystemPrompt`) share layers 1–3 and only differ in layer 4. Identity and Household are exported constants; Member and Situational are assembled at request time.

**Alternatives considered:** One unified prompt builder with flags. Rejected — conditional branching inside a single builder quickly becomes unreadable. Separate full prompts per context with no shared code. Rejected — household and identity context would drift out of sync.

**Notes:** The exported constants `LAYER_IDENTITY` and `LAYER_HOUSEHOLD` live in `lib/anthropic/index.ts` and are imported by the dev chat route directly.

---

### Three Separate System Prompt Builders vs One Unified Builder — 2026-05-05

**Decision:** Three distinct builders in `lib/anthropic/index.ts`: `buildSystemPrompt` (standalone chat), `buildProjectSystemPrompt` (project workspace), `buildFamilyChatSystemPrompt` (family group chat). Each is a named export called by its respective API route.

**Reason:** Each context has meaningfully different situational requirements. Project prompts include project instructions, member roster, file list, and Drive content. Family chat prompts include the three-tier judgment rule, participation rules, and the silence-by-default directive. Standalone chat needs neither. Encoding these as separate builders makes each context's requirements explicit and testable.

**Alternatives considered:** A single builder with a `context` parameter and conditional sections. Rejected — the builders differ enough in structure (not just content) that a unified builder would need deep nesting or runtime flag checks that obscure intent.

**Notes:** All three builders use the four-layer structure; only layer 4 (situational) differs.

---

### Relevance Scoring with Access-Based Increment — 2026-04-28 (refined 2026-05-05)

**Decision:** Each memory entry has a `relevance_score` (float, default 1.0, capped at 100). Every time a memory is injected into a prompt, its score is incremented by 1 and `last_accessed` is updated. Active memories are loaded in descending relevance order. There is no explicit decay function — scores only move up; memories that stop being used simply fall lower in relative ranking as other memories accumulate increments.

**Reason:** Access frequency is a reliable proxy for relevance. A memory that gets referenced across many conversations is more likely to be useful than one that was generated once and never retrieved again. Incrementing on injection (not on user confirmation) avoids a feedback loop where Bruce only reinforces what he already knows.

**Alternatives considered:** Time-decay scoring (score decreases with age). Rejected — implementation complexity, and it would archive things like dietary preferences or family facts that are permanently relevant. Explicit user-curated relevance. Rejected — too much friction for a household tool. Flat scoring with recency sort. Rejected — a recent but trivial memory would crowd out a years-old core fact.

**Notes:** The increment is fire-and-forget via service role (`Promise.all(...).then()` with no await) to avoid blocking the streaming response.

---

### Memory Generation on Chat Unmount — 2026-04-28

**Decision:** Memory extraction happens when a chat session ends (component unmount), not in real time during conversation. The route `POST /api/memory/generate` receives the final message list and generates new memory entries if warranted.

**Reason:** Running memory generation after every message would be expensive (an extra Anthropic call per turn) and generate redundant or contradictory entries from partial conversations. End-of-session generation captures the full arc of a conversation and produces higher-quality, more stable memories.

**Alternatives considered:** Real-time extraction per message. Rejected — token cost and latency. Scheduled background job scanning recent messages. Rejected — adds infrastructure complexity and delays memory availability to the next session at best.

**Notes:** Memory generation is best-effort — if the user closes the tab quickly, the unmount request may not complete. This is acceptable; the next session will catch anything missed.

---

### 500-Word Memory Budget per API Call — 2026-04-28

**Decision:** At most 500 words of memory content are injected per API call. Assembly order: core memories first (up to 20 entries), then active memories by descending relevance score (up to 15 entries). If the budget is exhausted mid-list, remaining entries are dropped for that request.

**Reason:** Token budget management. Sending the full memory database per request would be expensive and would push important conversational context below Claude's attention window. 500 words is enough to convey meaningful personal context without dominating the prompt.

**Alternatives considered:** No budget (send all memories). Rejected — unbounded cost and context pollution. Fixed entry count without word budget. Rejected — entries vary widely in length; a count limit doesn't control actual token usage.

**Notes:** Core memories always load before active, so the most stable and important facts (tier = 'core') are prioritized. The 500-word ceiling is enforced in `assembleMemoryBlock` in `lib/anthropic/index.ts`.

---

### Three-Tier Memory System (core / active / archive) — 2026-04-28

**Decision:** The `memory` table uses three tiers: `core` (always loaded, permanent facts about the person), `active` (regularly loaded, relevance-scored, compressed periodically), and `archive` (retained in database, never injected into prompts). Tier promotion/demotion happens via the admin panel and via automated compression.

**Reason:** Not all memories are equal. Knowing someone's name and job is categorically different from knowing they mentioned preferring oat milk last Tuesday. Tiering lets the system keep a large historical record without bloating the prompt. Archive retains context for search and audit without inflating active memory.

**Alternatives considered:** Two tiers (active / archive). Rejected — no way to distinguish facts that should always be present from facts that should be loaded only when relevant. Single flat list with a size limit. Rejected — loses older memories permanently rather than archiving them.

**Notes:** The `memory_owner_only` RLS policy applies to all tiers with no exceptions. No admin can read any tier of another member's memory.

---

### Project-Scoped Connectors, Not Global — 2026-04-28 (Phase 3)

**Decision:** Google Drive folders are scoped per project. Calendar and Gmail tools are available in project chats. There are no global connectors that operate across all chat contexts regardless of project membership.

**Reason:** Connectors have project-level context (instructions, members, files). A Drive file attached to CPS Operations should not be readable from a standalone personal chat. Scoping connectors to projects enforces the same privacy boundary as the rest of the data model.

**Alternatives considered:** Global connectors available in all chat types including standalone. Rejected — it would make project data visible in personal chat context, violating the privacy boundary. Per-user connectors with project inheritance. Rejected — more complex and still potentially leaks project context.

**Notes:** Calendar and Gmail tools are technically available in project chats via the tool array in the project chat route. They operate on the authenticated user's tokens regardless of project context, but only surface when Bruce is in a project chat.

---

### CLAUDE.md as Single Source of Truth for Build State — 2026-04-27

**Decision:** A single file, `CLAUDE.md`, in the repo root serves as the persistent context document for every Claude Code session. It records what Bruce is, the full tech stack, the phase status, conventions, and the active task. Every session begins with reading this file. The file is also injected into the Bruce Dev workspace prompt so Bruce can reason about his own state.

**Reason:** Without persistent context, every Claude Code session starts cold. Conventions drift, phase state becomes unclear, and decisions made in prior sessions get re-litigated. CLAUDE.md acts as shared memory between sessions.

**Alternatives considered:** Per-session briefing documents. Rejected — too easy to forget to update or share. External wiki or Notion. Rejected — requires leaving the build environment. README.md. Rejected — README is a public-facing document; CLAUDE.md is internal operational state.

**Notes:** CLAUDE.md is loaded at Vercel function startup via `readFileSync` in the dev chat route and injected into the system prompt. Credentials are masked before injection.

---

### Soft Delete with 30-Day Holding Period for Member Removal — 2026-04-27

**Decision:** When a member is deactivated, their `users` row gets `status = 'deactivated'`, `deactivated_at` is set, and `purge_at` is set 30 days later. Hard delete runs at `purge_at`. RLS excludes deactivated members from active queries immediately. Their data (chats, memory, project memberships) persists until purge.

**Reason:** Account removal in a household context needs reversibility. If someone accidentally deactivates Nana's account, there should be a recovery window. A hard-delete-on-deactivation would be irreversible and traumatic given the memory and project data involved.

**Alternatives considered:** Immediate hard delete. Rejected — no recovery path for mistakes. Indefinite soft delete with no purge. Rejected — data retention should be bounded; a 30-day window is enough to recover from any plausible mistake.

**Notes:** `purge_at` column is present in the schema; the background job to execute hard deletes at `purge_at` is planned but not yet built. In current production, deactivated accounts are simply inaccessible (status filter in RLS) but not purged automatically.

---

### Row Level Security at Database Level, Not Application Level — 2026-04-27

**Decision:** Privacy enforcement lives in Supabase RLS policies, not in application code. Every table has RLS enabled. Client-side queries use the anon key and must pass RLS. Service role is used only server-side (API routes, background jobs) and only for operations that have a legitimate need to bypass user-scoped access.

**Reason:** Application-layer access control has two failure modes: a developer forgets to add the check, or a check is bypassed by hitting a different route. Database-level RLS enforces the constraint on every query regardless of which route or client makes it. It cannot be forgotten.

**Alternatives considered:** Application middleware that checks permissions before every query. Rejected — requires discipline to maintain across every new route; any gap is a vulnerability. No access control beyond authentication (treat auth as the only gate). Rejected — in a multi-member household, every member being able to read every other member's data is a non-starter.

**Notes:** The audit of May 2026 found 14 `is_admin()` overrides on privacy-protected tables that had been added incrementally over the build. All were removed in migration 016. The principle is now enforced as policy: `is_admin()` is never added to policies on `projects`, `project_members`, `chats`, `chat_members`, `messages`, `files`, or `memory`.

---

### Supabase for Database, Auth, and Realtime — 2026-04-27

**Decision:** Supabase provides Postgres, RLS, and Realtime subscriptions in one managed service. Supabase Auth handles the OAuth exchange with Google and issues JWTs that RLS policies read via `auth.uid()`.

**Reason:** Three requirements that individually favor Supabase: (1) Postgres with RLS for privacy enforcement, (2) Realtime subscriptions for family group chat (messages appear instantly without polling), (3) Auth that integrates natively with both of the above so JWTs flow from login to RLS without custom plumbing.

**Alternatives considered:** Planetscale + custom auth + WebSockets. Rejected — three separate services with integration complexity. Firebase Firestore. Rejected — no SQL, no RLS model that maps to this use case, weaker relational guarantees. Self-hosted Postgres on DigitalOcean with custom auth. Rejected — operational overhead for what is household infrastructure.

**Notes:** Supabase Realtime is enabled on `messages`, `notifications`, `chats`, and `chat_members`. The service role client (bypasses RLS) is used only server-side in API routes and DigitalOcean jobs, and only for operations where user-scoped access is insufficient (e.g., creating a project before the owner's membership row exists).

---

### Google OAuth as Sole Authentication Method — 2026-04-27

**Decision:** The only login method is Google OAuth via Supabase Auth. There is no email/password option, no magic links, no other OAuth provider.

**Reason:** The Johnson family all use Google accounts as their primary identity. Google OAuth delegates credential management (password, 2FA, account recovery) to Google, eliminating the need to handle credentials in Bruce's codebase. Google OAuth also enables Google Drive and Calendar integration through the same token flow without requiring a separate OAuth consent.

**Alternatives considered:** Email/password. Rejected — storing credentials means building password reset, hashing, and breach response. Passkeys. Rejected — not yet widely supported across the family's devices at build time. Multiple providers (Google + Apple). Rejected — household of four, all on Google; the complexity isn't warranted.

**Notes:** Google OAuth serves dual purpose: it is the auth mechanism AND the gateway to Drive/Calendar tokens. On first login, `auth/callback/route.ts` creates the user row in the `users` table and assigns the admin role if the email matches `ADMIN_EMAIL`. Member email-to-color assignments are also resolved at first login via `MEMBER_EMAIL_*` env vars.

---

### Next.js and Vercel for Frontend and Hosting — 2026-04-27

**Decision:** Next.js 15 with the App Router for the frontend. Vercel for hosting with auto-deploy from the `main` branch on GitHub.

**Reason:** Next.js App Router provides server components (no client-side API key exposure), streaming responses via `Response` with `ReadableStream`, and file-system-based API routes — all of which are required. Vercel's GitHub integration means every push to `main` deploys automatically to `heybruce.app`. No deploy command to remember or run.

**Alternatives considered:** Remix. Considered — similar capabilities, but the team had more Next.js familiarity. SvelteKit. Rejected — less mature SSR streaming story at build time. Self-hosted Express on DigitalOcean. Rejected — Vercel's edge network, SSL, and zero-config deploys remove infrastructure overhead.

**Notes:** Deployment is always via `git push origin main`. The `vercel --prod` command is explicitly NOT used — Vercel reads from GitHub. `next.config.js` includes `outputFileTracingIncludes` to bundle `CLAUDE.md`, `docs/schema-summary.md`, and `docs/decisions.md` with the dev chat function since Vercel's file tracing doesn't follow `readFileSync` at runtime.

---

### DigitalOcean for Background Services — 2026-04-27

**Decision:** A DigitalOcean droplet running Node.js + PM2 handles all persistent background work (scheduled jobs, future morning summaries, memory maintenance). This is separate from the Vercel deployment.

**Reason:** Vercel serverless functions have a maximum execution duration and cannot run persistent processes. Background jobs like scheduled morning summaries, memory compression, and future notification batching require a long-running server.

**Alternatives considered:** Vercel Cron jobs. Considered — suitable for simple scheduled triggers, but hit-or-miss for long-running operations and can't hold open persistent connections. AWS Lambda with EventBridge. Rejected — operational overhead for what is a simple Node process. Vercel functions with external cron triggers. Kept as a fallback for simple cases but not the primary background strategy.

**Notes:** The DigitalOcean droplet runs with PM2 for process management and automatic restart. It uses the Supabase service role key directly (bypasses RLS), which is appropriate for server-side scheduled work.

---

### Firebase Cloud Messaging for Push Notifications — 2026-04-29

**Decision:** Push notifications are delivered via Firebase Cloud Messaging (FCM). The service worker (`public/sw.js`) receives push events from FCM. Each member's FCM token is stored in `users.fcm_token` and refreshed on login.

**Reason:** FCM is the standard cross-platform push notification infrastructure (iOS, Android, web) with a generous free tier. The alternative — web-only Web Push — does not work on iOS Safari without additional complexity, and the household includes iOS devices.

**Alternatives considered:** Web Push directly (no FCM). Rejected — iOS support requires FCM or APNs directly. APNs directly. Rejected — Apple-only; the household uses multiple platforms. OneSignal. Rejected — third party that stores notification content; privacy concern for a household system.

**Notes:** Notification delivery runs from the DigitalOcean droplet using the Firebase Admin SDK. The `user_presence` table tracks which chat each member currently has open to suppress notifications for messages they're already seeing. The `notifications` table logs all notifications with `read` boolean and `read_at` timestamp.

---

### Cross-Context Routing — Cut from Spec

**Decision:** The planned feature allowing a family group chat thread to pull in and display content from a member's private project (e.g., "Bruce, share my CPS update with the group") was cut before implementation.

**Reason:** Cross-context routing would require Bruce to act as a bridge between private and shared spaces — deciding what content from a private project is appropriate to surface in the family chat. This creates an implicit content exposure path that is hard to reason about and impossible to RLS-enforce cleanly. The privacy model is cleaner without it.

**Alternatives considered:** Explicit "share this to family chat" action in project context. Considered — but still requires a data model for cross-context references and UI for managing what has been shared. Deferred without a clear implementation path.

**Notes:** If this feature is revisited, the correct implementation would be an explicit user action with a dedicated `shared_project_items` table and its own RLS policy, not routing through the family chat message pipeline.

---

### Morning Summary — Deferred to Post-Production

**Decision:** Automated morning summaries (daily briefing sent to each member at their preferred time) are deferred until after Bruce is in live household use.

**Reason:** Summary quality depends on understanding what kinds of information each member actually wants surfaced. Building the feature before there is real usage data risks delivering summaries that feel generic or intrusive. The infrastructure (DigitalOcean + PM2 + FCM + `morning_summary_time` per user) is already in place.

**Alternatives considered:** Build summaries immediately based on anticipated preferences. Rejected — premature optimization of content. Ship with a simple fixed-format summary for all members. Rejected — the family members have very different contexts (Jake/work, Laurianne/home, Jocelynn/school, Nana/simple updates); a one-size summary would be low value for most.

**Notes:** `users.morning_summary_time` (default `'08:00'`) is already in the schema. The background job slot on DigitalOcean is reserved. The feature is ready to be built once there is enough live usage to inform what to summarize.

---

### Pause Toggle — Removed

**Decision:** A UI toggle to pause Bruce's participation in group chats was designed and then removed. Bruce's silence is now the default — he only responds when explicitly addressed.

**Reason:** A pause toggle implies Bruce is "on" by default and needs to be turned off. The correct mental model is the reverse: Bruce is always listening but never speaks unless spoken to. The trigger model (`@bruce` or direct address) achieves silence-by-default architecturally. A toggle adds UI complexity and confusion about state ("is Bruce paused right now?") without adding anything the trigger model doesn't already provide.

**Alternatives considered:** Keeping the toggle as an opt-in mute. Rejected — the three-tier rule and trigger model make it redundant. Per-member pause settings. Rejected — if someone doesn't want Bruce to respond, they simply don't address him.

**Notes:** The `/@bruce\b/i` trigger regex (case-insensitive, word boundary) is defined in the family chat API route. No engagement window — if nobody addresses Bruce, no Anthropic API call is made. This is enforced in code, not via a database toggle.

---

## Current UI Rendering Reference

*This section describes the current rendered state of the UI as of 2026-05-12. Bruce reads this to reason accurately about how messages appear to users.*

### Message bubbles

All human messages (every chat context: private, project, group, family) use a tinted bubble:
- **Own messages** — right-aligned, `border-right: 2.5px solid <member-color>`, `border-radius: 10px 0 0 10px`, background is `rgba(r,g,b,0.10)` of the member's profile color
- **Other members' messages** — left-aligned, `border-left: 2.5px solid <member-color>`, `border-radius: 0 10px 10px 0`, same 10% opacity tint
- **Bruce's responses** — no bubble; plain text rendered directly, full-width, with a small "Bruce" label above each response in every chat context

Sender label (first name only) appears above the first message in a run from a given sender. Own messages show the member's name in `var(--text-tertiary)`; other members' labels are colored with their profile color.

### Welcome / new-chat screen

Vertically centered layout: time-aware greeting (`Good morning/afternoon/evening, [first name]`) above a centered `MessageInput`. Model picker ("Sonnet 4.6 ▾" or whichever model is selected) sits inside the input bar as a small pill. No suggestion cards. The selected model is persisted in `localStorage` and synced to `users.preferred_model`.

### Display names

All UI labels use first name only. The household system prompt uses: Jake, Laurianne, Jocelynn (Joce), Nana. "Loubi" is not a recognized nickname and does not appear anywhere in the codebase or prompts.

### Group chat silence

Bruce does not respond to member-to-member messages. When a message names or is directed at a specific member who is not Bruce, Bruce produces nothing — no acknowledgment, no filler. Bruce only responds when directly addressed by name, a direct question, or an unambiguous request for input. This behavior is enforced at both the API route level (trigger regex gate) and the system prompt level.
