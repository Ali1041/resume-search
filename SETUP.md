# Setup Guide for Resume RAG System

This guide will help you set up and run the Resume RAG system on Supabase.

## Prerequisites

- Node.js 20+ installed
- npm or yarn installed
- Supabase account (free tier works)
- OpenAI API key (for embeddings)

## Step 1: Clone and Install Dependencies

```bash
npm install
```

## Step 2: Set Up Supabase

1. Create a new Supabase project at [https://supabase.com](https://supabase.com)

2. Note down your Supabase project URL and keys:
   - Project URL
   - Anon/Public Key
   - Service Role Key (for server-side operations)

3. In your Supabase dashboard, go to SQL Editor and run the migrations in order:
   - `supabase/migrations/001_create_resumes_tables.sql`
   - `supabase/migrations/002_create_vector_insert_function.sql`
   - `supabase/migrations/003_create_search_function.sql`

4. Create a Storage bucket named `resumes`:
   - Go to Storage in your Supabase dashboard
   - Create a new bucket named `resumes`
   - Set it to public (or configure proper access policies)

## Step 3: Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI Configuration (for embeddings)
OPENAI_API_KEY=your_openai_api_key

# Storage Bucket Name
SUPABASE_STORAGE_BUCKET=resumes
```

Replace the placeholder values with your actual keys.

## Step 4: Run the Development Server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Features

- **Upload Resumes**: Upload PDF or DOCX files through the web interface
- **Automatic Extraction**: The system automatically extracts:
  - Name, email, phone number
  - LinkedIn profile URL
  - Location
  - Job title
  - Skills
  - Years of experience
- **Semantic Search**: Search resumes using natural language queries
- **Filters**: Filter by location, years of experience, job title, and skills
- **Confidence Scores**: Each result includes a confidence score and evidence chunks

## API Endpoints

- `POST /api/ingest` - Upload and process a resume file
- `POST /api/search` - Search resumes with vector similarity
- `GET /api/resume/:id` - Get resume details with evidence chunks
- `POST /api/refresh/:resume_id` - Re-extract and re-embed a resume

## Troubleshooting

### Vector Insertion Errors

If you encounter errors when inserting embeddings, make sure:
1. The `vector` extension is enabled in your Supabase database
2. The database functions are created (run the migration files)
3. The embedding dimension matches (3072 for OpenAI text-embedding-3-large)

### Storage Upload Errors

If file uploads fail:
1. Ensure the `resumes` bucket exists in Supabase Storage
2. Check that the bucket has proper access policies
3. Verify your service role key has storage permissions

### Search Not Working

If semantic search doesn't return results:
1. Verify the `search_resume_chunks` function exists in your database
2. Check that resumes have been ingested with embeddings
3. Ensure the query embedding generation is working (check OpenAI API key)

## Next Steps

- Implement re-ranking with a cross-encoder model for better precision
- Add batch upload functionality
- Implement caching for embeddings
- Add monitoring and metrics
- Implement user authentication for multi-tenant support

