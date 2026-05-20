# Manual Transcript Quality Review: 2026-05-13 to 2026-05-19

This report is a manual, transcript-by-transcript review (no script scoring for quality decisions).

Review rubric per transcript:

- `clean`: faithful and readable, no leakage artifacts
- `minor_issue`: understandable but with local phrasing/recognition drift
- `major_issue`: meaningful corruption, injected artifacts, or strong semantic drift
- `severe_issue`: chain-of-thought/meta leakage or transcript fundamentally unsafe

Leakage categories used:

- `none`
- `cot/meta`
- `prompt-artifact`
- `injected-file-cmd`
- `outro-hallucination`
- `mixed-script`
- `other`

## Consolidated Counts

Total manually reviewed rows: **211**

Quality totals:

- `clean`: **154**
- `minor_issue`: **29**
- `major_issue`: **24**
- `severe_issue`: **4**

Leakage-type totals:

- `none`: **154**
- `injected-file-cmd`: **18**
- `prompt-artifact`: **8**
- `cot/meta`: **3**
- `other`: **28**
- `outro-hallucination`: **0**
- `mixed-script`: **0**

Top observed failure modes:

1. **Injected file/command token tails** (e.g., `test-audio.mp3`, `benchmark-audio.ts`) appended to otherwise good dictation.
2. **Prompt-artifact contamination** (`Preserve the following ...`) in a subset of transcripts.
3. **Rare severe CoT/meta leakage** (`<think> ...`) still escaping after retry/repair path.
4. **Post-repair phrasing corruption** in long dictation segments (semantics mostly retained but degraded precision).

## Priority Fix List (from manual review)

1. `block_cot_meta`
   - Hard-block `<think>` and internal reasoning/meta scaffolds at final output gate.
2. `token_injection_guard`
   - Reject or sanitize isolated injected filename/command token bursts not grounded in both sources.
3. `tighten_repair_prompt`
   - Strengthen repair prompt to forbid instruction/meta text and force transcript-only output.
4. `post_repair_revalidate`
   - Revalidate repaired output with stricter leakage checks before save.
5. `source_grounding_guard`
   - Add source-token grounding check to reduce unrelated carry-over blocks.
6. `weak_source_no_speech`
   - For tiny/contradictory source pairs, prefer deterministic no-speech/fallback over aggressive LLM repair.

---

## Batch A (2026-05-13 to 2026-05-14)

