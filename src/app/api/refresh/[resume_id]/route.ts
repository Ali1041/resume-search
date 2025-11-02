import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'
import { parseResumeFile } from '@/lib/services/parser'
import { extractFields } from '@/lib/services/field-extractor'
import { chunkResumeText } from '@/lib/services/chunker'
import { generateChunkEmbeddings } from '@/lib/services/embedding'

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'resumes'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resume_id: string }> }
) {
  try {
    const supabase = createServerSupabase()
    const { resume_id } = await params

    if (!resume_id) {
      return NextResponse.json({ error: 'Resume ID is required' }, { status: 400 })
    }

    // Get existing resume data
    const { data: resume, error: resumeError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', resume_id)
      .single()

    if (resumeError || !resume) {
      return NextResponse.json(
        { error: 'Resume not found' },
        { status: 404 }
      )
    }

    if (!resume.resume_url) {
      return NextResponse.json(
        { error: 'Resume file URL not found' },
        { status: 400 }
      )
    }

    // Download file from storage
    const filePath = resume.resume_url.split('/').pop() || ''
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(filePath)

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: 'Failed to download resume file' },
        { status: 500 }
      )
    }

    // Convert blob to buffer
    const arrayBuffer = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Get file extension from URL
    const fileName = filePath.split('/').pop() || 'resume.pdf'

    // Parse resume file
    const parsed = await parseResumeFile(buffer, fileName)

    if (!parsed.text || parsed.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Failed to extract text from file' },
        { status: 400 }
      )
    }

    // Extract fields
    const fields = extractFields(parsed.text)

    // Chunk text
    const chunks = chunkResumeText(parsed.text)

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'Failed to chunk resume text' },
        { status: 400 }
      )
    }

    // Generate embeddings
    const embeddings = await generateChunkEmbeddings(chunks)

    if (embeddings.length !== chunks.length) {
      return NextResponse.json(
        { error: 'Embedding generation failed' },
        { status: 500 }
      )
    }

    // Update resume record
    const { error: updateError } = await supabase
      .from('resumes')
      .update({
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        linkedin: fields.linkedin,
        location: fields.location,
        title: fields.title,
        skills: fields.skills.length > 0 ? fields.skills : null,
        experience_years: fields.experience_years,
        resume_text: parsed.text,
      })
      .eq('id', resume_id)

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update resume data' },
        { status: 500 }
      )
    }

    // Delete existing chunks
    const { error: deleteError } = await supabase
      .from('resume_chunks')
      .delete()
      .eq('resume_id', resume_id)

    if (deleteError) {
      console.error('Delete chunks error:', deleteError)
    }

    // Insert new chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = embeddings[i]
      const embeddingStr = `[${embedding.join(',')}]`

      const { error: chunkError } = await supabase.rpc('insert_resume_chunk', {
        p_resume_id: resume_id,
        p_chunk_text: chunk.chunk_text,
        p_section: chunk.section,
        p_company: chunk.company,
        p_start_date: chunk.start_date,
        p_end_date: chunk.end_date,
        p_embedding: embeddingStr,
      })

      if (chunkError) {
        console.error('Chunk insert error:', chunkError)
      }
    }

    return NextResponse.json({
      resume_id,
      message: 'Resume refreshed successfully',
      chunks_count: chunks.length,
    })
  } catch (error) {
    console.error('Refresh error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

