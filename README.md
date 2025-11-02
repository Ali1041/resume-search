# Supabase Resume RAG — Implementation Plan (Cursor-ready)

> Purpose: a concise, implementation-first plan so a developer using Cursor (or any code editor) can implement a resume RAG MVP on Supabase quickly and reliably.

---

## Quick summary

* **Goal:** Provide semantic resume search + filters using Supabase (pgvector) as the vector DB. Recruiters upload resumes; the system extracts structured fields, stores raw files + chunks, indexes embeddings, and serves ranked search results with explainable confidence.
* **Scope (MVP):** upload PDFs/DOCX, extract basic fields (name/email/phone/linkedin/title/skills/years), chunk text into bullets/sections, embed chunks, store vectors in Supabase `resume_chunks`, allow recruiter queries (natural language + filters), retrieve top-N by vector similarity + simple SQL scoring, re-rank top-N with a cross-encoder or lightweight LLM.

---

## How this doc is organized (so you can jump in)

1. Architecture & component map (1 page)
2. DB schema (SQL ready)
3. Ingestion pipeline (detailed steps + Edge Function / server examples)
4. Embedding generation (model choices & code snippets)
5. Vector indexing & query patterns (SQL for Supabase pgvector)
6. Re-ranking & scoring (how-to + calibration tips)
7. API surface & UI contract (endpoints + payloads)
8. Tests, monitoring & metrics
9. Sprint backlog (tickets with acceptance criteria)
10. Dev notes & gotchas

---

## 1) Architecture & component map

* **Client (Recruiter UI)**: React (or Cursor workspace) for upload and search UI.
* **Backend / Edge**: Supabase Edge Functions or a small FastAPI/Next.js app to orchestrate ingestion, embedding creation, and query logic.
* **Database**: Supabase Postgres + pgvector extension for vectors.
* **Object storage**: Supabase Storage for raw resume files.
* **Embedding model**: OpenAI `text-embedding-3-large` (cloud) or `all-mpnet-base-v2` (local) depending on privacy/cost.
* **Optional re-ranker**: Cross-encoder model (HuggingFace) or small GPT call for top-N re-ranking.

Flow overview:

1. Upload file → store in Supabase Storage.
2. Parse file → extract text & structured fields.
3. Chunk text → compute embeddings per chunk.
4. Insert `resumes` row + `resume_chunks` rows (with embeddings).
5. Recruiter query → generate query embedding → SQL vector search + filters → top-N → re-rank → respond.

---

## 2) DB schema (SQL)

### `resumes` (one row per candidate)

```sql
create extension if not exists vector;

create table resumes (
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
```

### `resume_chunks` (one row per chunk/bullet)

