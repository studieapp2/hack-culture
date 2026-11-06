// Real API-compatibility reproducer for the installed @google/genai SDK.
// These are input examples, not precomputed diagnoses, patches or results.
export const SAMPLE_ERROR_INPUT = 'TypeError: client.generateText is not a function';
export const SAMPLE_CODE_INPUT = `import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await client.generateText({ prompt: 'Summarize this example.' });
console.log(response);
`;
export const SAMPLE_ANSWER_INPUT =
  'The @google/genai SDK exposes a top-level GoogleGenAI.generateText method that accepts a prompt string.';
