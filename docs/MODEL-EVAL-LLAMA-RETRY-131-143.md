# Hyprvox Merge Model Evaluation

**Generated:** 2026-05-20T13:09:07.972Z  
**Models tested:** llama-3.3-70b-versatile  
**Cases tested:** 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143  
**Method:** Replay with real production source pairs from the current monitoring window using logged Groq source transcript + Deepgram streaming chunks + saved final transcript.

## Summary

| Model | Successful calls | Avg time ms | Avg quality score | Preserve artifacts | Outro suffixes | Mixed script | Transcript meta | CoT leak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| llama-3.3-70b-versatile | 0/13 | 0 | 0.0 | 0 | 0 | 0 | 0 | 0 |

Successful calls: 0/13

## Ranked Recommendation

| Rank | Model | Avg quality score | Success rate | Avg time ms |
|---:|---|---:|---:|---:|
| 1 | llama-3.3-70b-versatile | 0.0 | 0.0% | Infinity |

## Notes

- Groq source text and Deepgram chunks are from real production sessions in this window.
- The saved final transcript is used as the baseline reference for comparison.
- The script intentionally uses minimal Groq parameters: model, messages, temperature, and max_tokens.
- Calls are throttled with sleep between requests to avoid rate limits.

## Case Results

### Case 131: quality_issue

Timestamp: 2026-05-19T15:43:21.297Z  
Duration: 25s  
Input chars: Groq 480, Qwen 295, Deepgram 521

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

A new PR has been created on our GitHub repository. Go to it, analyze it, and understand what its purpose is in detail. Then understand our current version and what useful things can be implemented currently in our local version. Think about it deeply in all aspects and let me know your answer.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98720, Requested 1670. Please try again in 5m36.96s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 132: quality_issue

Timestamp: 2026-05-19T15:47:46.391Z  
Duration: 38s  
Input chars: Groq 243, Qwen 480, Deepgram 249

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

I understood this. Create a feature branch. Just get an idea of the topics. First, understand the current implementation and how it goes. And just get an idea of whatever has been implemented here and just implement the parts that will improve the whole project. Start with incremental commits and let me know when everything is done. When everything is done, also start the local server, front-end and back-end, in the background. And let me know if they are already not running.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98717, Requested 1613. Please try again in 4m45.12s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 133: quality_issue

Timestamp: 2026-05-19T16:09:15.895Z  
Duration: 21s  
Input chars: Groq 243, Qwen 244, Deepgram 256

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

We have decided that we don't want this branch. Remove this branch and the other stale branch that we have. Except main. And let me know. And stop the server and restart the server on the main branch itself. Okay? Let me know when you are done.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98713, Requested 1577. Please try again in 4m10.559999999s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 134: quality_issue

Timestamp: 2026-05-19T16:25:30.817Z  
Duration: 26s  
Input chars: Groq 782, Qwen 242, Deepgram 784

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Here is my counterargument. If the last visit date doesn't exist, why don't we really need to alert the representative? What do you think about this? Or do you have a counter logic for me? If not, we will implement this on the feature branch.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98710, Requested 1829. Please try again in 7m45.696s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 135: quality_issue

Timestamp: 2026-05-19T16:29:59.285Z  
Duration: 61s  
Input chars: Groq 785, Qwen 771, Deepgram 834

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Don't rebuild for now because I will just give you a set of instructions that you should follow and I will let you know when you have to rebuild the backend. So the next set of changes is the sync tab that we have now. I don't really think there is any use case for sync tab. What we can do is that instead of that, we are able to see a hovered pill. So what we are doing? We are able to see a pill in the Narikish bar called sync. There only we can have a hover effect. When you hover, you will get basic information of is data live EML or is it fallback. And really basic information compacted. And also think about how the mobile version will look like. Based on that, remove the sync tab and just try to store only basic information that is needed in the navbar pill.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98706, Requested 1933. Please try again in 9m12.096s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 136: quality_issue

Timestamp: 2026-05-19T16:32:46.296Z  
Duration: 71s  
Input chars: Groq 1393, Qwen 786, Deepgram 1440

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

So here is the next set of improvements that we can do. I will send you a screenshot of a possible structure of a retail tab that we can add in our application. Or it can be added to a different tab as a subsection. What it will do now, in the retail tab, whatever you want to name it, it will have inventory alerts from my logic. If you will just go deeply and check the logic how it is. A particular representative has a one-to-one relation to a particular territory. And a particular territory might have many retailers that he might have. So, I will just show him inventory alerts and will just give him some filter options. So, if he wants to check about how they want to filter it by showing some parameters. You can just implement this. We will talk about competitor radar later.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98703, Requested 2208. Please try again in 13m7.104s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 137: quality_issue

Timestamp: 2026-05-19T16:43:40.560Z  
Duration: 111s  
Input chars: Groq 944, Qwen 1327, Deepgram 662

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Okay, here is the next task that we are going to perform. We have an in-site stamp. So what you will do now is create a new tab called Insights 1 because the current one is really buggy or something else. What we are trying to achieve is that the Insights tab should have performance metrics like bar charts, pie charts, and other visualizations. Also, because we have a lot of representative data, we can show relative metrics like month-by-month coverage. For example, we will have line graphs, pie charts, and bar graphs based on different insights. We will also have an employee performance mechanism—like, which employee performed how much, and how we can measure performance. It depends. Let's just check out what real data we have and see if it's able to rank those employees or not. If not, let me know. Don't worry. There are various other tools not seen in WCHN. We can think about that later. First, we just want to have a really good Insights tab. It should have all the insights of what is the nearest town to me, and all the alerts that we may get here. Another thing—think about this. We'll just try to use the real data that we have and the ML models that we have to show insights here. Not something too complicated for you. Let me know your plan for the new Insights 1 tab. test-audio.mp3, benchmark-audio.ts.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98699, Requested 2051. Please try again in 10m48s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 138: quality_issue

