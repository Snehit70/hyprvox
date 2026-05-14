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
- Deepgram chunks and current Qwen final outputs are real production data.
- The script intentionally uses minimal Groq parameters: model, messages, temperature, and max_tokens.
- Calls are throttled with sleep between requests to avoid rate limits.

## Case Results

### Case 120: preserve_artifact

Timestamp: 2026-05-08T12:24:09.670Z  
Duration: 62s  
Input chars: Qwen 422, Deepgram 193

#### Current Qwen Final

Flags: {"preserveArtifact":true,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Here is how the situation goes. I am on the doctor's site and I click to complete the case. Now what will happen is that, from our scene, if I complete a case, what will happen is that, from doctor's end, a new chart will be created, an empty chart with the same patient. Preserve the following terms in the following order. This is the core of the issue. If you do not understand the explanation, I can repeat it for you.

#### llama-3.3-70b-versatile

Time: 749ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Here is how the situation goes. I am on the doctor's site and I click to complete the case. Now what will happen is that, from our scene, if I complete a case, what will happen is that, from doctor's end, a new chart will be created, an empty chart with the same patient. This is the core of the issue. If you do not understand the explanation, I can repeat it for you. I'm on the doctor's side, and I click complete the case. A new chart will be created, empty chart with the same patient, to the same person.

#### openai/gpt-oss-120b

Time: 1405ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Here is how the situation goes. I'm on the doctor's side, and I click to complete the case. I am on the doctor's site and I click to complete the case. Now what will happen is that, from our scene, if I complete a case, a new chart will be created, an empty chart with the same patient. To the same person. Don't know. It did happen because. This is the core of the issue. If you do not understand the explanation, I can repeat it for you.

---

### Case 145: preserve_artifact

Timestamp: 2026-05-11T07:56:45.591Z  
Duration: 35s  
Input chars: Qwen 542, Deepgram 552

#### Current Qwen Final

Flags: {"preserveArtifact":true,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Here is the next issue that I see. After I send, I think at starting conversation, I see AI is thinking whatever box you see. But I think after either payment or after sending an image, I just stop seeing the AI is thinking part. Like, I just like, I'm just waiting for something. I should just see a cue, no? Like, okay, AI is thinking until I see a reply or something from AI. And then the AI thinking stops. See the whole how the AI thinking, AI is thinking like part wholly being read. Preserve the following terms in the following order.

#### llama-3.3-70b-versatile

Time: 490ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Here is the next issue that I see. After I send, I think at starting conversation, I see AI is thinking whatever box you see. But I think after either payment or after sending an image, I just stopped seeing the AI's thinking part, like, I just like, I'm just waiting for something. I should just see a cue, no? Like, okay, AI is thinking until I see a reply or something from AI. And then the AI thinking stops. See the whole how the AI thinking, AI is thinking, like, part wholly being read. And how it can be fixed.

#### openai/gpt-oss-120b

Time: 1616ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":true,"mentionsTranscriptMeta":false}

Here is the next issue that I see. After I start a conversation, I see the AI is thinking in whatever box you see. But after either payment or after sending an image, I just stop seeing the AI's thinking part. I'm just waiting for something, just a queue, not a cue like “AI is thinking” until I see a reply from the AI. Then the AI thinking stops. See the whole how the AI thinking works, the AI is thinking like a part holding render and rendered, and what the issues are in that and how it can be fixed.

---

### Case 158: outro_suffix

Timestamp: 2026-05-11T09:40:09.619Z  
Duration: 63s  
Input chars: Qwen 696, Deepgram 289

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":true,"mixedScript":false,"mentionsTranscriptMeta":false}

So here is the next task that I want you to understand and do. See what sections of it can be improved, and like how it can be improved and other things. And most importantly, what I want to really improve is this. For PDFs. Okay? If you can do that, let me know and how what changes you will do and what commits you will do. Currently, there is a Rofi script for, I think, Super B. It's for library books or whatever. See what sections of it can be improved, and like how it can be improved and other things. And most importantly, what I want to be, what I want to really improve is this. If you want to know more about the software development process, please visit the link in the description.

#### llama-3.3-70b-versatile

Time: 446ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

So here is the next task that I want you to understand and do. See what sections of it can be improved. And, like, how it can be improved and other things. And most importantly, for PDFs. Okay? If you can do that, let me know. And how what changes you will do and what commits you will do. Currently, there is a Rofi script for, I think, Super B. It's for library books or whatever. See what sections of it can be improved, and like how it can be improved and other things. And most importantly, what I want to be, what I want to really improve is this.

#### openai/gpt-oss-120b

Time: 1688ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

So here is the next task that I want you to understand and do. See what sections of it can be improved, and like how it can be improved and other things. And most importantly, what I want to really improve is this. For PDFs. Okay? If you can do that, let me know and how what changes you will do and what commits you will do. Currently, there is a Rofi script for, I think, Super B. It's for library books or whatever. See what sections of it can be improved, and like how it can be improved and other things. And most importantly, what I want to be, what I want to really improve is this.

---

### Case 160: outro_suffix

Timestamp: 2026-05-11T09:48:33.116Z  
Duration: 35s  
Input chars: Qwen 551, Deepgram 430

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":true,"mixedScript":false,"mentionsTranscriptMeta":false}

Why does the whole application should be a single page? Why don't we introduce tabs, introduce dropdowns, introduce popups, models, and other things? Why are we trying to make it as a single tab? I don't understand why you are trying to do this. It doesn't really help anyone. There is too much content at the same page. Why not have different pages for different tasks? So, we can have psychoanalyze everything. Just think about the whole thing and improve the whole thing. Think about how the navigation bar should look like. Thank you for watching.

#### llama-3.3-70b-versatile

Time: 339ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Why does the whole application should be a single page? Why don't I include, included as dropdowns, included as pop ups, models, and other things. Why are you trying to make it as a single tab? I don't understand why you are trying to do this. It doesn't really help anyone. Not have different pages for different tasks? So we can have psychoanalyze everything. Just think about the whole thing and improve the whole thing. Think about how the navigation bar should look like.

#### openai/gpt-oss-120b

Time: 1674ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Why does the whole application should be a single page? Why don't we introduce tabs, introduce dropdowns, introduce popups, models, and other things? Why are we trying to make it as a single tab? I don't understand why you are trying to do this. It doesn't really help anyone. There is too much content at the same page. Why not have different pages for different tasks? So, we can have psychoanalyze everything. Just think about the whole thing and improve the whole thing. Think about how the navigation bar should look like.

---

### Case 203: preserve_artifact

Timestamp: 2026-05-13T07:31:04.131Z  
Duration: 36s  
Input chars: Qwen 581, Deepgram 537

#### Current Qwen Final

Flags: {"preserveArtifact":true,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Are you really sure it will block requests from different origin? Don't understand what I am trying to say. So it will mostly be like this. It will be a separate website hosted on a separate domain or whatever. It will authenticate the users with their email ID and then use those tokens to send API requests to this website's backend. Will that work or not? Or is there a frontend-backend partnership? Because is a service adaptation. I think it should work. Please do a detailed analysis and then tell me. Don't assume things. Preserve the following terms in the following order.

#### llama-3.3-70b-versatile

Time: 645ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Are you really sure it will block requests from different origin? I'm going to understand what I'm trying to say. So it will mostly be like this. It will be a separate website hosted on a separate domain or whatever. It will authenticate the users with their email ID and then use those tokens to send API requests to this website's backend. Will that work or not? Or is there a frontend, backend partnership? Because it's a service adaptation. I think it should work. Please do a detailed analysis and then tell me. Don't assume things.

#### openai/gpt-oss-120b

Time: 1430ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Are you really sure it will block request from different origin? I'm going to understand what I'm trying to say. So it will mostly be like this. It will be separate website hosted on a separate domain or whatever. It will authenticate the users with their email ID and then use those tokens to send API request to this website's back end. Will that work or not? Or is there a front end, back end partnership? Because is a service adaptation. I think it should work. Please do a detailed analysis and then tell me. Don't assume things.

---

### Case 210: preserve_artifact

Timestamp: 2026-05-13T12:44:08.334Z  
Duration: 57s  
Input chars: Qwen 407, Deepgram 537

#### Current Qwen Final

Flags: {"preserveArtifact":true,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

If I have to scrape the lectures from the website, how will I do? Assume I'll be using the console of the browser. Mostly, I will have to understand the structure of the website and then generally access weekly content of the lecture, all the lecture name, link, and title. Preserve the following terms in the following order. And how can I generalize it for a random course to also fetch the course's name?

#### llama-3.3-70b-versatile

Time: 387ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

If I have to scrape the lectures from the website, how will I do? Assume I'll be using the terminal, console of the browser. Mostly, I will have to, like, understand the structure of the website and then generally access weekly content of the lecture, all the lecture name, link, and title. And how can I generalize it for a random course to also fetch the course's name?

#### openai/gpt-oss-120b

Time: 1201ms  
Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false}

Hey. If I have to scrape the lectures from the website, how will I do? Assume I'll be using the terminal, like the console of the browser. Mostly, I will have to understand the structure of the website and then generally access weekly content of the lecture, all the lecture name, link, and title, whatever. Right? To fetch. And let me know after that, like, if I have to scrape on the website, how will I scrape it? And how can I generalize it for a random course to also fetch the course's name?

