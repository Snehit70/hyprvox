# Hyprvox Merge Model Evaluation

**Generated:** 2026-05-14T06:22:34.442Z  
**Models tested:** llama-3.3-70b-versatile, openai/gpt-oss-120b  
**Cases tested:** 120, 145, 158, 160, 203, 210  
**Method:** Compare current saved Qwen output against model outputs generated from current Qwen final text plus reconstructed Deepgram streaming chunks. Full Groq/Whisper source text is not available in historical logs because current code logs only Groq text length.

## Summary

| Model | Successful calls | Avg time ms | Preserve artifacts | Outro suffixes | Mixed script |
|---|---:|---:|---:|---:|---:|
| llama-3.3-70b-versatile | 6/6 | 509 | 0 | 0 | 0 |
| openai/gpt-oss-120b | 6/6 | 1502 | 0 | 0 | 1 |

Successful calls: 12/12

## Notes

- This is not a perfect replay of the original merge because historical logs do not contain full Groq/Whisper text.
- Deepgram chunks and current Qwen final outputs came from production history and are intentionally not embedded in this repository artifact.
- Raw case transcripts should remain in the local history/log archive only, not in git.
- The script intentionally uses minimal Groq parameters: model, messages, temperature, and max_tokens.
- Calls are throttled with sleep between requests to avoid rate limits.

## Case Results

| Case | Observed issue | Qwen flags | llama-3.3-70b-versatile flags | openai/gpt-oss-120b flags | Notes |
|---:|---|---|---|---|---|
| 120 | preserve_artifact | `preserveArtifact=true` | clean | clean | Both tested models removed the prompt-artifact phrase. |
| 145 | preserve_artifact | `preserveArtifact=true` | clean | `mixedScript=true` | GPT OSS output was flagged by the original evaluator because smart quotes were treated as non-ASCII; this is fixed in the script. |
| 158 | outro_suffix | `outroSuffix=true` | clean | clean | Both tested models removed the detached outro/link suffix. |
| 160 | outro_suffix | `outroSuffix=true` | clean | clean | Both tested models removed the detached outro suffix. |
| 203 | preserve_artifact | `preserveArtifact=true` | clean | clean | Both tested models removed the prompt-artifact phrase. |
| 210 | preserve_artifact | `preserveArtifact=true` | clean | clean | Both tested models removed the prompt-artifact phrase. |

## Conclusion

- Both candidate models completed all calls successfully.
- `llama-3.3-70b-versatile` was faster in this sample.
- The evaluation method remains approximate until future logs include both exact Groq source transcripts and Deepgram chunks for replay.