```sql
create table resume_chunks (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid references resumes(id) on delete cascade,
  chunk_text text,
  section text,
  company text,
  start_date date,
  end_date date,
  embedding vector(1536), -- pick dimension to match embedding model
  created_at timestamptz default now()
);

-- IVFFlat index for pgvector
create index if not exists idx_resume_chunks_embedding on resume_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**Notes:** Set embedding vector dimension (1536 above) to match chosen model. Adjust `lists` for your data size (lists=100 is fine for <100k vectors).

---

## 3) Ingestion pipeline (detailed)

### Responsibilities

* Accept uploads (frontend) → call ingest endpoint.
* Store raw file in Supabase Storage.
* Extract text and structured fields.
* Chunk the text.
* Generate embeddings for chunks.
* Insert rows into `resumes` and `resume_chunks`.

### Step-by-step (Edge Function / FastAPI)

**A. Upload flow (client -> Edge)**

* Client uploads to a signed Supabase Storage URL or directly via Supabase JS client.
* Client calls `POST /api/ingest` with `file_url` and optional metadata.

**B. Ingest function responsibilities**

1. Download file from storage (internal fetch via service key or presigned URL).
2. Extract text:

   * Try direct PDF text extraction (pdfplumber / pypdf).
   * If text is empty or layouted, run OCR (Tesseract) or call a layout model (Donut/LayoutLM) if using GPU.
3. Extract structured fields:

   * Run regex for emails/phones/URLs.
   * Use spaCy NER + custom rules for name/title/company.
   * Optionally call an LLM "extract to JSON" if parsing fails.
4. Chunk text:

   * Split by section headers (Experience / Education / Skills).
   * Within experience, split into bullets (newline + leading dash/number). Fallback: sliding window of 100–200 tokens per chunk.
5. Generate embeddings for each chunk (batch calls).
6. Insert into `resumes` table and `resume_chunks` (with embedding binary).
7. Return 200 + resume_id.

### Example pseudocode (Python style)

* Use `openai` or `sentence_transformers` (local) for embeddings.
* Use Supabase Python client for DB inserts (or REST via Edge function).

> Implementation detail: batch chunk inserts with embeddings to reduce round-trips. Use `copy` or multi-row inserts.

---

## 4) Embedding generation (models & code snippets)

### Model choices

* **OpenAI `text-embedding-3-large`**: high quality, easy to use. (Dimension: 3072 — pick vector column accordingly.)
* **Sentence-Transformers `all-mpnet-base-v2`**: dimension 768 — cheaper self-host option.

If you choose OpenAI, make sure to set Supabase credentials and OpenAI key in server/Edge secrets.

### Batch embedding snippet (Node / Edge)

```js
// Node/Edge pseudo
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embedChunks(chunks) {
  const texts = chunks.map(c => c.chunk_text);
  const res = await client.embeddings.create({ model: 'text-embedding-3-large', input: texts });
  return res.data.map(d => d.embedding);
}
```

**Tip:** Batch 50–200 texts per request depending on model quotas and latency.

---

## 5) Vector indexing & query patterns (Supabase SQL)

### Query flow (search)

1. User provides `query_text` + filters (location, min_years, required_skills array).
2. Generate `q_vec` for `query_text`.
3. Query top-M similar `resume_chunks` with SQL + filter on parent resume table if needed.

### Example SQL (top-level document similarity + location filter)

```sql
with q as (select $1::vector as query_vec)
select r.id, r.name, r.title, max(1 - (c.embedding <=> q.query_vec)) as similarity
from resumes r
join resume_chunks c on c.resume_id = r.id
where r.location = $2
group by r.id, r.name, r.title
order by similarity desc
limit 50;
```

### Example: chunk-level retrieval + join metadata

```sql
with q as (select $1::vector as query_vec)
select c.id, c.resume_id, c.chunk_text, 1 - (c.embedding <=> q.query_vec) as similarity
from resume_chunks c, q
where c.embedding is not null
order by similarity desc
limit 200;
```

**Hybrid approach:** also run a lightweight BM25 search on `resume_text` for exact token matches (via Postgres `to_tsvector`) and union results.

---

## 6) Re-ranking & scoring

### Why re-rank

* Bi-encoder (dense) retrieval is fast for recall; cross-encoder gives better precision on top results. Use re-ranker only on top-N (e.g., 200 → 50 → 10 flow).

### Scoring components (example)

* `dense_sim` (cosine from pgvector)
* `cross_score` (0..1 from cross-encoder)
* `skill_overlap` (Jaccard or weighted skill match)
* `title_similarity` (fuzzy or embedding-based)
* `experience_match` (years relevance)
* `recency_boost`

Compose a weighted sum and calibrate to a 0–100 scale. Provide provenance for top contributing signals.

### Re-ranker options

* **Local cross-encoder (HuggingFace)**: fine-tune a RoBERTa/CrossEncoder on labeled role↔resume pairs.
* **GPT-based scorer**: for small volume, call OpenAI/GPT for `score(query, snippet)` and parse a numeric score.

**Integration pattern:** after vector search (top-200), call re-ranker and compute final score and reasons. Store re-ranker model version in logs.

---

## 7) API surface & UI contract

### Endpoints (minimal)

* `POST /api/ingest` — payload: `{ file_url, source, uploaded_by }` → returns `{ resume_id }`.
* `GET /api/resume/:id` — returns structured fields + top evidence chunks.
* `POST /api/search` — payload: `{ query_text, filters: {location, skills[], min_years, title}, page, page_size }` → returns `{ results: [{ resume_id, name, title, score, evidence: [{chunk_id, text, similarity}] }] }`.
* `POST /api/refresh/:resume_id` — re-extract & re-embed a resume (for updates).

### UI contract notes

* Evidence must include `chunk_text`, `company`, and `dates` where available.
* Score should be shown as `confidence` with a 3-bucket legend (High/Medium/Low) and a small breakdown modal showing top 3 signals.

---

## 8) Tests, monitoring & metrics

* **Unit tests**: extractor regex, chunker, embedding client mock, DB write/read.
* **Integration tests**: end-to-end ingest → search using a small test corpus.
* **Monitoring**:

  * Latency for embedding calls, vector queries, and re-ranker.
  * Search quality via CTR and manual relevance labeling.
  * Drift alerts: embedding distribution changes, sudden drops in similarity.
* **Metrics**: P@10, MRR, average rank improvement after re-rank, API error rate.

---

## 9) Sprint backlog (cursor-friendly tickets)

Each ticket: **Title -- Owner -- Est (days) -- Acceptance Criteria**

1. **Project init & infra** -- Dev -- 0.5d

   * Create Supabase project, enable `vector` extension, create `resumes` and `resume_chunks` tables from SQL above. Acceptance: tables exist and `ivfflat` index created.

2. **Upload & Storage** -- Dev -- 1d

   * Implement client file upload and store to Supabase Storage. Acceptance: file stored and accessible by signed URL.

3. **Basic parser** -- Dev -- 2d

   * Implement PDF text extractor (pdfplumber/pypdf). Acceptance: extracted text saved to `resumes.resume_text`.

4. **Field extractor** -- Dev -- 1.5d

   * Regex + spaCy for email/phone/name/title/skills. Acceptance: fields stored and validated against sample resumes.

5. **Chunker** -- Dev -- 1d

   * Implement section-based chunking. Acceptance: sample resume produces 10–50 chunks.

6. **Embeddings pipeline** -- Dev -- 1d

   * Batch embed chunks and store vectors into `resume_chunks.embedding`. Acceptance: embeddings saved and vector dimension correct.

7. **Vector search API** -- Dev -- 1.5d

   * Implement `/api/search` with query embedding + SQL retrieval. Acceptance: returns top 50 chunk rows sorted by similarity.

8. **Re-ranker integration** -- Dev -- 3d

   * Add cross-encoder/gpt re-ranker for top-200 → final top-10. Acceptance: ranking improves on labeled test cases.

9. **Frontend search UI** -- Frontend Dev -- 2d

   * Build search page, filters, results list with evidence + confidence bar. Acceptance: recruiters can search and see evidence.

10. **Tests & monitoring** -- DevOps -- 2d

    * Add basic tests and set up Sentry/Prometheus alerts. Acceptance: CI pipeline passes and basic alerts configured.

---

## 10) Dev notes & gotchas

* Choose embedding dimension early and commit to it in DB. Changing dimension later requires reindexing.
* Tune `ivfflat` `lists` based on dataset size and recall/latency tradeoffs.
* If using OpenAI, watch rate limits and batch embeddings. Cache embeddings for unchanged resumes.
* For chunking, prefer bullets and experience items; fallback to 150–250 token sliding windows with 50-token overlap.
* Keep re-ranker limited to top-N to control cost.
* Implement `ingest` idempotency: if a resume file is re-uploaded, detect duplicates via checksum and either skip or version.
* Add `deleted_at` soft-delete columns to manage GDPR requests.

---

### Appendix A: Example SQL helpers

**Insert resume + chunks (simplified)**

```sql
-- Insert resume
insert into resumes (id, name, email, phone, linkedin, location, title, skills, experience_years, resume_url, resume_text)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
returning id;

-- Bulk insert chunks with embeddings using multi-row insert (construct programmatically)
```

**Query snippet (combine filters + vector search)**

```sql
with q as (select $1::vector as query_vec)
select r.id, r.name, r.title, max(1 - (c.embedding <=> q.query_vec)) as similarity
from resumes r
join resume_chunks c on c.resume_id = r.id
where ($2 is null or r.location = $2)
  and ($3 is null or r.experience_years >= $3)
group by r.id, r.name, r.title
order by similarity desc
limit $4;
```

---

## What I can deliver next (pick one)

* Concrete Edge Function code (Node/JS) that implements `POST /api/ingest` including parsing + embedding + DB inserts.
* FastAPI (Python) microservice implementation with end-to-end flow and example tests.
* A Next.js + React search UI skeleton wired to Supabase.

Tell me which one and I will produce the code for it next.

---

*Prepared for rapid implementation in Cursor — tasks are broken down to be copy/paste actionable. If you want, I can also export the backlog to a CSV or Github issues format.*
