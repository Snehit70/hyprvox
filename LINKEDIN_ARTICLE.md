# From Slow Dictation to 0.055 RTF: My Speech-to-Text Optimization Journey

## The Moment Everything Changed

It was around the launch of Claude 4.5 Opus. The "Claude Code boom" was everywhere - every developer YouTuber I watched was suddenly coding with their voice. They'd hit a shortcut, speak naturally, and watch their thoughts transform into working code.

I was mesmerized.

I'd spent years optimizing my workflow—touch typing, Vim motions, keyboard-first Linux setup. The philosophy was simple: least resistance, write code not prompts. But then the prompting era arrived, forcing a different workflow. Suddenly you had to describe what you wanted to build instead of just coding. My finely-tuned process was breaking.

I'd been stuck in the typing trap. You know the one - fingers struggling to keep pace with your brain, constantly backspacing to fix typos, losing my train of thought while wrestling with spelling. I realized something: with AI, perfection doesn't matter. Raw, unpolished thoughts work just fine.

WhisprFlow was the tool they were using. Clean overlay. Global hotkey.

This looked like exactly what I was searching for

Until I looked closer.

## The Paywall and The Search

WhisprFlow and other tools had monthly subscription tiers. I wasn't ready to pay.

I get it - good tools deserve payment. But this felt like a basic utility being gated. So I did what any Open source frenzy would do: I searched for alternatives.

The results were... underwhelming.

Most "solutions" required serious GPU power. "Just run whisper.cpp on your machine!" Great, if you have a gaming laptop. Mine isn't. The landscape was fragmented—some had global hotkeys, but they felt unreliable or over-engineered.

It hit me then: _Why not just build it myself?_

---

## Chapter 1: Building Hyprvox

**The Requirements**

I sketched out what I actually needed:

- **Fast** - Because dictation that's slower than typing defeats the purpose
- **Global hotkey** - Right Control, anywhere in the system
- **No paywall** - Use free tiers, stay within limits
- **Reliable** - When you dictate code or technical terms, accuracy matters
- **Linux native** - Not a browser extension, not a snap package, a real daemon

**The First Challenge: Wayland**

Here's a fun Linux quirk: global hotkeys on Wayland are a mess. Unlike X11, you can't just register a system-wide key listener. I built a pragmatic solution - Hyprvox supports both a built-in key listener (via node-global-key-listener) _and_ compositor-driven keybinds. My current setup? I disable the built-in listener and let my window manager (Hyprland) handle the hotkey, then send a signal to Hyprvox. It works beautifully.

**The First Iteration**

I started simple. Single-engine Groq. Record audio, upload, transcribe, copy to clipboard.

It worked... until it didn't.

One day it would nail "async function with generic type parameters." The next day it would hallucinate "async fiction with genetic pipe parameters." Single-engine ASR systems are brilliant until they're confidently wrong.

I needed redundancy.

But how do you get redundancy without doubling your costs? That's when I discovered Deepgram.