| timestamp | quality | leakage_type | fix_tag | note |
|---|---|---|---|---|
| 2026-05-13T01:56:07.227Z | minor_issue | none | - | Mostly clear intent, but the ending trails off into an incomplete phrase. |
| 2026-05-13T01:58:13.863Z | clean | none | - | Clear and coherent request about low-battery notifications and thresholds. |
| 2026-05-13T02:13:29.324Z | clean | none | - | Transcript is understandable with consistent meaning despite natural speech fillers. |
| 2026-05-13T02:50:18.325Z | clean | none | - | Clear task framing and no visible leakage artifacts. |
| 2026-05-13T03:18:50.629Z | clean | none | - | Technical question is preserved well with only minor conversational roughness. |
| 2026-05-13T03:21:15.019Z | clean | none | - | Multi-part request remains coherent and actionable. |
| 2026-05-13T03:52:23.345Z | clean | none | - | Accurate short instruction with no obvious hallucinated content. |
| 2026-05-13T04:07:01.972Z | clean | none | - | Very short but clean command-like utterance. |
| 2026-05-13T05:54:45.829Z | minor_issue | other | weak_source_no_speech | The phrase is partial/incomplete and likely clipped at utterance boundary. |
| 2026-05-13T05:55:23.417Z | clean | none | - | Fully intelligible request with no artifacting. |
| 2026-05-13T06:05:37.508Z | clean | none | - | Concise technical instruction captured correctly. |
| 2026-05-13T06:13:48.971Z | clean | none | - | Short prompt preserved with no artifact leakage. |
| 2026-05-13T06:24:11.326Z | clean | none | - | Long transcript stays coherent and structurally intact. |
| 2026-05-13T06:25:09.574Z | clean | none | - | Clear request and intent preserved. |
| 2026-05-13T07:11:02.534Z | clean | none | - | Security-review request is accurately transcribed. |
| 2026-05-13T07:28:38.871Z | clean | none | - | Complex idea is noisy but semantically consistent and usable. |
| 2026-05-13T07:31:04.131Z | major_issue | prompt-artifact | tighten_repair_prompt | The ending contains injected instruction text (“Preserve the following terms...”) unrelated to spoken intent. |
| 2026-05-13T07:47:01.623Z | clean | none | - | Clear actionable request with no leakage markers. |
| 2026-05-13T07:51:34.194Z | clean | none | - | Coherent and context-aligned creative/diagram request. |
| 2026-05-13T08:32:42.711Z | clean | none | - | Message is understandable and free of obvious artifacts. |
| 2026-05-13T10:04:29.693Z | clean | none | - | Short planning instruction is clean. |
| 2026-05-13T10:04:35.975Z | clean | none | - | Simple imperative transcript is accurate. |
| 2026-05-13T10:31:44.298Z | clean | none | - | Multi-step instruction remains clear and grounded. |
| 2026-05-13T12:44:08.334Z | major_issue | prompt-artifact | tighten_repair_prompt | Includes injected meta phrase (“Preserve the following terms...”) that does not fit the user request. |
| 2026-05-13T12:46:20.674Z | major_issue | prompt-artifact | tighten_repair_prompt | Contains spurious prompt-like directive (“Preserve the following commands...”) appended to otherwise valid speech. |
| 2026-05-13T12:48:49.068Z | clean | none | - | Long utterance is noisy but meaningful and consistent. |
| 2026-05-13T13:09:17.623Z | clean | none | - | Short question captured correctly. |
| 2026-05-13T13:11:25.850Z | clean | none | - | Clear request and intent preserved. |
| 2026-05-13T13:33:40.743Z | clean | none | - | Transcript remains coherent across a long command. |
| 2026-05-13T13:44:59.993Z | clean | none | - | Clean query with no visible leakage. |
| 2026-05-13T17:22:45.131Z | minor_issue | other | weak_source_no_speech | Utterance is truncated mid-sentence and loses essential context. |
| 2026-05-13T17:23:05.155Z | clean | none | - | Follow-up request is understandable and complete. |
| 2026-05-14T02:38:16.984Z | clean | none | - | Clear kickoff instruction for repo initialization workflow. |
| 2026-05-14T02:54:39.204Z | clean | none | - | Clean planning request with minor filler only. |
| 2026-05-14T03:11:37.088Z | major_issue | prompt-artifact | tighten_repair_prompt | Transcript contains multiple injected prompt-like fragments (“Preserve...”) and malformed inserted tokens. |
| 2026-05-14T03:16:32.071Z | clean | none | - | Coherent clarification and direction without leakage. |
| 2026-05-14T03:17:49.104Z | minor_issue | none | - | Intent is clear, though filename phrase is slightly garbled (`plan.mb`). |
| 2026-05-14T03:53:48.471Z | minor_issue | other | weak_source_no_speech | Command is cut off mid-clause and lacks the intended branch name/details. |
| 2026-05-14T03:57:19.766Z | clean | none | - | Long instruction remains contextually consistent and usable. |
| 2026-05-14T03:58:50.905Z | clean | none | - | Clear sequencing instruction with no artifact patterns. |
| 2026-05-14T04:12:02.661Z | clean | none | - | Request is coherent and matches expected analysis context. |
| 2026-05-14T05:20:23.833Z | clean | none | - | Detailed quality-review instruction is preserved with acceptable disfluencies. |
| 2026-05-14T05:52:18.510Z | clean | none | - | Short question is correctly captured. |
| 2026-05-14T05:53:38.496Z | clean | none | - | Clear, concise model-selection request. |
| 2026-05-14T06:03:56.029Z | clean | none | - | Simple audibility check transcribed correctly. |
| 2026-05-14T06:15:43.677Z | clean | none | - | Multi-step branch/commit instruction is intelligible. |
| 2026-05-14T06:17:02.775Z | major_issue | other | post_repair_revalidate | Transcript shows duplicated numbered sections and repetition drift, indicating merge/repair instability. |
| 2026-05-14T06:20:07.961Z | clean | none | - | Complex feature proposal is long but coherent and grounded. |
| 2026-05-14T06:24:49.295Z | clean | none | - | Clear implementation and DB cleanup instruction. |
| 2026-05-14T06:27:53.934Z | clean | none | - | Long planning message is noisy but coherent and grounded. |
| 2026-05-14T06:28:54.600Z | clean | none | - | Clean concise instruction. |
| 2026-05-14T06:36:22.979Z | clean | none | - | Audibility check is accurate. |
| 2026-05-14T06:37:21.253Z | clean | none | - | Clear next-step command with minor typo preserved naturally. |
| 2026-05-14T06:39:23.482Z | clean | none | - | Short coordination question captured correctly. |
| 2026-05-14T06:40:27.614Z | clean | none | - | Clear prioritization instruction with no leakage signs. |
| 2026-05-14T06:45:50.065Z | clean | none | - | Direct question is transcribed accurately. |
| 2026-05-14T06:49:55.689Z | clean | none | - | Very short question preserved correctly. |
| 2026-05-14T06:57:28.564Z | major_issue | other | source_grounding_guard | Mid/late segment drifts into unrelated hallucinated phrases and malformed topic jumps. |
| 2026-05-14T07:02:12.063Z | severe_issue | cot/meta | block_cot_meta | Full chain-of-thought style internal reasoning is leaked directly into transcript text. |
| 2026-05-14T07:41:01.286Z | clean | none | - | Clear bug report with coherent flow. |
| 2026-05-14T09:07:38.932Z | clean | none | - | Long planning statement is understandable and context-consistent. |
| 2026-05-14T09:12:54.641Z | minor_issue | other | post_repair_revalidate | Mostly usable but has heavy disfluency/repetition and local phrase corruption near the end. |
| 2026-05-14T11:14:51.212Z | clean | none | - | Clear technical explanation request. |
| 2026-05-14T11:42:40.506Z | clean | none | - | Test-run statement is coherent; file names/tokens are preserved correctly. |
| 2026-05-14T12:36:53.992Z | clean | none | - | Long instruction is coherent with no obvious leakage artifacts. |

