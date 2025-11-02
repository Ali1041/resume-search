// Database types for TypeScript
export interface Resume {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  linkedin: string | null
  location: string | null
  title: string | null
  skills: string[] | null
  experience_years: number | null
  resume_url: string | null
  resume_text: string | null
  created_at: string
}

export interface ResumeChunk {
  id: string
  resume_id: string
  chunk_text: string
  section: string | null
  company: string | null
  start_date: string | null
  end_date: string | null
  embedding: number[] | null
  created_at: string
}

export interface SearchFilters {
  location?: string
  skills?: string[]
  min_years?: number
  title?: string
}

export interface SearchResult {
  resume_id: string
  name: string | null
  title: string | null
  score: number
  similarity: number
  evidence: Array<{
    chunk_id: string
    chunk_text: string
    similarity: number
    company: string | null
    section: string | null
  }>
}

