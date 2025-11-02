# Environment Variables Setup

Create a `.env.local` file in the root directory with the following content:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://enffuewtpogjfywoizsz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZmZ1ZXd0cG9namZ5d29penN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwNDI3NTksImV4cCI6MjA3NzYxODc1OX0.VjHOtGZ5QSRgmY7cp36gSQiIRWt-zYvkLPztf0iz5Kw

SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZmZ1ZXd0cG9namZ5d29penN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjA0Mjc1OSwiZXhwIjoyMDc3NjE4NzU5fQ.F1QGi-WqwV6I_pQCR_p7QD0xgKb73wlmq2eMYjKIsC4

# OpenAI Configuration (for embeddings)
# Add your OpenAI API key here
OPENAI_API_KEY=your_openai_api_key

# Storage Bucket Name
SUPABASE_STORAGE_BUCKET=resumes
```

## Next Steps

1. **Add your OpenAI API key** to `.env.local`
2. **Create the Storage Bucket**:
   - Go to your Supabase Dashboard → Storage
   - Create a new bucket named `resumes`
   - Set it to public (or configure appropriate access policies)
3. **Start the development server**:
   ```bash
   npm run dev
   ```

