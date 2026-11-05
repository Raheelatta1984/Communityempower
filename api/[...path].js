// Vercel Node Function: forward /api/* to the same Express API used in local development.
// The API reads Neon integration variables (MYCOMM_DATABASE_URL, etc.) without exposing them to Vite.
import app from '../server/index.js';
export default app;