Batch A summary:

- clean: 53
- minor_issue: 7
- major_issue: 7
- severe_issue: 1

---

## Batch B (2026-05-15 to 2026-05-16)

| timestamp | quality | leakage_type | fix_tag | note |
|---|---|---|---|---|
| 2026-05-15T02:17:40.006Z | clean | none | - | Clear task instruction about import/validation flow with no leakage markers. |
| 2026-05-15T03:02:43.422Z | clean | none | - | Short and coherent request about selecting the right SSH public key. |
| 2026-05-15T03:46:25.074Z | clean | none | - | Transcript is clear and semantically consistent about checking an upload issue screenshot. |
| 2026-05-15T04:19:45.414Z | minor_issue | other | post_repair_revalidate | Utterance is incomplete/trailing but still understandable as a transition into next task. |
| 2026-05-15T04:25:37.112Z | clean | none | - | Multi-step planning dictation is long but coherent and usable. |
| 2026-05-15T06:47:06.862Z | clean | none | - | Clean conversational sentence with no artifact leakage. |
| 2026-05-15T06:47:30.985Z | clean | none | - | Clean sentence and intent preserved. |
| 2026-05-15T08:09:10.199Z | clean | none | - | Clear technical ask with constraints preserved. |
| 2026-05-15T08:10:57.240Z | clean | none | - | Long but coherent workflow question with no visible transcript pollution. |
| 2026-05-15T08:13:50.874Z | clean | none | - | Clear direct message text with no leakage patterns. |
| 2026-05-15T08:30:10.205Z | clean | none | - | Short instruction captured accurately and cleanly. |
| 2026-05-15T08:31:52.575Z | clean | none | - | Detailed planning instruction remains coherent and artifact-free. |
| 2026-05-15T08:32:35.149Z | clean | none | - | Request is clear and semantically intact. |
| 2026-05-15T08:40:31.102Z | clean | none | - | Long operational instruction remains coherent without leakage signatures. |
| 2026-05-15T08:48:54.865Z | clean | none | - | Complex instruction is still readable and semantically consistent. |
| 2026-05-15T08:50:43.074Z | clean | none | - | Clean short status instruction. |
| 2026-05-15T09:08:42.330Z | clean | none | - | Structured checklist transcription is accurate and clear. |
| 2026-05-15T11:51:31.870Z | clean | none | - | Clear multi-step instruction with no artifact or hallucination markers. |
| 2026-05-15T12:13:40.982Z | clean | none | - | Short clean conversational line. |
| 2026-05-15T12:22:49.431Z | major_issue | injected-file-cmd | token_injection_guard | Mid-transcript contains spurious file mentions (e.g., `Test-audio.mp3`) and semantic drift noise. |
| 2026-05-15T12:26:12.035Z | severe_issue | injected-file-cmd | token_injection_guard | Strong corruption with repeated gibberish tokens plus injected file/command-like strings at tail. |
| 2026-05-15T12:50:06.363Z | clean | none | - | Image-generation request is coherent and cleanly transcribed. |
| 2026-05-15T13:12:03.974Z | clean | none | - | Coherent prompt refinement request with no obvious leakage. |
| 2026-05-15T13:47:41.850Z | clean | none | - | Simple branch-creation instruction captured correctly. |
| 2026-05-15T13:49:20.638Z | clean | none | - | Long task description remains coherent and actionable. |
| 2026-05-15T13:56:02.153Z | clean | none | - | Clear operational instruction about docs/readme normalization. |
| 2026-05-15T13:58:05.697Z | minor_issue | other | post_repair_revalidate | Mostly usable but has small lexical corruption (`design.mp`, `product.mp`) likely ASR repair artifacts. |
| 2026-05-15T14:10:53.512Z | clean | none | - | Detailed UI task is coherent and free from leakage artifacts. |
| 2026-05-15T14:18:28.616Z | clean | none | - | Strongly worded but semantically clear redesign directive. |
| 2026-05-15T14:29:55.169Z | major_issue | other | post_repair_revalidate | Contains multiple broken phrases and sentence-fragment drift reducing reliability of intent details. |
| 2026-05-15T14:34:17.861Z | minor_issue | other | post_repair_revalidate | Generally understandable but includes ASR substitutions (`BSO`) and rough phrasing. |
| 2026-05-15T14:46:15.285Z | minor_issue | other | post_repair_revalidate | Largely coherent but has minor phrase corruption around feature-bundling instructions. |
| 2026-05-15T15:24:01.935Z | major_issue | injected-file-cmd | token_injection_guard | Includes non-contextual command/file-like garbage (`Test.audio...`) embedded in valid instruction. |
| 2026-05-15T15:46:13.126Z | clean | none | - | Clear stacked-PR request with preserved meaning. |
| 2026-05-15T16:06:56.823Z | major_issue | injected-file-cmd | token_injection_guard | Ends with unrelated injected file tokens after valid PR instruction. |
| 2026-05-15T16:28:05.496Z | minor_issue | other | post_repair_revalidate | Meaning mostly preserved but includes lexical corruption (`new Shai, Halu`). |
| 2026-05-15T16:35:01.899Z | clean | none | - | Clean short instruction. |
| 2026-05-16T02:09:56.088Z | clean | none | - | Coherent feedback request with no leakage indicators. |
| 2026-05-16T02:13:05.414Z | minor_issue | other | post_repair_revalidate | Intent is clear but includes likely misrecognition (`charge equity`). |
| 2026-05-16T04:00:36.019Z | minor_issue | other | post_repair_revalidate | Mostly clear but command token (`SSH TRANS`) appears mistranscribed/ambiguous. |
| 2026-05-16T04:02:18.085Z | clean | none | - | Clear procedural instruction with good sentence integrity. |
| 2026-05-16T04:18:39.205Z | major_issue | injected-file-cmd | token_injection_guard | Long segment has semantic drift and appended injected file strings repeated at tail. |
| 2026-05-16T04:21:21.942Z | minor_issue | other | post_repair_revalidate | Core intent is clear but branch name phrase is slightly mangled. |
| 2026-05-16T04:36:20.383Z | clean | none | - | Clear review request and planning ask. |
| 2026-05-16T04:37:10.480Z | clean | none | - | Coherent design direction request with no artifact leakage. |
| 2026-05-16T04:46:00.833Z | clean | none | - | Structured instruction preserved clearly. |
| 2026-05-16T04:51:57.405Z | clean | none | - | Question is coherent and semantically intact. |
| 2026-05-16T04:53:19.127Z | clean | none | - | Follow-up clarification captured clearly. |
| 2026-05-16T04:55:34.224Z | minor_issue | other | post_repair_revalidate | Understandable request with proper-noun ASR distortions. |
| 2026-05-16T04:57:12.654Z | clean | none | - | Clarification about usage-limit model is coherent. |
| 2026-05-16T04:58:13.439Z | clean | none | - | Clear timing clarification with no leakage evidence. |
| 2026-05-16T05:15:20.649Z | major_issue | injected-file-cmd | token_injection_guard | Ends with unrelated injected file tokens despite coherent canary-deployment plan. |
| 2026-05-16T07:47:57.794Z | clean | none | - | Clean short question. |
| 2026-05-16T07:49:47.810Z | clean | none | - | Coherent operational correction about docs flow and branching. |
| 2026-05-16T08:01:24.750Z | clean | none | - | Clean verification question with no artifacts. |
| 2026-05-16T08:04:17.413Z | major_issue | injected-file-cmd | token_injection_guard | Long valid instruction is contaminated by appended unrelated file tokens at tail. |
| 2026-05-16T08:11:00.422Z | clean | none | - | Clear product behavior question. |
| 2026-05-16T08:11:09.757Z | clean | none | - | Clean short question. |
| 2026-05-16T08:22:54.659Z | major_issue | injected-file-cmd | token_injection_guard | Contains valid UI feedback but includes injected file token sequence mid-text. |
| 2026-05-16T09:10:38.635Z | minor_issue | other | post_repair_revalidate | Mostly coherent but has lexical disfluencies and malformed phrases reducing precision. |
| 2026-05-16T09:29:51.571Z | clean | none | - | Clear mobile/PWA feedback and action request. |
| 2026-05-16T09:40:40.144Z | clean | none | - | Clean short clarification request. |
| 2026-05-16T09:40:51.258Z | clean | none | - | Clean short clarification request. |
| 2026-05-16T09:41:46.946Z | clean | none | - | Clear directive to rename and redeploy. |
| 2026-05-16T09:44:22.076Z | clean | none | - | Clear PR-thread resolution instruction. |
| 2026-05-16T09:49:13.386Z | clean | none | - | Long feature request remains coherent and structurally sound. |
| 2026-05-16T09:52:30.887Z | minor_issue | other | post_repair_revalidate | OCR-output idea is understandable but text has sentence-level noise and repair drift. |
| 2026-05-16T09:53:10.856Z | clean | none | - | Clear PR issue-resolution instruction. |
| 2026-05-16T10:36:04.830Z | minor_issue | other | post_repair_revalidate | Intent is clear but includes small lexical oddities. |
| 2026-05-16T11:10:26.236Z | clean | none | - | Clear summarization request. |
| 2026-05-16T11:11:20.720Z | clean | none | - | Coherent follow-up with no leakage signs. |
| 2026-05-16T12:26:59.406Z | clean | none | - | Clean project kickoff instruction. |
| 2026-05-16T13:25:37.744Z | clean | none | - | Coherent corrective feedback and cleanup instruction. |
| 2026-05-16T13:28:08.549Z | clean | none | - | Clear release-note task with preserved intent. |
| 2026-05-16T13:37:51.992Z | clean | none | - | Clear branch/review workflow instruction. |
| 2026-05-16T14:12:46.003Z | clean | none | - | Coherent ideation request for book-writing workflow. |
| 2026-05-16T14:14:28.703Z | minor_issue | other | post_repair_revalidate | Meaning is preserved but includes minor phrase corruption near the ending. |
| 2026-05-16T14:15:27.383Z | clean | none | - | Clean concise objective statement. |
| 2026-05-16T14:17:00.217Z | minor_issue | other | post_repair_revalidate | Mostly clear, with minor lexical corruption (`Sim link`) in execution details. |
| 2026-05-16T14:20:10.739Z | clean | none | - | Clear conversational workflow direction. |
| 2026-05-16T14:54:26.867Z | clean | none | - | Coherent database-related feedback with no leakage markers. |
| 2026-05-16T15:24:11.634Z | minor_issue | other | post_repair_revalidate | Intent is understandable but phrasing is noisy and partially ungrammatical in the middle. |
| 2026-05-16T16:04:24.898Z | clean | none | - | Clear bug-report style request. |
| 2026-05-16T16:16:44.569Z | clean | none | - | Detailed database review ask remains coherent and usable. |