Timestamp: 2026-05-19T16:45:17.135Z  
Duration: 67s  
Input chars: Groq 23, Qwen 923, Deepgram 4

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

I think you should think more about how the whole UI looks. Like, you are able to see something if you see it in the tool. Firstly, there is no separation of concerns. Like the workspace and the settings, which are overlapping each other. And also, I think you have a pill-shaped tab or something. I think it was mostly trying to implement a tab-like structure here. But it seems to have been filled miserably. Because many of the texts are overlapping each other, think about the whole. I think most of the functionality of the page is correct. But you will have to think about how the person will switch tabs in the mobile view based on the current UI. Like I think you can just have a single, like, just think about this and let me know your answer, how we can improve this. Mostly the tab feature and other things, how people use them, what animation you want it to be and other things. And how can you prevent overlap.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98696, Requested 1613. Please try again in 4m26.976s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 139: outro_suffix

Timestamp: 2026-05-19T16:50:58.086Z  
Duration: 7s  
Input chars: Groq 448, Qwen 604, Deepgram 503

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":true,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":true}

<think>
Okay, let's see. The user wants me to fix a failed speech-to-text merge. The failed output is [NO_SPEECH_DETECTED], which probably means the system didn't detect any speech. But looking at the source transcripts, there are two parts: "Thank you for watching." from Groq and "Hey." from Deepgram.

First, I need to check what the user's instructions say. They mentioned removing invalid artifacts like internal instructions, labels, meta-commentary, and any outro that wasn't actually spoken. Also, don't summarize or rewrite beyond removing those artifacts. Preserve the order, wording, technical

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98692, Requested 1763. Please try again in 6m33.12s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 140: quality_issue

Timestamp: 2026-05-19T16:51:48.489Z  
Duration: 45s  
Input chars: Groq 197, Qwen 447, Deepgram 189

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

So here is the thing that we are trying to change. Currently, the default date is being chosen as the current date, as I am able to see. But we will add an environment variable, which will choose the date that we want to show as the default date. We might have a manual changing option too, but the default date will be this. Currently, I want it to be 1st January, 2026. Can you do this change for me and redeploy? Okay. Then this change is done.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98689, Requested 1599. Please try again in 4m8.832s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 141: quality_issue

Timestamp: 2026-05-19T17:38:35.251Z  
Duration: 17s  
Input chars: Groq 822, Qwen 198, Deepgram 690

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Okay, I feel the insights one looks really better than the current insights one. Remove the current insights. It's not needed. Just keep, just make the current insight one as the main insight. Okay.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98685, Requested 1795. Please try again in 6m54.72s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 142: quality_issue

Timestamp: 2026-05-19T17:47:43.333Z  
Duration: 54s  
Input chars: Groq 920, Qwen 792, Deepgram 266

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Here is the next section that we are working on. I think I have already sent you that. Okay, I will just explain once again. So, in the territory tab, we are trying to implement a map of India. Like, just see if there is a map library or something that can be used. Map of India, and we will just try to show insights of the territories, like all the territory map on the map. If we first just check the real data that we have and how accurately we map territories and other things, if we are able to accurately map it, we will just implement the map feature here. So people can visually see it and when you hover over it, you will get more detailed information about territory and these things. Let me know if this plan is implementable and how much is the feasibility based on data we have.

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98682, Requested 1932. Please try again in 8m50.496s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

---

### Case 143: quality_issue

Timestamp: 2026-05-19T18:03:34.339Z  
Duration: 61s  
Input chars: Groq 0, Qwen 909, Deepgram 0

#### Current Qwen Final

Flags: {"preserveArtifact":false,"outroSuffix":false,"mixedScript":false,"mentionsTranscriptMeta":false,"cotLeak":false}

Okay, you can implement more things that you are going to implement. But first, get a structure, an idea of the structure. First, you see, if you see the first page, the directory, the map, it looks really big. What you have to do is that, on the left-hand side, you just want the whole map to be there. The map should be there on the left-hand side. The remaining data can be in small cards as well. It's just a waste of space that you can bring here. You can't map to the tab. Map should be default.  

test-audio.imps, X4, UPS, IPA 2.2, WSCAP, KDE, TXFR, Q2, AVAX, AUY-KU, SDHC, DAO2, TRIO, X6, TXP, A6, UPS, TIAL, DOING, NETGOID, SOCTER, ULTIMATOR, LOWER-DILL, ELENA, NAFF, COOL, AUGUST, and RDE'S.  

test-audio, UPS, TAX, LINE, PAIN, TARGET, NETGOID, TRIO, ZOOO, TRIO, ULTIMATOR, LOAD, ARSTIM.  

test-audio.imps, UPDATING, UNIAR, TRIO, HOPING.  

If you understood this, start implementing. Let me know

#### llama-3.3-70b-versatile

Failed: 429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01keenbh05eeevwx8qycjx7q5n` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 98678, Requested 1702. Please try again in 5m28.32s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}

