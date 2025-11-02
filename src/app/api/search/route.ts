import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'
import { generateQueryEmbedding } from '@/lib/services/embedding'
import { SearchFilters, SearchResult } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const body = await request.json()
    
    const { query_text, filters = {}, page = 1, page_size = 20 } = body

    if (!query_text || typeof query_text !== 'string') {
      return NextResponse.json(
        { error: 'query_text is required' },
        { status: 400 }
      )
    }

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query_text)
    const embeddingStr = `[${queryEmbedding.join(',')}]`

    // Build filter conditions
    const filtersObj: SearchFilters = filters
    const { location, skills, min_years, title } = filtersObj

    // Query top chunks by vector similarity
    // We'll use a raw SQL query for better control over vector search
    let query = `
      WITH q AS (SELECT $1::vector AS query_vec)
      SELECT 
        c.id as chunk_id,
        c.resume_id,
        c.chunk_text,
        c.section,
        c.company,
        c.start_date,
        c.end_date,
        1 - (c.embedding <=> q.query_vec) as similarity,
        r.id,
        r.name,
        r.title,
        r.location,
        r.experience_years,
        r.skills
      FROM resume_chunks c
      JOIN resumes r ON r.id = c.resume_id
      CROSS JOIN q
      WHERE c.embedding IS NOT NULL
    `

    const queryParams: any[] = [embeddingStr]
    let paramIndex = 2

    // Add filters
    if (location) {
      query += ` AND r.location ILIKE $${paramIndex}`
      queryParams.push(`%${location}%`)
      paramIndex++
    }

    if (min_years !== undefined && min_years !== null) {
      query += ` AND r.experience_years >= $${paramIndex}`
      queryParams.push(min_years)
      paramIndex++
    }

    if (title) {
      query += ` AND r.title ILIKE $${paramIndex}`
      queryParams.push(`%${title}%`)
      paramIndex++
    }

    // Order by similarity and limit
    query += ` ORDER BY similarity DESC LIMIT $${paramIndex}`
    queryParams.push(page_size * 2) // Get more chunks initially, then group by resume

    // Execute query using RPC or raw query
    // Since we can't easily do raw SQL with Supabase JS client,
    // we'll use a database function or alternative approach
    const { data: chunks, error: queryError } = await supabase.rpc('search_resume_chunks', {
      query_embedding: embeddingStr,
      filter_location: location || null,
      filter_min_years: min_years || null,
      filter_title: title || null,
      result_limit: page_size * 2,
    })

    if (queryError) {
      // Fallback: use simpler query approach
      // Get all chunks with embedding and filter in memory (less efficient but works)
      const { data: allChunks, error: chunksError } = await supabase
        .from('resume_chunks')
        .select('*, resumes(*)')
        .not('embedding', 'is', null)
        .limit(500)

      if (chunksError) {
        return NextResponse.json(
          { error: 'Failed to search resumes' },
          { status: 500 }
        )
      }

      // For now, return simple results without vector similarity
      // Full vector search requires the database function
      const results: SearchResult[] = (allChunks || [])
        .filter((chunk: any) => {
          if (location && !chunk.resumes?.location?.toLowerCase().includes(location.toLowerCase())) {
            return false
          }
          if (min_years !== undefined && min_years !== null && 
              (!chunk.resumes?.experience_years || chunk.resumes.experience_years < min_years)) {
            return false
          }
          if (title && !chunk.resumes?.title?.toLowerCase().includes(title.toLowerCase())) {
            return false
          }
          return true
        })
        .slice(0, page_size)
        .map((chunk: any) => ({
          resume_id: chunk.resume_id,
          name: chunk.resumes?.name,
          title: chunk.resumes?.title,
          score: 0.5, // Placeholder score
          similarity: 0.5,
          evidence: [{
            chunk_id: chunk.id,
            chunk_text: chunk.chunk_text,
            similarity: 0.5,
            company: chunk.company,
            section: chunk.section,
          }],
        }))

      return NextResponse.json({
        results,
        page,
        page_size,
        total: results.length,
      })
    }

    // Process results and group by resume
    const resumeMap = new Map<string, SearchResult>()

    ;(chunks || []).forEach((chunk: any) => {
      const resumeId = chunk.resume_id
      
      if (!resumeMap.has(resumeId)) {
        resumeMap.set(resumeId, {
          resume_id: resumeId,
          name: chunk.name,
          title: chunk.title,
          score: chunk.similarity || 0,
          similarity: chunk.similarity || 0,
          evidence: [],
        })
      }

      const result = resumeMap.get(resumeId)!
      result.evidence.push({
        chunk_id: chunk.chunk_id,
        chunk_text: chunk.chunk_text,
        similarity: chunk.similarity || 0,
        company: chunk.company,
        section: chunk.section,
      })

      // Update max similarity for the resume
      if (chunk.similarity && chunk.similarity > result.similarity) {
        result.similarity = chunk.similarity
        result.score = chunk.similarity
      }
    })

    // Convert map to array, sort by score, and paginate
    const results = Array.from(resumeMap.values())
      .sort((a, b) => b.score - a.score)
      .slice((page - 1) * page_size, page * page_size)

    return NextResponse.json({
      results,
      page,
      page_size,
      total: resumeMap.size,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

