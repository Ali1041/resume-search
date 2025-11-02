-- Enable the vector extension
create extension if not exists vector;

-- Create resumes table (one row per candidate)
create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  linkedin text,
  location text,
  title text,
  skills text[],
  experience_years int,
  resume_url text,
  resume_text text,
  created_at timestamptz default now()
);

-- Create resume_chunks table (one row per chunk/bullet)
create table if not exists resume_chunks (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid references resumes(id) on delete cascade,
  chunk_text text,
  section text,
  company text,
  start_date date,
  end_date date,
  embedding vector(1024), -- OpenAI text-embedding-3-large with 1024 dimensions (within pgvector 2000 limit)
  created_at timestamptz default now()
);

-- Create HNSW index for pgvector (supports up to 2000 dimensions)
-- HNSW is more accurate and efficient for larger datasets
create index if not exists idx_resume_chunks_embedding 
on resume_chunks 
using hnsw (embedding vector_cosine_ops) 
with (m = 16, ef_construction = 64);

-- Create indexes for common queries
create index if not exists idx_resume_chunks_resume_id on resume_chunks(resume_id);
create index if not exists idx_resumes_email on resumes(email);
create index if not exists idx_resumes_location on resumes(location);
create index if not exists idx_resumes_experience_years on resumes(experience_years);

