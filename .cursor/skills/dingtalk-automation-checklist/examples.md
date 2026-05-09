# Examples

## Example 1: Bug fix request

Input:
"Fix duplicate message sending in DingTalk extension."

Expected execution pattern:
1. Gather exact reproduction details and acceptance criteria.
2. Inspect likely files (for example `DingTalk_Extension/content.js`).
3. Apply a minimal fix only for duplicate-send logic.
4. Run relevant checks or smoke test steps.
5. Report what changed and what the user should do next.
6. Add a short learning note for improving future runs.

## Example 2: Small enhancement

Input:
"Add a timeout safeguard to the automation script."

Expected execution pattern:
1. Confirm timeout target behavior.
2. Inspect the automation entrypoint and config usage.
3. Add only the timeout-related change.
4. Run checks for script execution and syntax.
5. Report outcomes and suggested follow-up validation.
6. Capture one improvement to remember for the skill.
