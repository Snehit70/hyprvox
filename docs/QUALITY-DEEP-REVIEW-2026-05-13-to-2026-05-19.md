# Deep Transcript Review: 2026-05-13 to 2026-05-19

- Window: `2026-05-13T00:00:00+00:00` to `2026-05-20T00:00:00+00:00`
- Transcripts reviewed: **208**

## Rating Distribution

- `clean`: **198** (95.19%)
- `minor`: **0** (0.00%)
- `major`: **4** (1.92%)
- `severe`: **6** (2.88%)

## Detected Issue Counts

- `cot_leak`: **2** (0.96%)
- `prompt_meta`: **5** (2.40%)
- `mixed_script`: **0** (0.00%)
- `outro_phrase`: **2** (0.96%)
- `injected_tech_tokens`: **5** (2.40%)
- `high_repetition`: **0** (0.00%)

## Notable Bad Cases (manual follow-up list)

| Timestamp | Rating | Flags | Merge strategy | Preview |
|---|---|---|---|---|
| `2026-05-13T07:31:04.131000+00:00` | `severe` | `prompt_meta` | `-` | Are you really sure it will block requests from different origin? Don't understand what I am trying to say. So it will mostly be like this. It will be |
| `2026-05-13T07:47:01.623000+00:00` | `major` | `injected_tech_tokens` | `-` | Let's test this hypothesis. Use this command, ssh fate. I have written it down so you won't have to. This will help you SSH into AWS instance that I h |
| `2026-05-13T12:44:08.334000+00:00` | `severe` | `prompt_meta` | `-` | If I have to scrape the lectures from the website, how will I do? Assume I'll be using the console of the browser. Mostly, I will have to understand t |
| `2026-05-13T12:46:20.674000+00:00` | `severe` | `prompt_meta` | `-` | I think you can just give me an inspector script or whatever. Assume you run into it in an authenticated session and I will... How should I say? It's  |
| `2026-05-14T02:38:16.984000+00:00` | `major` | `injected_tech_tokens` | `-` | This is Fieldforce, a new project that we will be working on. I want to initialize this repository. This is the problem statement here. The second pro |
| `2026-05-14T03:11:37.088000+00:00` | `severe` | `prompt_meta,injected_tech_tokens` | `-` | I think you don't understand. We have a team of 8 members. 4 members will be working on the full stack application and 4 members will be working on th |
| `2026-05-14T03:16:32.071000+00:00` | `major` | `injected_tech_tokens` | `-` | No, there is nothing. You don't need to preserve the things in order. Here is the next thing that I think we should focus on. Firstly, the application |
| `2026-05-14T06:27:53.934000+00:00` | `major` | `injected_tech_tokens` | `-` | Let's do it like this. In the plan.md, what you can do is that, let's take one more week or how much time. Just add this in plan.md to use the best mo |
| `2026-05-14T07:02:12.063000+00:00` | `severe` | `cot_leak,prompt_meta,outro_phrase` | `-` | <think> Okay, let's tackle this problem. The user wants me to correct the failed speech-to-text output by removing invalid artifacts. The main issue h |
| `2026-05-19T16:50:58.086000+00:00` | `severe` | `cot_leak,outro_phrase` | `-` | <think> Okay, let's see. The user wants me to fix a failed speech-to-text merge. The failed output is [NO_SPEECH_DETECTED], which probably means the s |

## Improvement Backlog (Pipeline Hardening)

1. **Block chain-of-thought/meta leakage post-merge and post-repair**: hard reject `<think>` and reasoning scaffolds, then force source fallback or no-speech output.
2. **Tighten repair prompt and validation coupling**: include an explicit denylist for meta phrases and evaluate repaired output with stricter guardrails.
3. **Add token-injection guard**: detect high-risk injected file/command tokens that are not present in either source transcript before saving.
4. **Strengthen empty/weak-source handling**: if Groq+Deepgram are both tiny or contradictory, prefer deterministic no-speech/fallback over aggressive repair merge.
5. **Keep model safety-first ranking in deploy policy**: continue preferring models with zero CoT/meta leakage over raw speed gains.
6. **Add explicit quality metadata to history**: store validation and repair outcomes per transcript for simpler future audits.

## Notes

- This review uses saved final transcripts plus available source pairs (Groq source transcript log + Deepgram streaming chunks) where matchable by timestamp proximity.
- Cases without confident source-pair match are still rated for visible leakage symptoms in final output.