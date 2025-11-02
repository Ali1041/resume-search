-- Function to search resume chunks with vector similarity
-- Accepts query_embedding as text and converts to vector
CREATE OR REPLACE FUNCTION search_resume_chunks(
  query_embedding text,  -- Accept as text, then cast to vector
  filter_location text DEFAULT NULL,
  filter_min_years int DEFAULT NULL,
  filter_title text DEFAULT NULL,
  result_limit int DEFAULT 200
)
RETURNS TABLE (
  chunk_id uuid,
  resume_id uuid,
  chunk_text text,
  section text,
  company text,
  start_date date,
  end_date date,
  similarity float,
  name text,
  title text,
  location text,
  experience_years int,
  skills text[]
) AS $$
BEGIN
  RETURN QUERY
  WITH q AS (SELECT query_embedding::vector AS query_vec)  -- Cast text to vector
  SELECT 
    c.id as chunk_id,
    c.resume_id,
    c.chunk_text,
    c.section,
    c.company,
    c.start_date,
    c.end_date,
    1 - (c.embedding <=> q.query_vec)::float as similarity,
    r.name,
    r.title,
    r.location,
    r.experience_years,
    r.skills
  FROM resume_chunks c
  JOIN resumes r ON r.id = c.resume_id
  CROSS JOIN q
  WHERE c.embedding IS NOT NULL
    AND (filter_location IS NULL OR r.location ILIKE '%' || filter_location || '%')
    AND (filter_min_years IS NULL OR r.experience_years >= filter_min_years)
    AND (filter_title IS NULL OR r.title ILIKE '%' || filter_title || '%')
  ORDER BY similarity DESC
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