While researching ASR providers, I found Deepgram's Nova-3 model. Like Groq, they had a generous free tier. But unlike Groq's Whisper (which is OpenAI's architecture), Deepgram built their own model specifically for conversational speech. Different architecture, different strengths, different failure modes.

The hypothesis was simple: if Groq and Deepgram make different types of mistakes, I could run both in parallel and pick the best of both. Or better yet, merge them.

---

## Chapter 2: Two Engines Are Better Than One

**The Insight**

The "aha" moment came from analyzing errors. I noticed something fascinating: when Groq Whisper V3 got confused, it was usually on casual, fast-paced speech. When Deepgram Nova-3 struggled, it was technical jargon and code terms. Their failure modes were almost perfectly complementary.

Take "Hyprland" (my window manager). Groq would often split it as "hyper land." Deepgram would keep it as one word. But Deepgram would sometimes miss "async/await" or split function signatures weirdly. Groq nailed those.

So I ran both. But here's where it gets interesting: they're not just running in parallel batch mode.

**Streaming vs. Batch**

My current config uses a hybrid approach:

- **Deepgram runs in streaming mode** - It starts transcribing the moment you start speaking, sending chunks over WebSocket
- Groq runs in batch mode - It processes the final encoded audio after you stop recording (Groq's API doesn't support streaming)

This means Deepgram is already halfway done by the time you release the hotkey. The parallelization isn't just two APIs firing simultaneously - it's temporal overlap.

**Complementary, Not Just Redundant**

Different ASR architectures make different mistakes:

- **Groq Whisper V3**: Excellent with technical jargon, code snippets, structured speech. Struggles with fast, casual dictation.
- **Deepgram Nova-3**: Optimized for conversational speech, handles accents and speed well. Sometimes misses technical terms.

When both transcribe the same audio, their errors rarely overlap. One's weakness is often the other's strength.

---

## Chapter 3: The Merge Problem

When two engines disagree, you have three choices:

1. **Pick the faster one** - Faster isn't always accurate
2. **Pick the more confident one** - Confidence scores can be misleading
3. **Use a third opinion** - Someone (or something) to break the tie

I chose option 3.

**Deterministic Gating: The Free Win**

Here's the clever part: before we ever touch an LLM, we run a series of deterministic checks. These catch ~23% of sessions (based on my full 1,142-session corpus) and skip the LLM entirely.

- **Exact match** - Both transcripts identical? Done.
- **Case/whitespace normalized match** - "Hello World" vs "hello world"
- **Punctuation-only differences** - Groq loves periods, Deepgram sometimes skips them
- **Small diff match** - Single word differences that look like clear substitutions
- **Conservative technical term matching** - "function" vs "functions" (singular vs plural)

When any of these gates trigger, we save ~569ms.

**When We Force the LLM**

But sometimes simple string comparison is dangerous. We deliberately bypass the gates when we detect:

- **Structured dictation** - Spoken list cues ("first," "second," "next")
- **Literal symbols** - "open curly bracket," "close paren," "arrow function"
- **Code-heavy content** - Anything that looks like it contains programming syntax

These are exactly the cases where naive string gating becomes unsafe. Technical terms and symbols are where single-word differences matter enormously.

**The Anti-Hallucination Guard**

There's a final safety check: if streaming Deepgram produced zero transcript chunks and Groq returned only a tiny snippet, we treat that as likely silent-audio hallucination and suppress output entirely. Better to output nothing than confidently wrong nonsense.

**The Merge Strategy**

The merge layer has evolved significantly. It started with **Llama-3.3-70b-versatile** in January consistent, reliable, but slow at ~500ms. In February, I ran A/B tests against GPT-OSS and Llama-3.1-8b, but larger models didn't justify the latency cost. After the experiments, I returned to Llama for consistency.

**March 29**: Switched to **Qwen Qwen3-32B**.

Qwen offers comparable merge quality at lower latency (~376ms vs Llama's ~500ms+). The difference is noticeable when you're doing 50+ sessions a day.

For the ~80% of sessions that need LLM merging, the model reconciles the two transcripts, looking for:

- Word substitutions ("function" vs "functions")
- Missing words in one but present in the other
- Punctuation differences
- Technical term corrections

The merge quality is excellent - often better than either source transcript alone.
{ it also gives us freedom to format the response }

---

## Chapter 4: Three Months, Three Realizations

I thought I was building a faster transcription tool. I ended up learning how wrong I was about everything I thought I knew.

---

## Phase 1: The Streaming Gamble (January)

**January 22, 2026. 9:07 AM.**

The dual-engine architecture is finally working. Groq and Deepgram both return transcripts. The merge logic reconciles them. I'm tracking 93 sessions, and the median RTF is 0.112.

For context: that's processing 1 second of audio in 112 milliseconds. Respectable. Reliable. Slow.

I'd been running both engines sequentially—start Groq, wait for result, start Deepgram, wait for result, merge. The latency stacked. But tonight, staring at the logs, I realized something: **Deepgram doesn't need the final audio file.**

Their WebSocket API can stream chunks in real-time. The moment I start recording, Deepgram can start transcribing. By the time I release the hotkey, Deepgram is nearly done.

**February 1, 11:30 PM.**

Streaming mode lands. I run the first 50 sessions.

The numbers: median processing drops from 1.60s to **0.80s**. RTF plummets from 0.112 to **0.033**.

3.4 times faster. From **temporal overlap**. Deepgram processes during recording, not after.

That night, I learn my first lesson: **parallelization beats speed.**

---

## Phase 2: The Opus Regret (February)

**February 13, 8:45 PM.**

The buffering fixes work. Setup latency drops another 262ms. I'm feeling confident—maybe too confident.

I decide to add Opus compression. Raw WAV files are 1.7MB for 10 seconds. Opus should cut that by 88%. Less bandwidth, faster uploads, happier free tier. Obvious win.

**February 21.**

The regression hits.

Pre-Opus: median processing 795ms, RTF 0.029. Post-Opus: median processing **1,128ms**, RTF **0.039**.

I've added 745ms of fixed overhead. For three weeks, I question the decision. The compression is perfect, but the latency penalty feels like a mistake.

**Then I remember streaming.**

If Deepgram can overlap with recording... why can't ffmpeg overlap with teardown? What if the conversion runs while I'm waiting for the WebSocket to close?

**March 28.**

Deepgram stop + ffmpeg overlap lands. The critical path change:

- Before: Deepgram teardown **537ms**
- After: Deepgram teardown **0ms**

That 745ms of Opus overhead? Gone from the critical path. Hidden under overlap.

The second lesson: **some optimizations only make sense in context.** Opus wasn't a latency win—it was a bandwidth win that became a latency win once the architecture caught up. I had to be willing to make things temporarily worse to make them permanently better.

---

## Phase 3: The Instrumentation Shock (March)

**March 13. The measurement era begins.**

I instrument everything. Every millisecond of ffmpeg. Every WebSocket handshake. Every LLM token.

And I realize: **I knew nothing.**

Remember that LinkedIn post? "882ms median latency." I was proud of that number. Posted it publicly.

The truth: it came from a narrow window—February 10-20, 213 hand-selected "clean" sessions. Pre-Opus. Pre-parallelization. I filtered out failures, published successes, called it truth.

When I look at the full corpus of 1,142 sessions, I find the median RTF for that window was actually 0.026 not some absolute 882ms. But 882ms sounded better, so I led with it.

Public metrics humble you. That number wasn't wrong. It was **meaningless without context.** Different recording lengths, different code paths, different tradeoffs. Now I lead with RTF and fixed overhead decomposition. Harder to explain, but honest.

**March 28, 11:47 PM.**

The parallelization lands. Deepgram critical path: **0ms**. The inflection point.

After five weeks—streaming, buffering, gating, overlapping—I've hit the ceiling. The only thing left is Groq's fixed 466ms plus 8.42ms per second of audio. You can always optimize more, pre-warm TCP, shave milliseconds. But at some point, you're optimizing the experience of waiting, not the tool itself.

March 28 was that point.

---

## The Current State

**87 sessions, March 28-31, 2026:**

- **Median RTF**: 0.050 (18x faster than real-time)
- **Fixed overhead**: ~1,340ms (down from 1,479ms)
- **Variable cost**: 17.7ms per second of audio
- **Deepgram critical path**: 0ms (fully overlapped)
- **Merge skip rate**: 7.1% (deterministic gating)
- **Zero failures**: 100% reliability

From 0.112 RTF in January to 0.050 today. Not from one breakthrough. From five deliberate tradeoffs:

1. **Streaming** cut latency in half
2. **Buffering fixes** tightened the pipeline
3. **Opus** traded latency for bandwidth (temporarily)
4. **Deterministic gating** eliminated 20% of LLM calls
5. **Parallelization** hid the overhead

**1,142 preserved sessions. 636 with raw detail. One evolving architecture.**

---

## Chapter 5: Reflections from 1,142 Sessions

**The Instrumentation Moment**

March 13, 2026. That's when everything changed.

Before that date, I was flying blind. I had "882ms median latency" from a cleaned sample, and I thought I understood my system. Then I instrumented every component—every millisecond of ffmpeg, every WebSocket handshake, every LLM token—and realized I knew nothing.

The numbers I had been quoting were artifacts of measurement, not reality. The "clean" sessions I selected were the ones that worked. The noisy ones—the failures, the edge cases, the real world—were filtered out. When you build tools, you optimize what you measure. If you measure wrong, you optimize wrong.

I learned this the hard way with that LinkedIn post.

**The A/B Testing Surprise**

Sixty comparison runs. Three models. Zero clear winners.

I expected the larger model—GPT-OSS-120B—to dominate. It didn't. The quality difference between Llama-3.3-70B and the 120B giant was marginal. The latency difference was significant. The 8B model was faster but missed edge cases.

The lesson: bigger isn't always better. Sometimes "good enough and fast" beats "perfect and slow." I stuck with Llama not because it was the best, but because it was the best tradeoff. Then Qwen came along and proved you could have both.

**Knowing When to Stop**

March 28, 2026. Deepgram critical path: 0ms.

That was the inflection point. After five weeks of optimizations—streaming, buffering, gating, parallelization—I had hit the ceiling. The Deepgram teardown was off the critical path. The ffmpeg overhead was hidden. The only thing left was Groq's fixed 466ms plus 8.42ms per second of audio.

You can always optimize more. Pre-warm TCP connections. Overlap ffmpeg with Groq upload. Shave another 100ms here, 50ms there. But at some point, you're optimizing the experience of waiting, not the tool itself. March 28 was that point for me.

**The Free Tier Philosophy**

Between Groq's 10M tokens/day and Deepgram's $200 credit, I've processed 1,142 sessions for essentially zero dollars.

Not because I'm cheap. Because constraints breed creativity. When you pay per request, you instrument. When you instrument, you optimize. When you optimize, you learn. The free tiers forced me to understand my system deeply—because I couldn't just throw money at the problem.

Sometimes the best tools are the ones you build yourself, not because you couldn't buy them, but because building teaches you what buying never would.

---

## What's Next

**Parallelization v2**: Overlap ffmpeg conversion with API uploads. Estimated savings: 250-400ms.

**Smarter gating**: Use confidence scores to skip LLM merge on high-confidence single-source transcriptions.

**Streaming output**: Investigate word-by-word real-time display instead of waiting for final transcript.

**Custom vocabulary**: Per-user word lists for domain-specific terms.

---

_Built with Bun, TypeScript, and the stubborn belief that voice dictation should just work on Linux._

---

_Have thoughts on dual-engine ASR, Linux dictation tools, or Claude Code workflows? Drop a comment. I'd love to hear about your experiences with voice-driven development._
