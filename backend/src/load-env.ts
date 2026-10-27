// Imported first by main.ts so .env is in process.env before anything reads it.
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the process environment
}
