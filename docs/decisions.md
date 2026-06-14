# Bruce — Build Decisions Log

This is a living record of every significant architectural and product decision made during the Bruce build. It explains the *why* behind each choice — what was on the table, what was rejected, and what the tradeoffs were. Bruce reads this in the Dev workspace so he can reason about his own codebase with full context.

Format: entries are in reverse-chronological order by phase. Dates are from git history or CLAUDE.md where exact commit dates are available.

---

### iOS photo attach — confirmed working on-device; debug instrumentation removed — 2026-06-14

Jake confirmed photo attach works in the iOS shell after the Filesystem byte-read fix. The temporary `[attach-debug]` `console.log`s added across the two prior sessions were removed (pure cleanup, no behavioral change, ships via `git push`): all logs in `lib/native/camera.ts` (incl. emptying the now-bare `catch` clauses back to `catch {}`), the `ingestFiles` log in `MessageInput.tsx`, and the upload-path logs in `ChatWindow.handleSend` (restored to the original silent `catch`). The `source: "web" | "native"` parameter on `ingestFiles` existed **only** to label those logs — it was removed along with the two native call sites that passed `"native"`, since both already converge on the same path regardless. `npx tsc --noEmit` clean, `npm test` green (41/41), grep `[attach-debug]` returns zero. The attach logic itself (Filesystem byte-read, `toJpegFile`, `ingestFiles`, upload) is untouched.

---

### iOS photo attach — read picked-photo bytes via Filesystem, not fetch — 2026-06-14

**Symptom (on-device, after the HEIC fix shipped).** Picking a photo in the iOS shell still failed. The picker returned a JPEG at `capacitor://localhost/_capacitor_file_/…/tmp/photo-N.jpg`, but `pickPhotosNative` read it with `fetch(p.webPath)`, which WKWebView blocks: *"Fetch API cannot load capacitor://… due to access control checks."* The bytes never reached `ingestFiles`, so the photo never attached.

**Root cause.** `fetch()` against a `capacitor://`/`file://` URL is blocked by WKWebView's access-control policy. The previous build's `pickPhotosNative` depended on exactly that. (`takePhotoNative` was unaffected — it uses `resultType: Base64` and never fetches.)

**Fix (NATIVE — needs Xcode rebuild).** Read the bytes across the Capacitor bridge instead: added **`@capacitor/filesystem`** (`8.1.2`, pinned to the v8 line) and rewrote `pickPhotosNative` to `Filesystem.readFile({ path: p.path ?? p.webPath })` → base64 → `File` via the existing `base64ToFile`. We prefer `GalleryPhoto.path` (documented as the "full, platform-specific file URL that can be read later using the Filesystem API") and fall back to `webPath`. The resulting File feeds the unchanged `toJpegFile()` → `ingestFiles()` flow — one path, no parallel upload logic, desktop untouched. `ReadFileResult.data` is a string on native (Blob only on web); a `blobToBase64` helper covers the web-Blob case for type-safety.

