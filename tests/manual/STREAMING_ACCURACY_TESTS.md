# Streaming Accuracy Test Suite

**Purpose**: Compare transcription accuracy between batch mode and streaming mode.

**Instructions**:
1. Read each test sentence naturally at normal speaking pace
2. Record using voice-cli and note the transcribed output
3. Mark accuracy: EXACT (100%), MINOR (1-2 word differences), MAJOR (meaning changed)

---

## Test Categories

### Category 1: Simple Sentences (Baseline)

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| S1 | Hello, how are you today? | | | |
| S2 | The weather is nice outside. | | | |
| S3 | I need to buy some groceries. | | | |
| S4 | Please send me the report by Friday. | | | |
| S5 | The meeting starts at three o'clock. | | | |

---

### Category 2: Numbers and Dates

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| N1 | My phone number is 555-123-4567. | | | |
| N2 | The appointment is on January 23rd, 2026. | | | |
| N3 | The total cost is $1,234.56. | | | |
| N4 | We need 15 units by March 10th. | | | |
| N5 | The flight departs at 7:45 AM from gate B12. | | | |

---

### Category 3: Technical Terms and Jargon

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| T1 | The API endpoint returns a JSON response. | | | |
| T2 | We use WebSocket for real-time streaming. | | | |
| T3 | The TypeScript compiler found three errors. | | | |
| T4 | Deploy the Docker container to Kubernetes. | | | |
| T5 | The PostgreSQL database needs to be migrated. | | | |

---

### Category 4: Names and Proper Nouns

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| P1 | I spoke with Michael Johnson yesterday. | | | |
| P2 | The package was shipped via FedEx to California. | | | |
| P3 | She works at Google in Mountain View. | | | |
| P4 | The Tesla Model 3 has great range. | | | |
| P5 | We're using Deepgram and Groq for transcription. | | | |

---

### Category 5: Complex Sentences with Punctuation

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| C1 | First, open the file; then, edit the configuration. | | | |
| C2 | He said, "The project is on track," but I'm not sure. | | | |
| C3 | The options are: red, blue, green, or yellow. | | | |
| C4 | Wait—I think there's a problem with the server! | | | |
| C5 | Is this the right approach? I believe so, yes. | | | |

---

### Category 6: Long Sentences with Natural Pauses

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| L1 | I'm testing the voice transcription system to measure latency. [pause] The current implementation sends the entire audio file after I stop recording. | | | |
| L2 | The main advantage of streaming [pause] is that processing happens in parallel with recording [pause] which reduces the wait time significantly. | | | |
| L3 | First, we need to establish a WebSocket connection. [pause] Then, we send audio chunks as they arrive. [pause] Finally, we collect the transcription results. | | | |

---

### Category 7: Homophones and Ambiguous Words

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| H1 | Their car is over there, and they're waiting. | | | |
| H2 | I want to write the right code right now. | | | |
| H3 | The bass player caught a bass while fishing. | | | |
| H4 | I read the book that he read yesterday. | | | |
| H5 | The wind will wind down by evening. | | | |

---

### Category 8: Fast Speech (read quickly)

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| F1 | Quick brown fox jumps over the lazy dog. | | | |
| F2 | Peter Piper picked a peck of pickled peppers. | | | |
| F3 | She sells seashells by the seashore. | | | |
| F4 | How much wood would a woodchuck chuck. | | | |

---

### Category 9: Edge Cases

| ID | Expected Text | Batch Result | Streaming Result | Notes |
|----|---------------|--------------|------------------|-------|
| E1 | Hmm, let me think about that for a moment. | | | |
| E2 | Uh, I'm not quite sure what you mean. | | | |
| E3 | [whisper] This is a quiet sentence. | | | |
| E4 | ONE TWO THREE FOUR FIVE! [shouted] | | | |

---

## Scoring Guide

| Score | Criteria |
|-------|----------|
| EXACT | 100% match, including punctuation |
| MINOR | 1-2 word differences, meaning preserved |
| CLOSE | 3-5 word differences, meaning mostly preserved |
| MAJOR | Meaning changed or significant errors |
| FAIL | Completely wrong or unintelligible |

---

## Summary Table

| Category | Batch Accuracy | Streaming Accuracy | Notes |
|----------|----------------|-------------------|-------|
| Simple Sentences | /5 | /5 | |
| Numbers and Dates | /5 | /5 | |
| Technical Terms | /5 | /5 | |
| Names and Proper Nouns | /5 | /5 | |
| Complex Sentences | /5 | /5 | |
| Long with Pauses | /3 | /3 | |
| Homophones | /5 | /5 | |
| Fast Speech | /4 | /4 | |
| Edge Cases | /4 | /4 | |
| **TOTAL** | **/41** | **/41** | |

---

## Latency Measurements

| Test ID | Recording Length | Batch Latency (after stop) | Streaming Latency (after stop) |
|---------|------------------|---------------------------|-------------------------------|
| L1 | ~10s | | |
| L2 | ~15s | | |
| L3 | ~20s | | |
| Long recording | ~60s | | |

---

## Test Date and Configuration

- **Date**: ___________
- **voice-cli version**: 1.0.0
- **Branch**: feat/improve_speed
- **Mode**: [ ] Batch / [ ] Streaming
- **Deepgram Model**: nova-3
- **Groq Model**: whisper-large-v3
- **Config Streaming Enabled**: [ ] Yes / [ ] No

---

## Notes

_Use this section for observations during testing._

```text
[Add notes here]
```
