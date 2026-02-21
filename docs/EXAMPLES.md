# Examples & Workflows

This document provides typical workflows and practical examples of how to use `hyprvox` effectively in your daily tasks.

---

## 1. Developer: Quick Coding Comments

Transcribe technical comments or documentation directly into your IDE without stopping your flow.

**Workflow:**
1. Position your cursor in your IDE (e.g., VS Code) where you want the comment.
2. Press **Right Control**.
3. Speak: *"Implement a retry logic with exponential backoff here"*
4. Press **Right Control**.
5. The text is appended to your clipboard.
6. Press `Ctrl+V` (or your paste shortcut) to insert it.

**Pro-Tip:** Use `boostWords` for project-specific terms like library names or internal module names to ensure perfect transcription.

---

## 2. Productivity: Drafting Emails & Messages

Draft long responses or Slack messages while you're away from the keyboard or just to save time.

**Workflow:**
1. Open your email client or messaging app.
2. Press **Right Control**.
3. Speak your message naturally.
4. Press **Right Control**.
5. Wait for the notification "Transcription Ready".
6. Paste the result.

**Note:** Because `hyprvox` **appends** to your clipboard, you can transcribe multiple sentences one by one, and they will all be waiting in your clipboard for a single paste.

---

## 3. Meeting Minutes: Action Items

Capture quick notes or action items during a call.

**Workflow:**
1. Keep a notepad or document open.
2. When an important point is mentioned, press **Right Control**.
3. Speak: *"Action item: Snehit to review the PR by Friday"*
4. Press **Right Control**.
5. Continue with the meeting.
6. Later, paste all your collected notes at once.

---

## 4. Technical Jargon: Using Boost Words

If you frequently use technical terms that the model might struggle with (e.g., "Hyprland", "Sisyphus", "Kubernetes"), add them to your boost words.

**Command:**
```bash
bun run index.ts boost add "Sisyphus" "Hyprland" "hyprvox" "gsk_"
```

**Result:**
The next time you say "Sisyphus", both Groq and Deepgram will be much more likely to transcribe it correctly instead of "Sisyphus" or "Sysiphus".

---

## 5. System Management: Daemon Workflows

Managing the `hyprvox` daemon using the CLI and systemd.

### Check if it's running
```bash
bun run index.ts status
```

### View recent history
If you forgot to paste something or accidentally cleared your clipboard:
```bash
bun run index.ts history list -n 5
```

### Troubleshoot Audio Issues
If transcription feels sluggish or fails:
```bash
# Check if your mic is being detected and API keys are valid
bun run index.ts health

# Monitor logs in real-time while you record
bun run index.ts logs --follow
```

---

## 6. Clipboard "Append" Workflow

A unique feature of `hyprvox` is that it never overwrites your clipboard. It always appends.

**Scenario:**
1. You copy a URL: `https://github.com/Snehit70/hyprvox`
2. You use `hyprvox` to transcribe: *"Check out this awesome project: "*
3. Your clipboard now contains: `https://github.com/Snehit70/hyprvoxCheck out this awesome project: `

**Correct Workflow for Links/Prefixes:**
1. Transcribe the intro first: *"Check out this repo: "*
2. Copy the URL.
3. Your clipboard now has both, ready to paste.

---

## 7. Programmatic API Examples

If you are a developer looking to integrate `hyprvox` core logic into your own tools, check out the dedicated [API Examples Reference](API.md#example-usage) and the runnable scripts in `scripts/examples/`:

- `simple-transcription.ts`: Basic Groq transcription.
- `parallel-transcription.ts`: Parallel Groq + Deepgram.
- `full-workflow.ts`: Recorder + Parallel + Merge.
- `list-microphones.ts`: Device discovery.
