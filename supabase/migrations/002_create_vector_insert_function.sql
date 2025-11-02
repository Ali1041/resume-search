-- Function to insert resume chunks with embeddings
-- This helps with proper vector format handling
-- Accepts embedding as text array string and converts to vector
CREATE OR REPLACE FUNCTION insert_resume_chunk(
  p_resume_id uuid,
  p_chunk_text text,
  p_section text,
  p_company text,
  p_start_date date,
  p_end_date date,
  p_embedding text  -- Accept as text, then cast to vector
) RETURNS uuid AS $$
DECLARE
  chunk_id uuid;
BEGIN
  INSERT INTO resume_chunks (
    resume_id,
    chunk_text,
    section,
    company,
    start_date,
    end_date,
    embedding
  ) VALUES (
    p_resume_id,
    p_chunk_text,
    p_section,
    p_company,
    p_start_date,
    p_end_date,
    p_embedding::vector  -- Cast text to vector
  )
  RETURNING id INTO chunk_id;
  
  RETURN chunk_id;
END;
$$ LANGUAGE plpgsql;