Batch B summary:

- clean: 58
- minor_issue: 17
- major_issue: 8
- severe_issue: 1

---

## Batch C (2026-05-17 to 2026-05-18)

| timestamp | quality | leakage_type | fix_tag | note |
|---|---|---|---|---|
| 2026-05-17T05:24:15.502Z | clean | none | - | Clear UI-feedback dictation with coherent intent and no leakage artifacts. |
| 2026-05-17T06:06:30.608Z | clean | none | - | Transcript is long but semantically consistent and task-specific throughout. |
| 2026-05-17T08:23:10.456Z | clean | none | - | Clean personal-history statement with good sentence continuity. |
| 2026-05-17T08:35:29.051Z | clean | none | - | Natural explanation of workflow usage with no prompt or token artifacts. |
| 2026-05-17T08:49:20.840Z | clean | none | - | Coherent process description with only minor spoken-style repetition. |
| 2026-05-17T08:52:02.372Z | clean | none | - | Clear prototype-first instruction without hallucinated suffixes. |
| 2026-05-17T08:53:30.526Z | clean | none | - | Structured procedural guidance, no leakage patterns detected. |
| 2026-05-17T13:09:39.964Z | clean | none | - | Content is noisy but meaning is preserved and grounded in task context. |
| 2026-05-17T14:25:49.288Z | clean | none | - | Clean planning request with consistent API-focused context. |
| 2026-05-17T14:28:47.498Z | clean | none | - | Detailed commit/PR strategy is transcribed accurately and coherently. |
| 2026-05-18T03:59:04.764Z | clean | none | - | Short and clear planning instruction with no artifact leakage. |
| 2026-05-18T04:06:39.125Z | major_issue | injected-file-cmd | token_injection_guard | Mid-utterance injection (`test-audio.mp3, benchmark-audio.ts`) breaks semantic flow and appears non-speech noise. |
| 2026-05-18T05:05:59.585Z | major_issue | injected-file-cmd | token_injection_guard | Repeated filename tokens are appended inside normal dictation and clearly not part of user intent. |
| 2026-05-18T06:10:17.823Z | clean | none | - | Coherent analysis-phase instruction with no leakage signatures. |
| 2026-05-18T06:10:48.096Z | clean | none | - | Short workflow correction transcribed cleanly despite colloquial phrasing. |
| 2026-05-18T06:11:27.433Z | clean | none | - | Clear UI-review request with consistent context and no artifacts. |
| 2026-05-18T06:12:38.089Z | clean | none | - | Harsh tone but transcript itself is accurate and context-aligned. |
| 2026-05-18T06:26:28.376Z | clean | none | - | Plain operational instruction with good continuity and no injected strings. |
| 2026-05-18T06:34:50.834Z | major_issue | injected-file-cmd | token_injection_guard | Filename pair is spuriously appended at the end of otherwise valid instructions. |
| 2026-05-18T06:36:56.827Z | clean | none | - | Slightly disfluent but still semantically faithful and free of leakage artifacts. |
| 2026-05-18T06:38:52.408Z | major_issue | injected-file-cmd | token_injection_guard | Contains duplicated blocks and injected filename tokens, indicating contamination in decoded text. |
| 2026-05-18T07:05:53.391Z | clean | none | - | Strongly worded but coherent step-specific feedback with no prompt artifacts. |
| 2026-05-18T07:07:08.739Z | severe_issue | injected-file-cmd | token_injection_guard | Transcript degrades into a long burst of fake file/URL-like tokens, overwhelming usable content. |
| 2026-05-18T08:18:33.292Z | clean | none | - | Understandable planning request with no leakage signatures. |
| 2026-05-18T08:48:52.591Z | clean | none | - | Mostly clean repo-maintenance instruction with coherent intent. |
| 2026-05-18T10:11:15.236Z | clean | none | - | Clear bug report about upload/scan behavior and expected outcome. |
| 2026-05-18T10:12:40.240Z | clean | none | - | Concise follow-up bug statement with preserved semantics. |
| 2026-05-18T10:46:45.017Z | major_issue | injected-file-cmd | token_injection_guard | Includes unrelated filename token sequence injected into an otherwise coherent request. |
| 2026-05-18T13:59:30.294Z | clean | none | - | Minimal but clean directive without leakage evidence. |
| 2026-05-18T14:01:14.726Z | clean | none | - | Long instruction remains coherent and grounded with no artifact contamination. |
| 2026-05-18T16:17:03.518Z | major_issue | injected-file-cmd | token_injection_guard | Non-context filename tokens appear inline and reduce transcript trustworthiness. |
| 2026-05-18T16:20:25.981Z | clean | none | - | Brief implementation instruction transcribed cleanly. |
| 2026-05-18T16:29:38.239Z | major_issue | injected-file-cmd | token_injection_guard | Appended filename token pair is unrelated to the spoken OAuth/landing-page request. |
| 2026-05-18T16:30:20.135Z | clean | none | - | Clean follow-up on auth/image workflow with no detectable leakage. |
| 2026-05-18T16:57:01.067Z | clean | none | - | Operational git instruction is clear and artifact-free. |
| 2026-05-18T17:01:02.078Z | clean | none | - | Coherent landing-page critique and constraints, no leakage markers. |
| 2026-05-18T17:09:12.888Z | minor_issue | cot/meta | block_cot_meta | Mentions internal agent-skill execution (“use impeccable skill”) which is meta-instruction leakage into transcript text. |
| 2026-05-18T17:25:41.491Z | clean | none | - | Clear design preference query with preserved meaning. |
| 2026-05-18T17:48:39.501Z | major_issue | injected-file-cmd | token_injection_guard | Filename token injection appears mid-request and is not semantically grounded. |
| 2026-05-18T17:54:46.011Z | clean | none | - | Valid frontend-data critique and request for field pruning analysis. |
| 2026-05-18T17:57:26.999Z | major_issue | injected-file-cmd | token_injection_guard | Ends with injected filename tokens after otherwise coherent API/frontend cleanup instructions. |

