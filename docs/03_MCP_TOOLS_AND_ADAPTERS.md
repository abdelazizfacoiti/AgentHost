# AgentHost MCP Tools and Adapter Specification

All tools return `ToolResult`. MCP transport is stdio. Browser bridge is a separate fixed, token-authenticated localhost channel, not a public MCP transport.

## Strategy order

1. app adapter/API
2. official API/plugin API
3. CLI/script
4. browser DOM
5. accessibility
6. screenshot OCR/vision grounding
7. pointer GUI fallback
8. guide mode

## Current Phase 31 capabilities

### System, policy, app, file, shell, guide, adapter

```text
system.get_info, system.list_capabilities, system.check_dependency
policy.get_profile, policy.list_profiles, policy.list_grants, policy.explain_decision
app.detect, app.list_installed, app.open, app.get_strategy
file.write, file.read, file.exists, file.list, file.ensure_dir
shell.run_safe
guide.create_steps, guide.explain_strategy
adapter.list, adapter.get_capabilities, adapter.detect_for_app
```

### Desktop, windows, accessibility

```text
desktop.get_capabilities, desktop.get_active_window, desktop.screenshot
desktop.hotkey, desktop.type_text, desktop.click
desktop.move_mouse, desktop.scroll, desktop.double_click
desktop.right_click, desktop.drag
window.list, window.focus
accessibility.get_tree, accessibility.find_element
accessibility.inspect_element, accessibility.invoke_action
accessibility.set_value, accessibility.focus_element
```

Pointer tools require active-window context, bounds checks, safety classification, dry-run, and confirmation unless a narrow local demo policy permits. Sensitive apps remain blocked/guide-only; communication actions are high-risk.

### Browser

```text
browser.detect, browser.list_tabs, browser.get_active_tab, browser.current_url
browser.open_url, browser.get_page_context, browser.extract_text
browser.find_element, browser.click_element, browser.fill_text
browser.focus_element, browser.wait_for_state, browser.get_form_state
browser.get_selected_text
```

Bridge is disabled by default. Fixed commands run through paired `127.0.0.1` WebExtension. `browser.find_element` returns bounded metadata and short-lived opaque `elementId`. Click/fill/focus require that reference; direct selectors cannot execute actions. References are tab/page-bound, revalidated, and rejected when stale or ambiguous. No `browser.click_selector` or `browser.fill_form` exists.

`browser.open_url` requires dry-run and exact confirmation. Content is redacted and sensitivity-gated. No send, submit, upload, download, cookie, storage, password, debugger, or arbitrary script command exists.

### Vision and screenshot handoff

```text
vision.analyze_image, vision.find_text, vision.find_target
vision.prepare_pointer_action
```

OCR is local Tesseract CLI only. Results contain bounded redacted text, boxes, centers, confidence, and target suggestions. Vision never clicks or types. `vision.prepare_pointer_action` validates approved image roots, dimensions, coordinate space, fresh trusted screenshot evidence, active window, bounds, confidence, and risk, then returns only a `desktop.click` `dryRun:true` payload.

### Checkpoints

```text
checkpoint.evaluate
checkpoint.wait_for
```

Observe-only semantic checks for browser state, accessibility metadata, active windows, approved file metadata, and trusted vision evidence. No workflow action, unsafe retry, or confirmation generation.

### Tool Forge/generated runtime

```text
forge.validate_manifest, forge.review_manifest, forge.propose_grants
forge.save_manifest, forge.list_manifests, forge.get_manifest
forge.create_review, forge.get_review, forge.list_reviews, forge.archive_manifest
forge.apply_session_grants_from_review
forge.scaffold_project, forge.validate_project
forge.get_artifact, forge.list_artifacts, forge.get_validation, forge.list_validations
forge.run_validation_harness, forge.get_harness_run, forge.list_harness_runs
forge.check_registration_eligibility, forge.register_artifact, forge.get_registration
forge.list_registrations, forge.revoke_registration
forge.check_runtime_eligibility, forge.check_sandbox_support
forge.run_sandboxed_tool, forge.get_runtime_run, forge.list_runtime_runs
forge.list_dispatchable_tools, forge.get_dispatchable_tool, forge.dispatch_generated_tool
```

Generated tools remain inert metadata and absent from live capabilities. Dispatch routes through the bounded JSON runner, runtime grants, eligibility, optional OS sandbox, dry-run, and confirmation.

### Workflow traces, skills, templates

```text
workflow.trace_start, workflow.trace_stop, workflow.trace_get
workflow.trace_list, workflow.trace_archive
workflow.skill_save_from_trace, workflow.skill_list, workflow.skill_get
workflow.skill_archive, workflow.skill_run_dryrun
workflow.skill_bind_checkpoints, workflow.skill_checkpoints_dryrun
```

Traces store redacted summaries only. Skills do not replay actions. Template binding accepts declared parameters and `{{parameterName}}` interpolation only. Checkpoint dry-run may evaluate read-only checkpoints only with `evaluate:true`; it never clicks, types, navigates, sends, submits, uploads, deletes, or creates tokens.

## Result and confirmation

State-changing tools support `dryRun:true` where applicable. Execution requires matching session-bound confirmation when policy says so. Confirmation never bypasses schema, safety, grants, protected-app rules, or approval.

## Optional adapters

`packages/app-blender` provides optional `blender.run_python`. Future adapters may target any provider or local app; provider names are examples, not core architecture.
