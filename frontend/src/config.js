// NeuroHEX frontend configuration
// Set these in your .env file at the project root

/** FastAPI backend URL (SynthSeg + tumor endpoints) */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

/** Google Gemini API key (aistudio.google.com — free tier) */
export const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || ''

/** Gemini model endpoint */
export const GEMINI_MODEL = 'gemini-2.0-flash'
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
export const GROQ_KEY = import.meta.env.VITE_GROQ_KEY || ''
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'