Batch C summary:

- clean: 31
- minor_issue: 1
- major_issue: 8
- severe_issue: 1

---

## Batch D (2026-05-19)

| timestamp | quality | leakage_type | fix_tag | note |
|---|---|---|---|---|
| 2026-05-19T09:03:20.170Z | clean | none | - | Clear task description end-to-end with only normal spoken disfluency. |
| 2026-05-19T10:08:20.023Z | minor_issue | other | post_repair_revalidate | Meaning is mostly recoverable but wording has noticeable recognition drift. |
| 2026-05-19T12:48:38.189Z | minor_issue | prompt-artifact | tighten_repair_prompt | Core request is intact but includes likely artifact tail (`test-audio.txt...`). |
| 2026-05-19T15:28:08.468Z | clean | none | - | Transcript is coherent and complete with no visible leakage. |
| 2026-05-19T15:42:54.430Z | clean | none | - | Short utterance is accurate and clean. |
| 2026-05-19T15:43:21.297Z | clean | none | - | Fully coherent instruction with no leakage markers. |
| 2026-05-19T15:47:46.391Z | clean | none | - | Clear actionable request, no artifacts observed. |
| 2026-05-19T16:09:15.895Z | clean | none | - | Intent is preserved and text quality is clean. |
| 2026-05-19T16:25:30.817Z | clean | none | - | Coherent argumentative prompt without obvious transcription corruption. |
| 2026-05-19T16:29:59.285Z | minor_issue | other | post_repair_revalidate | Main intent is understandable but several terms are mistranscribed. |
| 2026-05-19T16:32:46.296Z | clean | none | - | Long-form instruction remains coherent and semantically consistent. |
| 2026-05-19T16:43:40.560Z | minor_issue | prompt-artifact | tighten_repair_prompt | Mostly good transcript but ends with likely injected file-name artifact. |
| 2026-05-19T16:45:17.135Z | clean | none | - | Quality is good with natural speech fillers only. |
| 2026-05-19T16:50:58.086Z | severe_issue | cot/meta | block_cot_meta | Output leaks internal chain-of-thought (`<think> ...`) instead of user speech transcript. |
| 2026-05-19T16:51:48.489Z | clean | none | - | Clear request and no leakage/hallucination signatures. |
| 2026-05-19T17:38:35.251Z | clean | none | - | Short directive is accurate and clean. |
| 2026-05-19T17:47:43.333Z | clean | none | - | Coherent planning request with no obvious artifacts. |
| 2026-05-19T18:03:34.339Z | major_issue | prompt-artifact | source_grounding_guard | After an understandable first paragraph, transcript appends a large nonsensical token block/file-like strings. |

Batch D summary:

- clean: 12
- minor_issue: 4
- major_issue: 1
- severe_issue: 1