**HEIC finding (kept, not removed — Jake's call).** On iOS the picker reports `format: "jpeg"` for picked photos (`photo-N.jpg`), so HEIC does **not** appear to reach this code in practice — JPEG sails through `toJpegFile`'s non-HEIC passthrough. The HEIC→JPEG re-encode from the prior session is retained as a belt-and-suspenders guard (e.g. future plugin behavior changes); it's a cheap no-op for JPEGs.

**Deploy category — NATIVE.** `@capacitor/filesystem` is a new native plugin. Ran `npx cap sync ios` (registers it in `Package.swift` + `FilesystemPlugin` in `capacitor.config.json` `packageClassList` for auto-registration). **This requires an Xcode rebuild + reinstall to the device — `git push` alone will NOT make it work** (the JS calls a native binary that isn't in the installed shell yet). No Info.plist change needed (filesystem access of a returned path needs no usage string).

**Instrumentation.** Kept all prior `[attach-debug]` logs; added `pickPhotosNative byte-read` logging the chosen path, read method, and resulting blob type + size to confirm bytes cross the bridge.

---

### iOS photo attach — normalize HEIC to JPEG at the native acquisition layer — 2026-06-14

**Symptom.** Attaching a photo worked on desktop web but silently failed in the iOS Capacitor shell — the file never reached the chat.

**Root cause.** iPhones shoot HEIC/HEIF by default. The Photos tile in the iOS shell uses `@capacitor/camera` `Camera.pickImages` (`lib/native/camera.ts` → `pickPhotosNative`), which returns the *original* gallery asset; fetching its `webPath` yields a blob with `type: "image/heic"`. The shared convergence function `ingestFiles` (`MessageInput.tsx`) hard-rejects `image/heic`/`image/heif` (and Anthropic vision can't read HEIC anyway), so the picked photo was dropped before upload. The "one path" design was already correct — both web `<input>` and native pickers converge on `ingestFiles` — the only problem was the *format* of the bytes the native layer produced.

**Fix (JS/web-only — ships via `git push`).** Added `toJpegFile()` in `lib/native/camera.ts`: any HEIC/HEIF File acquired by `takePhotoNative`/`pickPhotosNative` is re-encoded to JPEG via an offscreen `<img>` + canvas (`toBlob("image/jpeg", 0.92)`) before leaving the module. WKWebView decodes HEIC in `<img>` natively, so no new dependency (no `heic2any`). Non-HEIC images pass through untouched; on decode failure the original File is returned so `ingestFiles`' guard can still surface a clean error. The desktop path (`<input>` → `handleFileChange` → `ingestFiles`) and the `ingestFiles` HEIC guard itself are byte-for-byte unchanged — iOS converges onto the existing path with valid JPEG bytes rather than the path being loosened.

**Rejected alternatives.** (1) Relaxing the `ingestFiles` HEIC guard — would let HEIC through to Anthropic, which can't read it, and would change desktop behavior. (2) Adding `heic2any` — unnecessary; WKWebView already decodes HEIC, and a new dep would bloat the bundle for one platform. (3) A native Swift conversion plugin — would force an Xcode rebuild for a problem solvable in JS.

**Info.plist.** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` were all already present — no native change required.

**Instrumentation (temporary).** `[attach-debug]`-tagged `console.log`s were added at selection (`camera.ts`), before processing (`ingestFiles`, with web/native source), and around the `/api/files/upload` call (`ChatWindow.handleSend` — response/error logged in full). These are explicitly temporary, to be removed once Jake confirms the fix on-device; grep `[attach-debug]` to find them all.

---

### Remove phantom static "family group" chat scaffolding from the sidebar — 2026-06-14

**Context.** The old static/pinned singular "family group" chat (`chats.type='family_group'` — "the one permanent household group chat readable by all users") was removed previously; no such row exists. "Family" is now only a **title** carried by live group chats (`type='family_thread'`). The prior global-context-menu build had added a `family_group` kind + a Delete-only carve-out + a 🏠 "Family Chat" sidebar row built around that phantom.

**Safety finding (the thing that made this safe).** Live family group chats are `family_thread` → context-menu `kind="thread"`; standalone → `chat`; projects → `project`. The `family_group` kind mapped **exclusively** to the singular phantom row — **no live chat routed through it**, so removing it broke nothing and there was nothing to re-map. The phantom was already inert at runtime: `app/family/page.tsx` redirects to `/chat` when no `family_group` row exists, and the sidebar row only rendered `{familyGroup && …}`.

**Removed (UI scaffolding only, all in `Sidebar.tsx`):** the `family_group` `ContextMenuKind`, the `FamilyGroupInfo` type + `familyGroup` state + its consumption from `/api/family/threads` (keeps live `threads`), `isFamilyActive`, the `handleSingleDelete` `family_group` branch, the singular 🏠 "Family Chat" row + its styles, the Rename Delete-only carve-out (Rename is now unconditional), and the redundant `.neq("type","family_group")` filter on the standalone-chats query. Result: every real item (standalone chats, family-titled group chats, projects) gets Rename + Delete; group chats are user-renameable like any chat. **Zero `family_group`/"Family Chat" refs remain in `Sidebar.tsx`.**

**Preserved entirely:** all group-chat / family-thread logic — silent-by-default, @mention/natural triggers, three-tier act/flag/ask, reactions, routing, `/api/family/chat` engagement gate, `FamilyChatWindow`, family mode. Only `Sidebar.tsx` changed.

**Intentionally KEPT + reported (NOT deleted — guardrail: report when unsure; no memory/RLS/routing changes):** the deeper `family_group` backend surface — `app/family/page.tsx` (self-inerts), `/api/family/threads` (serves live threads, returns a now-null `familyGroup`), `/api/chats` type filter, cron deep-link, `app/api/memory/generate` classification (memory logic), `lib/types` `ChatType` union, and the DB CHECK value + RLS `family_group_chat_select` policy + migrations 006/007/016. A full backend/DB teardown would need a dedicated migration + coordinated multi-file change across memory/routing — recommended as a separate deliberate step, not folded into this UI cleanup.

---

### Global sidebar context-menu (Rename + Delete) across all item types — 2026-06-14

**Goal.** One context-menu (right-click desktop / long-press mobile) with **Rename + Delete** on every sidebar item — standalone chats, family threads, the family group, and projects — replacing the old patchwork (family had a Delete-only menu; projects had no custom menu and leaked the native browser menu + iOS text-selection callout).

**No shared row component — shared *mechanism* instead.** The four item types render as divergent inline `<button>`s in `Sidebar.tsx` (~2600 lines); there is no common row component, and extracting one would be a large, risky refactor. What's already centralized is the menu machinery: one `ContextMenuState`, one set of handlers (`handleItemRightClick` / `handleItemLongPressStart/End/Move`), one portal-rendered menu, one rename flow, one delete flow. "Global" was achieved by widening the `kind` discriminator (`chat | thread | family_group | project`) and attaching the existing shared handlers to the **project** row (the only one not wired in) — one code path, per-type variation via `kind`, no forked menus.

**Rename: reused + extended (not rebuilt).** Rename already existed for standalone chats (modal + `chats.update({title})`, RLS via the user client, optimistic + rollback). Extended to: **family threads** (also `chats.title`) and **projects** (`projects.name` via the existing owner-gated `PATCH /api/projects/[id]` — RLS-safe, no admin bypass). Kept the existing **modal** rather than building inline-edit: the modal already handles Enter/Escape/save/rollback, so reuse beat a riskier inline-edit across four divergent row markups. **The family group stays Delete-only** — it's a singular system chat with a hardcoded "Family Chat" label (no surfaced title); renaming it is semantically odd and wouldn't reflect. (Easy to enable later: surface a title on `FamilyGroupInfo` and render it.)

**Delete.** Reuses the existing single-delete path; projects route through `/api/projects` DELETE (FK cascade removes their chats), every chat-type row through `/api/chats` DELETE — same single-item flow, routes away if the deleted item was active.

**Native-menu / iOS-selector suppression — scoped to rows only.** Right-click is suppressed by `e.preventDefault()` in the shared handler (now also on project rows — that was the leak). The iOS long-press callout is killed via a new `.sidebar-row` class (added to all four row buttons) under `@media (pointer: coarse)` (`user-select/-webkit-touch-callout: none`). Scoped to rows — message bubbles already had their own rule; the composer and the sidebar search inputs stay selectable/editable.

**Bulk-edit coexistence (no conflict).** Bulk multi-select is entered by an explicit **"Edit" button** per section header; long-press/right-click open the single-item context menu. The handlers guard `if (inSelectMode(kind)) return;`, so while a section is in select mode its rows don't open the menu. Long-press never triggers bulk-select. Resolution: **long-press = single-item menu; Edit button = bulk-edit.** Added the `projectsSelectMode` guard so projects follow the same rule.

---

### Docked draft chip tap-focus fix (`hit-target` containing block) — 2026-06-14

**Bug.** After docking the draft "filed to project" chip inside the composer, tapping the input to type unfiled the draft (fired `onClearProject`) instead of focusing the textarea.

**Root cause.** Not a misplaced handler (the `onClick` was on the ✕ button only) and not a focus side-effect. The ✕ uses `className="hit-target"`, whose rule is `.hit-target::after { position: absolute; inset: -8px }` — an invisible tap-extender that sizes against the nearest **positioned** ancestor. `draftChipClear` had **no `position`**, and none of its ancestors (`draftChip`/`draftChipRow`/`box`/`container`) are positioned, so the `::after`'s containing block fell back to the **viewport** and the overlay blanketed the whole composer, intercepting every tap on the textarea → unfile. The other `hit-target` close buttons (`thumbnailClose`, `pastedChipClose`) don't hit this because they're `position: absolute` (already their own containing block). A Playwright check reproduced it precisely: on the unfixed code the textarea click times out (pointer intercepted by the overlay); on the fix it focuses and keeps the chip.

**Fix (presentation only).** Add `position: relative` to `draftChipClear` so the `::after` is confined to ±8px around the 16px button, plus a 4px `marginBottom` on `draftChipRow` so the downward 8px extension can't overlap the textarea's top edge. `onClearProject` logic is unchanged — only what triggers it. **Lesson:** any `hit-target` element must establish its own positioning context (`position: relative`/`absolute`), or its ±8px overlay escapes to the nearest positioned ancestor (worst case the viewport) and hijacks unrelated taps.

---

### Project draft chip relocation + emoji sweep + Files direct picker — 2026-06-14

**Draft chip.** The new-chat "filed to project" chip (shown before the first message) moved from a standalone pill **below** the composer to a compact chip **docked inside** the composer box (`MessageInput`), top-left above the input row, via a new `draftProject?: {name, onClear}` prop. No emoji, secondary styling; ✕ still calls the existing unfile handler (`onClearProject`) unchanged. Home-indicator clearance is inherited from the composer container's safe-area padding. `WelcomeScreen` is the only caller; it dropped its external pill + `FolderIcon`.

**Emoji sweep (completes the earlier removal).** The prior bottom-sheet redesign removed the per-project emoji only from the `InputPlusMenu` Add-to-project sub-sheet. This sweep finishes the job at the remaining render sites — **render-only, no data change** (the DB `projects.icon` is untouched): project home header (`ProjectHome`), project chat top bar (`ProjectTopBar`, dropped `titleIcon`), and the welcome-screen Add-to-project picker (`ProjectPickerList`, used by `ProjectAssignSelector`). The now-unused `projectIcon` prop was removed cleanly down its cascade (ProjectHome, ProjectTopBar, ProjectChatView, both `app/projects/...` pages) to keep lint green. Sidebar lists and the TopBar breadcrumb already rendered name-only. (File-type `📁` glyphs in `ProjectHome`/`ProjectRightPanel` are Drive file-type icons, not project emoji — left alone.)

**Files tile → iOS document picker directly (no native plugin).** The Files tile showed WKWebView's unified Photo Library/Take Photo/Choose File sheet because its `accept` included `image/*` — when images are acceptable, iOS adds the camera/library options and shows the chooser. Fix is a **one-line, web-only** change: the Files path (`openFilePicker` non-`imagesOnly` branch) now sets `accept=".pdf,.txt,.md,.csv"` (no `image/*`), so iOS opens the document picker directly. No `isNative()` branch, no native file-picker plugin — **reversing the earlier idea** to add `@capawesome/capacitor-file-picker`: images on iOS go through the native Photos tile, so dropping `image/*` from Files loses nothing, and Bruce's real documents live in Google Docs (the local Files loader is occasional). Camera/Photos native paths and `handleFileChange`/`ingestFiles` guards are untouched. Ships via `git push` — no rebuild.

---

### Remote-URL shell: verifying native-picker web code → merge-to-main, not preview — 2026-06-14

**The gotcha.** The iOS shell is a **remote-URL WKWebView** (`server.url = https://heybruce.app`), so it always runs the **deployed `main`** web bundle — never a branch. The native-picker fix had two halves shipping by different channels: the **native binary** half (Info.plist strings + `@capacitor/camera`) reached the device via the Xcode rebuild, but the **web** half (`isNative()` tile routing + `lib/native/camera.ts`, which actually *calls* the native pickers) ships only via `git push` → Vercel. While that web half sat on the branch, the device kept running `main`'s plain web `<input>` path. So the first device test was a **false positive**: "Camera works" was the new `NSCameraUsageDescription` letting the *web* `capture` input reach the camera without crashing — not native `getPhoto` firing. Photos/Files showing the WKWebView unified sheet was just `main`'s web inputs.

**Preview-URL path (P2) attempted, then abandoned.** The intended fix was to point `server.url` at the branch's Vercel **preview** deployment to device-verify before merge. Blocked: the preview sits behind **Vercel deployment protection**, so the phone's WKWebView hit a login wall it can't clear. (The preview URL must never be committed regardless.)

**Resolution: merge to `main` and verify on production.** Deliberate, given the change is **additive and low-risk** — the web/desktop `openFilePicker` + `handleFileChange` path is byte-for-byte unchanged (verified by diff vs `main`), the native path is purely additive behind `isNative()`, and the TCC crash fix already shipped in the binary. Any residual issue is **fix-forward** with no rollback risk to the existing web experience. No new Xcode rebuild was needed to verify — the binary already carries the plugin; reopening the production shell pulls the new web bundle.

**Scope of this shortcut.** Merging-then-verifying-on-prod is acceptable **only** for shell-only, additive, behind-`isNative()` changes like this. It is **NOT** the pattern for RLS/auth/payments/core-data changes — those must be verified before they touch `main`. For a remote-URL shell, the clean way to device-test branch web code remains a preview URL **with deployment protection disabled (or a bypass token)**, or a local/dev `server.url`.

---

### iOS `+` menu attach tiles → native pickers (Option B) — 2026-06-14

**Problem.** On the physical iPhone (Capacitor shell), the redesigned `+` sheet's attach tiles failed: the **Camera** tile crashed the app to the home screen, and **Photos** + **Files** both opened the same default WKWebView file sheet with no differentiation. Desktop web was fine — iOS-webview-specific.

**Root causes.** (1) `ios/App/App/Info.plist` had **none** of `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`; touching the camera without the usage string is a hard iOS TCC abort. (2) A single web `<input type=file>` fundamentally cannot produce three *distinct* native pickers on iOS — WKWebView always shows its own unified sheet and ignores fine `accept`/`capture` differentiation on a reused element.

**Stopgap rejected.** A pure git-push stopgap (remove `capture`, hide the Camera tile) cannot be crash-*proof*: WKWebView's own file sheet still offers "Take Photo" whenever images are acceptable, which crashes identically without the plist strings. Since the plist strings are mandatory either way — and that already forces an Xcode rebuild — we implemented real native pickers rather than downgrading the crash to latent.

**Option B (chosen).**
- **Info.plist:** added all three usage strings (this alone makes even the WKWebView "Take Photo" path crash-safe). Verified present in the compiled `.app` bundle.
- **Plugin:** added `@capacitor/camera@^8` (SPM, no Podfile); `npx cap sync ios` registered `CAPCameraPlugin` in `capacitor.config.json`'s `packageClassList` (auto-registered — no `MainViewController` change; that hook is only for the custom app-target `OAuthPlugin`).
- **`isNative()` branch** (`MessageInput.tsx`): Camera → `Camera.getPhoto({ source: Camera, resultType: Base64 })` (single); **Photos → `Camera.pickImages()` (multi-select**, mirroring the web input's `multiple`); **Files stays on the web `<input>` everywhere** (WKWebView handles documents fine). Web/desktop (`isNative()` false) keeps the exact `openFilePicker` accept/capture mutation path — `openFilePicker` and the web `<input>` are unchanged.
- **Convergence at `processFile`** (the critical rule): native acquisition (`lib/native/camera.ts`) returns browser `File` objects (base64→File for camera; `webPath`→Blob→File for the gallery), and both the web and native paths funnel through one extracted `ingestFiles(files)` → the **same** HEIC/size guards + `processFile` resize before `onFilesAttach`. Branch only on how bytes are acquired, never on how they're processed — a photo attaches identically on desktop and iOS. (HEIC: the guard rejects it just as on desktop; in practice the plugin usually hands back JPEG, so no raw HEIC ever reaches a message either way.)

**Rebuild note.** Native deps changed (plugin + Info.plist + SPM), so this required **one Xcode rebuild + device reinstall** and must be **device-verified** (camera/photos/files + HEIC + large-image guards on glass) before merge. Subsequent web tweaks still ship via `git push` — only native-capability changes need a rebuild.

---

### "+" ("Add to chat") menu → Claude-iOS-style bottom sheet — 2026-06-13

**What changed.** The composer's `+` menu (`components/chat/InputPlusMenu.tsx`) was restyled from a two-item popover/sheet (Attach file · Move to project) into a single Claude-iOS-style bottom sheet: grab handle, top-left `X` (or `‹` back on the sub-page), centered title, a 3-tile attach row (Camera · Photos · Files), a grouped `›`-row card ("Add to project"), and an in-place "Add to project" sub-page (back chevron, search field, scrollable project list).

**One sheet for all viewports.** The old desktop popover + flyout branch was removed — desktop and mobile now use the same bottom sheet (one code path, web + iOS identical, ships via `git push`). Per-context variation is still props-only: `MessageInput` renders the sheet wherever attaching is available and passes `moveToProject` only where add-to-project is eligible, so the "Add to project" row simply doesn't appear in project/family chats. Consequence: contexts that previously showed a one-tap paperclip now open the sheet.

**Native `UIMenu` rejected.** Considered a native Swift `UIMenu`/action-sheet plugin for the `+` to get true iOS chrome. Rejected: it would fork the menu into a web path + a native path, break the "ships via `git push`" model (every change would need an Xcode rebuild), and duplicate the project-list/avatar/search logic. The sheet is pure web — one component, both platforms.

**Haptics: reuse `lightHaptic()`, defer `@capacitor/haptics`.** Sheet open and tile/row taps fire the existing `lib/utils/haptics.ts` `lightHaptic()` (web `navigator.vibrate`), consistent with the rest of the composer. We did **not** add `@capacitor/haptics`: it pulls a native dependency and needs an Xcode rebuild, whereas the menu must ship via push. Real iOS hardware haptics (the Vibration API is a no-op in WKWebView) remain a deferred, isolated enhancement (plugin + one rebuild).

**Three tiles, one input.** Bruce has a single attach pipeline, not separate camera/photos/files handlers. The three tiles don't add handlers — `MessageInput.openFilePicker()` retargets the one hidden `<input>` by setting `accept`/`capture` before `.click()` (Camera → `capture=environment` + `image/*`; Photos → `image/*`; Files → the original `.pdf,.txt,.md,.csv,image/*`). The attach handler (`handleFileChange`) and pipeline are unchanged.

**Per-project emoji removed from this sub-sheet only (render-only).** The Add-to-project list no longer draws the leading project emoji/icon; names sit at the card's standard left inset and member-avatar pips are kept. The emoji/icon data is untouched in the DB, and the shared `ProjectPickerList` (still used with emoji by `ProjectAssignSelector` on the welcome screen) is unchanged — the sub-sheet renders its own rows and reuses only the exported `ProjectMemberPips`. Added `created_at` to `GET /api/projects/movable` + `MovableProject` to power the relative "x ago" per row (the only data addition).

---

### Model config refactor + effort levels — 2026-06-13

**Single source of truth.** `lib/models.ts` now holds `ModelConfig` entries (`id`, `displayName`, `supportsEffort`, `effortLevels`, `defaultEffort`, `thinkingAlwaysOn`) plus helpers (`getModel`, `resolveModel`, `isValidModelId`, `validEffortForModel`). Lineup updated to **Opus 4.8, Opus 4.7, Sonnet 4.6 (default), Haiku 4.5** — Opus 4.6 dropped, Fable 5 deliberately excluded for now.

**Stale-ID bug fixed (pre-existing).** `preferred_model` was persisted unvalidated and read with a null-only fallback, so a removed id (e.g. someone still on `claude-opus-4-6`) would be sent raw to Anthropic and 400. Now `/api/users/me` whitelists it (`isValidModelId`) and every route clamps via `resolveModel()` → `DEFAULT_MODEL`.

**Effort.** Confirmed against live docs: effort is top-level `output_config: { effort }` (no beta header, no `thinking` param — these models use adaptive thinking; manual `thinking:{enabled}` 400s on Opus 4.8/4.7). Per-model support: Opus 4.8/4.7 = low|medium|high|xhigh|max; Sonnet 4.6 = low|medium|high|max (no xhigh); **Haiku 4.5 = unsupported**. New global `users.preferred_effort` (migration 036, null = model default; Sonnet default `medium` per docs' chat recommendation). `streamHandler` injects effort only when `validEffortForModel` returns non-null — never an unsupported level. Picker + settings show an effort selector when the model supports it.

**System-task routes pinned.** Family chat, Bruce Dev workspace, and the instructions summarizer use a `SYSTEM_TASK_MODEL` constant instead of bare `"claude-sonnet-4-6"` literals (no behavior change, no magic strings).

**Desktop model picker fixed (RESOLVED 2026-06-13).** Pre-existing bug: the `@media (pointer: fine)` rule made the picker a `position:absolute` downward dropdown that was clipped by the composer's `overflow:hidden` ancestors and rendered off-screen (worked on mobile only because the bottom sheet is `position:fixed`). Fixed by rendering a `position:fixed` upward popover anchored to the trigger rect on desktop (branched in JS via `matchMedia`), which escapes the overflow clipping. Verified working on desktop + mobile.

---

### Native keyboard/display polish + app icon — 2026-06-13

**Keyboard.** Settled on `KeyboardResize.None` driven by `keyboardWillShow`/`WillHide` rather than `KeyboardResize.Native`. On-device diagnostics confirmed Native *did* resize the frame correctly, but the resize landed a beat after the keyboard started sliding (start-lag). Driving `--app-height`/`--kb-safe-bottom` from `keyboardWillShow` (fires at slide start, reports `keyboardHeight`) makes the input lead the keyboard. Also: hid the iOS accessory bar; `useVisualViewportLock` early-returns on native (web keeps the visual-viewport hack); a `bruce:keyboardshow` event re-pins `MessageList` to the latest message (the visualViewport autoscroll doesn't fire reliably under None).

**Composer redesign (Claude-style).** One rounded container, vertical stack: full-width textarea on top, control row below (`+` and model picker left, send right). Fixes the old breakage where inline controls disrupted text flow, and moves the model switcher into the control row. Bottom-anchored so it rides up with the keyboard. Applied to web + native (better everywhere).

**Display.** Status bar overlays the inset header, style follows `prefers-color-scheme`. Splash is solid `#111111` hidden on first paint (`NativeSplashGate`), and `LaunchScreen.storyboard` is a solid `#111111` view — eliminates the white→logo→black launch flash.

**App icon.** Gold B on teal, single-1024 universal config. The source PNG had transparent corners; iOS rejects alpha, so it was flattened to an opaque teal square (corners filled with the dominant teal `#087058`) — iOS applies its own rounded mask.

---

### OAuth spike COMPLETE — native iOS shell merged to main — 2026-06-13

**Spike outcome.** Native iOS shell Google OAuth is proven **end-to-end on a physical device, against production**, and merged to main. This was the gate (§3 of `docs/capacitor-plan.md`); the rest of the shell build is now unblocked. Covers both Supabase Auth login and the Calendar/Gmail/Drive connector grants — they are the same OAuth flow in this codebase.

**ASWebAuthenticationSession, not SFSafariViewController / `@capacitor/browser`.** The first iteration opened the consent screen in an SFSafariViewController (`@capacitor/browser`) and caught the callback as a Universal Link via `@capacitor/app` `appUrlOpen`. It failed: **iOS does not route a Universal Link back to the app that presented the SFVC.** `ASWebAuthenticationSession` intercepts the callback URL internally before iOS processes it, so it returns the URL straight to JS — no `appUrlOpen` needed. `@capacitor/browser` was removed.

**`OAuthPlugin` is a custom local Swift plugin.** `ios/App/App/OAuthPlugin.swift` exposes `openForCallback({url})` and drives `ASWebAuthenticationSession`. It is registered via `CAPBridgedPlugin` conformance + `registerPluginInstance` in `MainViewController.capacitorDidLoad()` — because **Capacitor 8 + SPM no longer auto-discovers app-target plugins** through the legacy ObjC `CAP_PLUGIN` macro. (As a local plugin it does not appear in `cap sync`'s npm-plugin list; that is expected.)

**Associated Domains needs BOTH services.** `applinks:heybruce.app` (Universal Link callback routing) AND `webcredentials:heybruce.app` (the ASWebAuthenticationSession HTTPS callback validation). The AASA file (`public/.well-known/apple-app-site-association`) therefore carries both an `applinks` key and a `webcredentials` key. Apple team prefix / appID: `3ZL5564832.app.heybruce.shell`.

**Apple's CDN caches the AASA (~6h TTL).** `app-site-association.cdn-apple.com` is what validates webcredentials on-device, and it served a stale (webcredentials-less) copy during testing. The `?mode=developer` entitlement suffix on `webcredentials:` + Settings → Developer → Associated Domains Development forces `swcd` to fetch the AASA from our origin, bypassing the stale CDN. It **only works on a developer device and MUST be stripped before production** — done; the entitlement is plain `webcredentials:heybruce.app` and the refreshed CDN validates it.

**Capacitor 8 toolchain.** Requires Xcode 16+/Swift 6/macOS Sonoma+. Shell development now happens on the **new Mac (macOS 26.5 / Xcode 26.5)**. The Capacitor 6 pin was a temporary downgrade for the old Mac and is no longer used.

**Local branch-testing pattern.** To test branch code on device (since `server.url` points at production), temporarily set `capacitor.config.ts` `server.url` to the branch's Vercel preview URL + `npx cap copy ios`, then **revert to `https://heybruce.app` before committing**. Disable Vercel deployment protection on that preview so the webview can load it. The Universal Link / AASA still validates against production `heybruce.app` regardless of which URL the webview content loads from.

---

### Build phases retired + native iOS shell approved — 2026-06-11

**Build phases retired.** The phase-numbered structure (Phase 1–6) is removed from CLAUDE.md and will not be used going forward. Bruce is in continuous refinement; there is no concept of a phase boundary or "phase complete" milestone.

**Native iOS shell approved.** The Capacitor remote-URL model is approved and sequenced (see `docs/capacitor-plan.md`). This wraps the existing web app in a native WKWebView pointed at `https://heybruce.app` — it is not a rewrite, not a parallel version, and not a new codebase. One codebase. iPhones get the native shell; desktop remains browser-based and is first-class.

**Full-native rewrite explicitly rejected.** A SwiftUI or React Native rewrite was considered and rejected. Reasons: it would destroy deploy velocity (every change needs a native build + App Store cycle), abandon the desktop-first experience, and rebuild a working product for parity rather than adding new capability. The remote-URL shell gives 95% of the native wins (keyboard, push, biometric) at 5% of the cost.

**Shell sequencing.** Work proceeds in this order:
1. Finish web loose ends: FCM iPhone verification, morning summary cron, calendar write path.
2. Google OAuth spike (§3 of capacitor-plan.md) — system browser + deep-link PKCE for both Supabase login and connector token grants. This is the gate; nothing else in the shell build can proceed until it is proven out.
3. Shell build: keyboard resize mode + kill accessory bar, native push wired to existing `user_fcm_tokens` + `notifyUser()`, biometric gate, `lib/native/` adapter.
4. Native-only features: share sheet, notification actions, home-screen widget.
5. Distribution: TestFlight during stabilization; Unlisted App Store as the permanent household distribution channel (avoids 90-day TestFlight expiry, sidesteps App Store review for a private app).

---

### Shared inline browser (BrowserPanel) — 2026-06-09

**What it is.** A browser that Bruce and household members drive *together* inside any chat. Bruce navigates/clicks/extracts server-side; humans watch the same session move live and can take the wheel at any moment. One Browserbase session is shared by both sides — Bruce's actions and the human's clicks land in the same browser, and each side sees the other's effect on the next render.

**Browserbase + Stagehand over self-hosted Playwright.** A self-hosted headless Chrome would mean running and scaling browser processes on the DigitalOcean droplet, building our own live-streaming transport (CDP screencast → websocket → canvas), and solving the X-Frame-Options problem ourselves (target sites refuse to be iframed). Browserbase gives us a managed browser per session plus a **Live View** iframe served from the Browserbase domain, which sidesteps X-Frame-Options entirely and renders an interactive (not just pixels) view the human can click into. We use `debuggerFullscreenUrl` for the clean full-bleed embed. `keepAlive: true` so the session survives the gaps between Bruce's actions while a member reads the page.

**Stagehand v3 for Bruce's control.** Stagehand wraps the session with natural-language `act()` / `extract()` on top of low-level `page.goto`/`screenshot`. The non-obvious requirement: Bruce must connect to the **existing** Browserbase session by id (`browserbaseSessionID` in the V3 constructor), never create his own — that is the entire trick that keeps Bruce and the human in one shared browser. v3 API differs from v2: `act(instruction)` (string, not `{action}`), `extract(instruction, schema)` (positional), and there is no `stagehand.page` — the page comes from `stagehand.context.activePage()`. `stagehand.close()` only tears down the CDP connection; the Browserbase session persists.

**One session per chat, keyed in Postgres.** `browser_sessions` (migration 033) holds the single active row per `chat_id`. `current_url` is updated on every action and the table is on the realtime publication, so each member's address bar syncs via Supabase Realtime — the same mechanism reactions use. RLS mirrors chat visibility (owner or `chat_members`).

**Panel opens from the stream, not a separate channel.** Rather than invent a new SSE protocol, the `browse_page` tool emits a `\x1eBROWSER_EVENT:{…}\x1e` sentinel in the existing byte stream (same family as `STATUS`/`TASK_PROGRESS`). `parseStreamFrame` surfaces the latest one as `tick.browserEvent`; all three chat contexts feed it to the shared `useBrowserPanel` hook. The panel therefore opens the instant Bruce starts working, before his summary text arrives.

**Shared-module discipline.** Per the CHAT UI/LOGIC rules, the panel state machine lives in `hooks/useBrowserPanel.ts`, the panel UI in `components/browser/BrowserPanel.tsx`, and the responsive split (50/50 desktop grid, full-screen mobile overlay) in `components/browser/BrowserSplitLayout.tsx`. The three wrappers (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`) each only wire the hook, feed `applyBrowserEvent`, pass globe props to `MessageInput`, and wrap their return — no forked layout or logic.

**System prompt.** Followed the route-injected context pattern (`locationContext`/`remindersContext`) rather than making `buildSystemPrompt` async: routes call `getBrowserContextBlock(chatId)` and pass `browserContext`. The base "you have a browse_page tool" text is always present via `BROWSER_SYSTEM_BLOCK` in `buildToolSystemBlocks`; the active-session note (current URL) is added only when a live session exists.

**Incognito.** The panel is unavailable in incognito chats — the globe button is hidden (`onBrowserClick` omitted) and the tool returns an error if invoked with a null `chatId` (incognito never persists a chat row to key a session to).

---

### Bidirectional reactions + Bruce emoji awareness — 2026-06-04

**Part 1 — Full bidirectional reactions.** Removed the `msg.role === "assistant" &&` gate from `onReact` in `MessageList.tsx` (line previously read "members only react to Bruce"). `onReact` is now passed to every bubble regardless of role. The API endpoint (`/api/messages/[id]/reaction`) was already role-agnostic. `handleReact` in `useChatReactions.ts` was already role-agnostic. Reaction display (`reactions={reactionsMap?.[msg.id]}`) was already role-agnostic. Only the action gate needed removal.

**Reaction pip position (confirmed correct):** For own right-aligned bubbles (`isUser=true`), `ReactionRow` uses `justifyContent: "flex-start"` — placing icons at the left edge of the msg-group, which is the top-left corner of the bubble space. `borderRadius: "10px 0 0 10px"` gives these bubbles a rounded top-left corner, so the pip sits at the correct anchor point. No change needed.

**MessageContextMenu — ❤️ added.** The mobile long-press menu now has both 👍 (Like/Remove) and ❤️ (Love/Remove), each toggled independently via `ReactionEntry.hasCurrentUser`. Both use design-token active states (`color-mix(in srgb, var(--accent) 10%, transparent)` background, `var(--accent)` label color). Menu height estimate updated to 136px with reactions.

**Part 2 — Bruce emoji awareness.** `react_to_message` tool schema updated: `type: { enum: ["thumbs_up"] }` replaced with `emoji: { enum: ["👍", "❤️"] }`. `executeReactionTool` now accepts an `emoji` parameter and maps it to the DB `type` field via `emojiToType()` ("👍" → "thumbs_up", "❤️" → "heart"). `streamHandler.ts` now passes `input.emoji` (defaulting to "👍") to the handler. `REACTION_SYSTEM_BLOCK` and `MULTI_MEMBER_PARTICIPATION_RULE` both updated with: "Use 👍 to acknowledge, confirm, or agree. Use ❤️ when a message is warm, personal, or emotionally significant — a kind gesture, a family moment, something shared. Do not use ❤️ for task confirmations or neutral exchanges."

---

### Mobile long-press context menu for messages — 2026-06-04

Replaced the conflict between the old mobile long-press reaction hint and native iOS text selection with a unified `MessageContextMenu` component. The old mechanism (touch-based long-press timer in `handleSwipeTouchStart` → floating emoji picker portal) is removed entirely.

**Architecture:** Long-press detection is now pointer-event based (`onPointerDown / onPointerMove / onPointerUp / onPointerCancel`) on the content row div, gated by `isTouchDevice = window.matchMedia("(pointer: coarse)").matches`. A 500ms timer starts on `pointerdown`; movement >10px cancels it. When the timer fires, `getBoundingClientRect()` on the `msgGroupRef` provides an anchor for the menu. The swipe-to-delete gesture remains on `onTouchStart/Move/End/Cancel` — the two systems share the `longPressTimer` ref (touchend/cancel still cancel it as belt-and-suspenders).

**Menu (`MessageContextMenu.tsx`):** Portal to `document.body`. Contains 👍 Like / Remove (toggle, reads `ReactionEntry.hasCurrentUser`) and Copy (strips markdown via `stripMarkdown()` before writing to clipboard). Backdrop div (`z-index: 9998`) at full-screen below the menu (`z-index: 9999`) dismisses on `pointerDown`. Menu is positioned above the bubble when there is room (anchor.top > menuHeight + 24), below otherwise. `onReact` still only flows to assistant messages — the gate is unchanged (CLAUDE.md: "members only react to Bruce"). Copy is available on all bubble types.

**Desktop unchanged:** `handleContextMenu` checks `isTouchDevice` and returns early on touch devices. Desktop right-click menu (👍, ❤️, Delete) is completely unaffected.

**CSS:** `.message-bubble { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }` added under `@media (pointer: coarse)` in `globals.css`. No effect on desktop/mouse devices.

---

### Three UI fixes — streaming status bar, mobile scroll, model picker — 2026-06-03

**Fix 1 — Unified streaming status bar.** Replaced two separate streaming indicators (a top status strip in `MessageList` and a 3-dot animated bubble in `MessageBubble`) with a single `StreamingStatusBar` component anchored below the scroll area. The bar has four states in priority order: idle (null), thinking (pulsed status text), task card (in-progress `TaskCard`), gone (unmount when streaming ends). During streaming, task-card and empty messages are skipped from the list (`return null` in the map) so the bar is the sole live view. Completed task messages reappear in the list normally after streaming ends. The `pulse` keyframe from `globals.css` drives the opacity animation — no new keyframe needed. `liveTaskProgress` and `isStreamingNow` are derived inside `MessageList` from the existing `messages` array; no new props propagated to context wrappers.

**Fix 2 — Mobile scroll jump on input focus.** Root cause was the scroll container missing `overscroll-behavior: contain`. The existing `visualViewport.resize` handler (calls `scrollToBottom("instant")` when viewport height decreases) was already correct and not re-added. Fixed by adding `overscrollBehavior: "contain"` to `styles.container` in `MessageList`. Scroll button moved inside a new `scrollArea` wrapper div so its `position: absolute; bottom: 16px` is measured from the scroll area edge rather than the full `MessageList` height, preventing overlap with `StreamingStatusBar`.

**Fix 3 — Model picker pill compresses input text.** The `modelPicker` ReactNode was rendered inside the `inputRow` flex container in `MessageInput`, taking horizontal space and compressing the textarea. Moved it to its own `msg-input-picker-row` div rendered below the input row. Left-aligned on desktop, centered on mobile via a CSS media query in `globals.css`. Active chats where `modelPicker` is null are unaffected — the picker row renders conditionally.

---

### Fix React hydration error #418 — ProjectAssignSelector not rendering — 2026-06-02

Two hydration mismatches were causing React error #418. When React 18 detects a hydration mismatch it tears down and re-renders the affected subtree; if this recovery render fires before the `useEffect` that fetches projects resolves, `movableProjects` is still `[]` and `showProjectSelector` stays `false` — so the pill never appears in the re-rendered tree, even though the API returns data correctly.

**Fix 1 — `WelcomeScreen` greeting:** `getGreeting()` calls `new Date().getHours()`, which is UTC on Vercel's servers but local time in the browser. For Jake in CDT (UTC-5) at 8am, the server emits "Good afternoon" while the client renders "Good morning" — mismatch. Fix: initialize `greeting` state as `"Hi, ${firstName}"` (safe stable value, same on server and client), then update to the time-of-day greeting in a `useEffect` after mount.

**Fix 2 — `NewChatOrchestrator` model state:** The `useState` lazy initializer read `localStorage.getItem("bruce:model")`, which is unavailable on the server (`typeof window === "undefined"`), so the server always produced `DEFAULT_MODEL`. On the client, the lazy initializer re-runs and may return a different stored model — another mismatch. Fix: initialize `model` state with `DEFAULT_MODEL` unconditionally, then sync from `localStorage` in a `useEffect`.

Both fixes are minimal (no refactors). `tsc --noEmit` clean.

---

### CPS instructions, reaction mapping, "Thinking…" status, new-chat project assignment — 2026-06-02

Four changes in one session.

**1. CPS project instructions (migration 032, data update).** Appended two sections to the CPS project (`c0c4dcb3-…`) instructions: `## OUTPUT 2: SAASANT CSV` (the 8-column QBO/SaaSant import spec — two rows per sitter, Contract Labor positive + Workers' Comp negative, BillNo pattern, Spencer→Julia Stafford substitution) and `## VERIFICATION SUMMARY RULE` (read totals back from the just-written sheet via the Sheets API before summarizing; flag mismatches). Delivered as a numbered migration file with idempotent `NOT LIKE` guards — applied manually in the Supabase SQL editor (repo convention; not executed by the agent).

**2. Reaction → bubble mapping.** `MessageList` rendered reactions with `msg.role === "assistant" ? reactionsMap?.[msg.id] : undefined` — coupling the display to role on top of the id match. Changed to `reactionsMap?.[msg.id]` so reactions render purely on the message whose `id === reactions.message_id`, regardless of role. This makes Bruce's `react_to_message` 👍 show on the member's message (previously dropped) and keeps member 👍 on Bruce's message. The react *action* (`onReact`) stays gated to assistant messages — members react to Bruce only. (If the reported "on the human bubble" symptom is instead purely visual overlap, that's a separate `MessageBubble` placement tweak — flagged.)

**3. "Thinking…" status before web search.** A ~10s pre-search window showed only frozen dots. `streamHandler` now runs a status lifecycle via `\x1eSTATUS:text\x1e` sentinels (`parseStreamFrame` now takes the *last* sentinel, empty payload clears): a 1.5s timer emits "Thinking…" if nothing has streamed; the native web-search `server_tool_use` block switches to "Searching the web…"; the first text token clears it. `firstTextSeen` is response-wide so "Thinking…" only appears before the first text token of the whole reply — fast replies never flash it, and it never re-appears mid-reply. The browse/history/document tool statuses now also clear on the next text token (set `statusShown`). The thinking timer is cleared after each turn's `finalMessage` and in the catch, so a late fire can never enqueue onto a closed controller.

**4. Assign a new chat to a project at creation.** Mirrors move-to-project for not-yet-created chats. The welcome screen shows a subtle `ProjectAssignSelector` ("+ Add to project" → the shared `ProjectPickerList`; collapses to a dismissible pill) — only with ≥1 project membership and not incognito. `NewChatOrchestrator` holds the selection and passes `projectId` to `POST /api/chat`, which validates membership (user-client RLS) before creating the chat with `project_id` set (the insert uses the service role, so membership is checked explicitly). The topbar shows the `[Project] / [Chat]` breadcrumb immediately, and after the first turn it navigates to `/projects/[id]/chat/[chatId]`. The selector is reused, not duplicated; an invalid/non-member `projectId` falls back to a standalone chat rather than erroring mid-send.

**Verified:** `tsc --noEmit`, ESLint, full `next build` — all clean. No schema changes (032 is a data update).

---

### Provider swaps — Perplexity→Anthropic web search, Replicate→fal.ai images + attach regression fix — 2026-06-01

**Three changes in one session.**

**1. Attach regression fix.** The move-to-project feature had replaced the one-tap paperclip with a "+" menu in *every* chat context, making attach two taps everywhere. `MessageInput` now branches: when a `moveToProject` config is passed (the existing eligibility — standalone private, owned, not yet moved), it renders the shared `InputPlusMenu`; otherwise it renders the original one-tap paperclip button directly. Eligibility is not re-derived — it's still just "did ChatWindow pass `moveToProject`?".

**2. Web search: Perplexity → Anthropic native (clean cut).** Removed all Perplexity code (`webSearch()` and the custom `SEARCH_TOOL`), the `PERPLEXITY_API_KEY` references, and UI copy. Web search is now the Anthropic native **server tool** `{ type: "web_search_20260209", name: "web_search" }` (`WEB_SEARCH_TOOL` in `lib/searchTools.ts`), added to `TOOLS_FULL` on every request. Anthropic runs the search server-side and returns `server_tool_use` + `web_search_tool_result` blocks within the same turn, so there is no client-side dispatch for `web_search` (only `browse_url`/`search_chat_history` remain client-executed). `streamHandler` detects the `server_tool_use` content-block-start to emit the existing "Searching the web…" status (already provider-neutral). **Verified live against the API**: the `web_search_20260209` tool is accepted and returns search results + citations within the turn.

**3. Image generation: Replicate → fal.ai (clean cut).** Removed all Replicate code (the predict/poll/download loop) and `REPLICATE_API_TOKEN`. New single module `lib/image/generateImage.ts` wraps the fal.ai client (`fal.subscribe`) — `generateImage({ prompt, model?, imageSize? }) → { url }`, default `fal-ai/flux/dev`, hd → `fal-ai/flux-pro/v1.1`, clean error handling with a user-facing fallback message. `lib/images/generate.ts` (`generateImageAndSave`) now calls it then persists to Drive + DB as before. fal.ai has no cold start or polling — one request returns the image. Requires `FAL_KEY` (`npm i @fal-ai/client`).

**SDK upgrade.** Native web search required upgrading `@anthropic-ai/sdk` 0.39.0 → 0.100.1 so the streaming accumulator handles the new server-tool block types. The codebase only uses stable SDK APIs (`messages.create/stream`, `Anthropic.Messages.*` types) — the upgrade produced **zero** type errors.

**Clean-cut rationale.** No fallbacks, no env toggles, no dual-provider branching. A provider abstraction layer would be dead weight for a single-household app with one provider each; the direct integration is simpler to reason about and there is no migration window to straddle.

**Admin usage.** Cost-tracking labels/keys were renamed off the old providers: `cost_breakdown.replicate`→`images` (fal.ai, ~$0.025/image) and `cost_breakdown.perplexity`→`web_search` (Anthropic, ~$0.01/search). The `web_searches` metric still reads `metadata.web_search_used`, which `streamHandler` still sets.

**MANUAL FOLLOW-UP (Vercel dashboard):** remove `PERPLEXITY_API_KEY` and `REPLICATE_API_TOKEN` from the Vercel project environment, and add `FAL_KEY`. The two old keys were removed from `.env.local`; `FAL_KEY=` was added there (fill in the value locally to test image generation). No schema/migration changes.

---

### Move to project — input "+" menu + breadcrumb topbar — 2026-06-01

**Feature:** Standalone private chats can be moved into a project from the input bar, mirroring Claude.ai's "+" menu + breadcrumb pattern.

**Backend:** `PATCH /api/chats/[id]/move` ({ projectId }) validates (all via RLS, no service role): chat is visible to the requester, owned by them, standalone (`project_id IS NULL`, else 409), and type `private`; and that the requester is a member of the target project (`project_members` own-row RLS). Executes `UPDATE chats SET project_id` and returns the row plus `project_name`/`project_icon`. `GET /api/projects/movable` returns the user's active member projects with member pips — project visibility is RLS-gated, but member *profiles* are resolved with the service role because `users_select_own` only returns the requester's own row (same pattern as the project page).

**Input "+" menu:** The paperclip attach button was replaced by a shared `InputPlusMenu` (the "+") rendered by `MessageInput` in **every** chat context — one component, props decide contents. It always offers "Attach file"; "Move to project" appears only when `MessageInput` is given a `moveToProject` config. Desktop opens an inline flyout to the side; mobile opens a second-level bottom sheet (bigger touch targets, not a nested flyout). Both render the shared `ProjectPickerList`. When the user belongs to no projects, the entry is shown disabled and relabeled "No projects available".

**Topbar:** `TopBar` gained a `projectName` prop; when set it renders a non-interactive `[Project] / [Chat]` breadcrumb (muted project crumb + normal chat crumb). Not a dropdown — extendable later.

**Eligibility + optimistic update:** `app/chat/[id]/page.tsx` computes `canMoveToProject = type === 'private' && owner === viewer` and passes it to `ChatWindow`, which also requires `!incognito && !alreadyMoved`. On a successful move `ChatWindow` sets a local `projectContext` (topbar breadcrumb appears, the menu entry disappears — no navigation/reload) and calls `refreshChats()` so the sidebar drops the chat from the standalone list (the chats query filters `project_id IS NULL`; the chats realtime subscription would also catch it).

**Decisions:** (1) The "+" menu replaces the one-tap paperclip in *all* contexts, not just eligible ones — consistency with the Claude.ai pattern and the "shared, not duplicated" rule, at the cost of attach becoming a two-tap action everywhere. (2) Move is gated entirely by RLS rather than service role, keeping the privacy wall at the database. (3) No confirmation step — moving is reversible and the user is the sole member of a standalone chat. (4) The post-move chat stays on `/chat/[id]` for the session; a reload redirects to the canonical `/projects/[id]/chat/[id]` (existing behavior). (5) No schema/migration changes.

**Verified:** `tsc --noEmit`, ESLint, and a full `next build` (both new routes registered) — all clean.

---

### Shared chat hooks — useChatReactions + useChatSession — 2026-06-01

**Problem:** The previous audit (same day, below) flagged ~150 lines of near-identical logic duplicated across `ChatWindow`, `ProjectChatView`, and `FamilyChatWindow`: `loadReactions`, `handleReact`, the initial-reactions seeding, `deleteMessage`, `handleRetry`, the device-geolocation effect, and the `/api/chats/mark-read` on-open effect. Three copies meant three drift surfaces (the stream-finalizer drift fixed earlier the same day was the same failure mode).

**Fix:** Extracted two hooks under a new top-level `hooks/` directory:
- `useChatReactions({ chatId, currentUserId, userColorHex, colorMap, initialReactions })` → `{ reactionsMap, setReactionsMap, loadReactions, handleReact }`. Owns the reaction state, seeds it from server-rendered `initialReactions`, reloads after streaming, and applies the optimistic toggle. `colorMap` is held in a ref so `loadReactions` stays referentially stable (safe in effect deps) while always aggregating with current member colors. `setReactionsMap` is returned so the project/family realtime subscriptions can keep applying INSERT/DELETE events into the hook-owned state (those subscriptions stay in the wrappers — they're per-context).
- `useChatSession({ chatId, currentUserId, messages, setMessages, setInput, setError })` → `{ currentLocation, deleteMessage, handleRetry }`. Owns the device-location reverse-geocode, the `/api/chats/mark-read` on-open call, message deletion, and retry-last-message.

All three wrappers now call both hooks instead of carrying their own copies. `NewChatOrchestrator` (new-chat welcome screen) was intentionally left out — it has no persisted chat id, reactions, or deletable history yet.

**Reason:** Same principle as the Chat UI Universal Component Rule (2026-05-09), applied to behavior rather than visuals. Cross-context logic in one place can't drift.

**Behavior:** Pure refactor. Two cosmetic deltas: `ChatWindow`'s geolocation `catch` previously logged `console.error('[geolocation]', err)` and is now silent like the other two (aligns with the no-console rule); `deleteMessage`'s error log label is now `[useChatSession]` instead of the per-component tag. The realtime reaction-subscription effects in project/family had their dependency arrays changed from the (unused-in-body) `loadReactions` to the hook-stable `setReactionsMap` — identical re-subscription behavior.

**Context kept in the wrappers (not extracted):** family's `/api/notifications/mark-read` + presence heartbeat, project's instructions-update-on-unmount, and every per-context realtime channel + message subscription. These are genuinely context-specific.

**Notes:** New CHAT LOGIC RULE in CLAUDE.md. No schema/migration changes. Verified via `tsc --noEmit`, ESLint, and a full `next build` — all clean.

---

### Chat UI consistency audit — shared stream finalizer + shared status strip — 2026-06-01

**Problem:** A code-quality/UI-consistency audit found that long-form response finalization (the post-stream computation of final text + task-progress data) was copy-pasted into all four chat contexts (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`, `NewChatOrchestrator`) and had drifted:
- `ProjectChatView` was missing the `\x1eTASK_PROGRESS:` sentinel strip → raw sentinel JSON could flash in the final bubble after a multi-step task (the same bug fixed for standalone on 2026-05-18, never ported to project).
- `FamilyChatWindow` stripped only task XML tags → a raw `\x1eSTATUS:…\x1e` sentinel could leak into the final bubble when web search ran.
- `NewChatOrchestrator` hand-rolled its own reader loop instead of the shared `consumeStream`.

Separately, the streaming status indicator ("Searching the web…") rendered only in standalone: it lived in `TopBar`'s `statusText` strip. `ProjectTopBar` and the family topbar never received it, and the only other display path — `MessageBubble.workingStatus` — was dead code left over from the 2026-05-18 "status moved below topbar" change. So project and family chats computed `workingStatus` but never displayed it.

**Fix:**
- Added `finalizeStream(accumulated)` to `lib/chat/clientStream.ts`. It delegates to `parseStreamFrame` (the canonical streaming-frame parser) and full-trims, so finalization uses the exact same stripping as live ticks. All four contexts now call it; ~25 lines of drift-prone duplication removed from each.
- Refactored `NewChatOrchestrator` onto the shared `consumeStream` + `finalizeStream` + `extractImageRequest`, and gave it task-card parity (it previously ignored task data entirely on the first turn).
- Moved the streaming status strip into the shared `MessageList` (it already received `streamingStatus`). Removed the `statusText` prop + strip from `TopBar`, and removed the dead `workingStatus` prop from `MessageBubble` (+ its unused `indicatorStatus` style) and the dead forward in `MessageList`. The indicator now appears identically in standalone, project, and family chat.

**Reason:** This is the Chat UI Universal Component Rule (2026-05-09) applied to behavior, not just visuals. The finalizer and the status indicator are cross-cutting concerns; keeping per-context copies guaranteed they would drift, and they had. One finalizer + one status-render site means a fix propagates everywhere automatically.

**Alternatives considered:** Threading `statusText` through each context's distinct top bar (`TopBar`, `ProjectTopBar`, family topbar-as-prop). Rejected — three pass-through paths to maintain, and the family topbar is injected as an opaque `ReactNode` from the server page, so it can't see `workingStatus`. Rendering in the shared `MessageList` is the single home that all contexts already feed.

**Notes:** No schema or migration changes. New enforcement rule in CLAUDE.md: STREAM FINALIZER RULE. Verified via `tsc --noEmit`, ESLint, and a full `next build` — all clean.

---

### Member exclusions — 2026-05-31

**Problem:** Grampy (new household member) and Nana have a relationship that makes it inappropriate for them to share chats or projects together. Needed a hard constraint, not just a UI convention.

**Schema:** New `member_exclusions` table stores mutual exclusion pairs (`user_id_a`, `user_id_b`, `created_by`). A unique expression index on `(LEAST, GREATEST)` of the two UUID columns prevents duplicate/reversed pairs. Admin-only RLS — non-admin users cannot read or write exclusions directly.

**Enforcement:** DB-level triggers on `chat_members` (`enforce_chat_member_exclusion`) and `project_members` (`enforce_project_member_exclusion`) fire BEFORE INSERT and raise `member_exclusion_violation` if the incoming member conflicts with an existing member in the same chat/project. This makes the constraint impossible to bypass through the API.

**API layer:** Both routes that add members (`POST /api/projects/[id]/members`, `POST /api/family/threads/[id]/members`) catch the `member_exclusion_violation` exception and return 409 with a generic message — no reason exposed to the client. Thread creation (`POST /api/family/threads`) also handles 409 for the batch insert case.

**UI layer:** `getExcludedMemberIds(userId)` in `lib/members/getExcludedMemberIds.ts` fetches excluded IDs server-side via service role (bypasses admin-only RLS). Server pages (`/projects/[id]`, `/family/threads/[id]`) call this and pass `excludedMemberIds` as a prop. Member picker UI (ProjectHome, FamilyThreadTopBar) renders excluded members greyed out (`opacity: 0.35`, `pointer-events: none`) with no interaction — no tooltip or explanation.

**Seed:** After Grampy's account is created, run the commented SQL in `031_member_exclusions.sql` to insert the Grampy ↔ Nana exclusion row. See migration-log.md for status.

---

### Reactions feature — 2026-05-21

**Schema:** New `reactions` table (`id`, `message_id`, `chat_id`, `user_id`, `type`, `created_at`). `user_id` is nullable — NULL means Bruce reacted. `chat_id` is denormalized from the message's chat so realtime subscriptions can filter by `chat_id=eq.{chatId}` without a join. Two partial unique indexes enforce one reaction per type per reactor: `reactions_bruce_unique (message_id, type) WHERE user_id IS NULL` and `reactions_member_unique (message_id, user_id, type) WHERE user_id IS NOT NULL`. RLS: read via `is_chat_member(chat_id)`, insert/delete scoped to `auth.uid()`. Service role used for Bruce reactions (no auth session for Bruce).

**Three-tier response model:** Bruce now has a third option between responding and staying silent: react. When a message is purely informational and acknowledgment is appropriate but no reply is needed, Bruce calls the `react_to_message({type: "thumbs_up"})` tool and produces no text. The tool was added to `TOOLS_FULL` in `streamHandler.ts`. The TASK_PROGRESS sentinel is suppressed for `react_to_message` so no task card flashes. The old "Never send a reaction, emoji, or any acknowledgment token" rule in `MULTI_MEMBER_PARTICIPATION_RULE` was replaced with an explicit react tier.

**Member reactions:** Toggled via `POST /api/messages/[id]/reaction`. Optimistic updates applied immediately in component state; server sync follows; a fresh reaction load confirms final state (handles Bruce reactions that arrive after stream).

**Realtime:** Family and project chat windows subscribe to `reactions` INSERT/DELETE on the same Supabase channel as messages, filtered by `chat_id=eq.{chatId}`. Standalone (ChatWindow) reloads reactions after each stream completes via `loadMessages`, which now also calls `loadReactions`.

**UI:** Long press (500ms, mobile) surfaces a 👍 hint overlay that auto-dismisses after 3 seconds. Desktop right-click context menu always shows 👍 React; Delete only appears when `canDelete`. Reaction pills render below the bubble with emoji + count (if >1) + color pips (up to 5, then +N overflow). `hasCurrentUser` highlights the pill with the accent color.

**Pre-build audit finding:** Image generation exclusion from family/group chats (`includeImageGen: false`) is mentioned in a comment in `streamHandler.ts` but was not in `decisions.md`. Documented here: image generation is intentionally excluded from multi-member chats to avoid inappropriate generation in shared contexts. The image tool over-firing fix (2026-05-18) tightened the prompt but the multi-member exclusion is an architectural choice, not just a prompt fix.

---

### PWA icon cleanup — final 4-entry manifest + remove legacy files — 2026-05-18

**Decision:** Finalized the manifest icons array to exactly four entries: `bruce-icon-192.png` (any 192), `bruce-icon-512.png` (any 512), `bruce-icon-maskable-192.png` (maskable 192), `bruce-icon-maskable-512.png` (maskable 512). Removed all unreferenced legacy icon files: `bruce-icon-any-192.png`, `bruce-icon-any-512.png`, `icon-192.png`, `icon-512.png`, and the entire `public/icons/` directory (`icon-120.png`, `icon-192.png`, `icon-512.png`). Removed the `icons` exclusion from the middleware matcher since the directory no longer exists. `app/layout.tsx` already uses `metadata.icons.apple: "/apple-touch-icon.png"` — no change needed.

---

### PWA icons — adaptive icon set with maskable support — 2026-05-18

**Decision:** Replaced the single combined `"any maskable"` icon entry in `manifest.json` with four explicit entries — separate `any` and `maskable` variants at both 192×192 and 512×512 — following the PWA adaptive icon spec. The 192px files were generated from the 512px sources using `sips`. Source files: `bruce-icon-512.png` (any), `bruce-icon-maskable-512.png` (maskable), `bruce-icon-any-512.png` (any, alternate). Removed old `/icons/icon-*.png` references from the manifest. `app/layout.tsx` already references `/apple-touch-icon.png` via `metadata.icons.apple` — no change needed.

---

### iOS PWA notification permission banner — 2026-05-18

**Decision:** On iOS PWA, `Notification.requestPermission()` requires a user gesture — calling it on mount from a `useEffect` silently fails and the iOS permission dialog never appears. Fixed by splitting the FCM registration flow in `ChatShell.tsx`: on mount, check `Notification.permission` rather than immediately calling `requestAndGetToken()`. If already "granted", refresh the token silently as before. If "default" and the user hasn't been prompted yet (`notifications_prompted` localStorage flag), show a one-time banner reading "Enable notifications to get reminders from Bruce." with an Enable button and a dismiss X. The Enable button calls `requestAndGetToken()` from within the click handler (a user gesture), satisfying iOS's requirement. On grant, the FCM token is saved to Supabase via `POST /api/notifications/register` and logged to the console for verification. Dismissing or enabling both set `localStorage.notifications_prompted = "true"` so the banner never reappears. The banner renders at the top of `<main>` (before page children) using design tokens — no Tailwind.

---

### Image tool guard + app icon replacement — 2026-05-18

**Decision 1 — Image tool over-firing:** `IMAGE_SYSTEM_BLOCK` in `lib/anthropic/index.ts` was too loose — "anything visual" and the implicit "create" trigger caused Bruce to fire image generation for text requests like "create a game." Tightened the instruction to require the request to be unambiguously about a visual output (image, illustration, picture, photo, drawing, artwork). Added explicit exclusions for games, quizzes, plans, documents, lists, and stories. Added a note that "create" or "make" alone does not trigger image generation.

**Decision 2 — App icon:** Replaced all PWA and iOS icon sizes with resized versions of `public/bruce-logo.png`. Files updated: `public/icons/icon-512.png`, `public/icons/icon-192.png`, `public/icons/icon-120.png`, `public/apple-touch-icon.png`. `manifest.json` filenames and `app/layout.tsx` references were already pointing to these paths — no JSON changes needed. Source file `public/bruce-logo.png` (814×841) is the new canonical logo.

---

### Reminder FCM title + deep link + TASK_PROGRESS flash fix — 2026-05-18

**Decision 1 — Reminder FCM improvements:** Title changed to "Bruce 🔔". Added `chat_id UUID` to the `reminders` table (migration 028, `ON DELETE SET NULL`). `executeRemindersTool` now receives `chatId` threaded from `persist.chatId` in `streamHandler.ts` and stores it on `create`. The cron route selects `chat_id` and builds a path-based URL (`/chat/[id]` or `/`). The FCM `notificationclick` handler in the service worker updated to use `self.location.origin + url` so path-based deep links work correctly.

**Decision 2 — TASK_PROGRESS flash fix:** The post-stream `finalText` computation in both `ChatWindow.tsx` and `NewChatOrchestrator.tsx` was stripping STATUS sentinels but not TASK_PROGRESS sentinels (`\x1eTASK_PROGRESS:...\x1e`). This caused a brief flash of raw JSON in the bubble when the stream finished. Fixed by adding the strip regex to both post-stream `finalText` and the live `displayText` in `NewChatOrchestrator`.

**Decision 3 — Status label moved below topbar:** `workingStatus` (the "Searching the web..." indicator from STATUS sentinels) was previously rendered inside the streaming bubble below the typing dots. Moved to a muted strip below the top bar — added `statusText` prop to `TopBar.tsx` which renders a small `var(--text-tertiary)` line below the bar. Removed from inside `MessageBubble`. Both `ChatWindow` and `NewChatOrchestrator` pass `workingStatus` as `statusText` to `TopBar`.

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
