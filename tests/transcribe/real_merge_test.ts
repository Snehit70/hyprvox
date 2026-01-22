import { TranscriptMerger } from "../../src/transcribe/merger";
import { loadConfig } from "../../src/config/loader";

async function runMergeTest() {
  const merger = new TranscriptMerger();
  
  const testCases = [
    {
      name: "Technical Jargon & Punctuation",
      groq: "the Kubernetes cluster is running on AWS EC2 instances with high availability",
      deepgram: "The kubernetes cluster is running on aws ec2 instances, with high availability.",
    },
    {
      name: "Acronyms & Numbers",
      groq: "the ROI of the AI project was 25 percent according to the CFO",
      deepgram: "The roi of the ai project was 25% according to the cfo.",
    },
    {
      name: "Hallucination Removal",
      groq: "I think we should use the new library. thank you for watching. subscribe.",
      deepgram: "I think we should use the new library.",
    },
    {
      name: "Complex Names",
      groq: "meeting with Snehit and YeonGyu regarding the Sisyphus project",
      deepgram: "Meeting with snehit and yeongyu regarding the sisyphus project.",
    },
  ];

  console.log("=== Real LLM Merge Test ===");
  for (const tc of testCases) {
    console.log(`\nTest Case: ${tc.name}`);
    console.log(`Groq:     ${tc.groq}`);
    console.log(`Deepgram: ${tc.deepgram}`);
    
    try {
      const result = await merger.merge(tc.groq, tc.deepgram);
      console.log(`Result:   ${result}`);
    } catch (err) {
      console.error(`Failed: ${err}`);
    }
  }
}

runMergeTest();
