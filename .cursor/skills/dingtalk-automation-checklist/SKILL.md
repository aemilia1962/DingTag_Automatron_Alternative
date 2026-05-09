---
name: dingtalk-automation-checklist
description: Execute a lightweight, repeatable workflow for task automation in the DingTalk tool project. Use when the user asks to implement, fix, or update code and wants a checklist-driven process from requirement gathering through reporting outcomes and growth learnings.
disable-model-invocation: true
---

# DingTalk Automation Checklist

## When to use

Use this skill when working on tasks in the DingTalk tool codebase that should follow a strict, minimal-change workflow.

## Workflow

Follow this sequence exactly:

1. Gather requirements
2. Inspect files
3. Make minimal edits
4. Run checks
5. Report results with next actions
6. ได้อะไรจากการทำงานรอบนี้ และจดจำไว้เพื่อทำให้สกิลเติบโตมากขึ่น

## Verbatim flow from user

gather requirements → inspect files → make minimal edits → run checks → report results with next actions → ได้อะไรจากการทำงานรอบนี้ และจดจำไว้เพื่อทำให้สกิลเติบโตมากขึ่น

## Execution rules

- Keep edits small and focused on the requested task.
- Do not refactor unrelated code.
- Verify changes using available checks relevant to edited files.
- If checks cannot run, state why and provide manual verification steps.
- End with a concise recap of outcomes and one concrete improvement to remember for future runs.

## Response format

Use this output structure:

1. Requirement understanding
2. Files inspected and why
3. Minimal edits made
4. Checks run and results
5. Next actions
6. Learning from this round (what was gained and what to remember to improve the skill)

## Additional resources

- For concrete examples, see [examples.md](examples.md)
