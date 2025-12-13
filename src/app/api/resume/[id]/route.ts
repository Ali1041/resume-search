import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'
import { generateChunkEmbeddings } from '@/lib/services/embedding'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabase()
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Resume ID is required' }, { status: 400 })
    }

    // Get resume data
    const { data: resume, error: resumeError } = await supabase
      .from('resumes')
      .select('*')
      .eq('id', id)
      .single()

    if (resumeError || !resume) {
      return NextResponse.json(
        { error: 'Resume not found' },
        { status: 404 }
      )
    }

    // Get all chunks organized by section (no limit to get all sections)
    const { data: chunks, error: chunksError } = await supabase
      .from('resume_chunks')
      .select('id, chunk_text, section, company, start_date, end_date, created_at')
      .eq('resume_id', id)
      .order('section', { ascending: true })
      .order('created_at', { ascending: false })

    if (chunksError) {
      console.error('Chunks fetch error:', chunksError)
    }

    return NextResponse.json({
      resume: {
        id: resume.id,
        name: resume.name,
        email: resume.email,
        phone: resume.phone,
        linkedin: resume.linkedin,
        location: resume.location,
        title: resume.title,
        skills: resume.skills,
        experience_years: resume.experience_years,
        resume_url: resume.resume_url,
        resume_text: resume.resume_text,
        created_at: resume.created_at,
      },
      evidence: (chunks || []).map(chunk => ({
        chunk_id: chunk.id,
        chunk_text: chunk.chunk_text,
        section: chunk.section,
        company: chunk.company,
        start_date: chunk.start_date,
        end_date: chunk.end_date,
      })),
    })
  } catch (error) {
    console.error('Get resume error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabase()
    const { id } = await params
    const body = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Resume ID is required' }, { status: 400 })
    }

    // Update resume basic fields
    const { error: updateError } = await supabase
      .from('resumes')
      .update({
        name: body.name || null,
        email: body.email || null,
        phone: body.phone || null,
        linkedin: body.linkedin || null,
        location: body.location || null,
        title: body.title || null,
        skills: body.skills && body.skills.length > 0 ? body.skills : null,
        experience_years: body.experience_years || null,
      })
      .eq('id', id)

    if (updateError) {
      console.error('Update resume error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update resume' },
        { status: 500 }
      )
    }

    // Delete existing chunks
    const { error: deleteError } = await supabase
      .from('resume_chunks')
      .delete()
      .eq('resume_id', id)

    if (deleteError) {
      console.error('Delete chunks error:', deleteError)
    }

    // Create new chunks from structured data
    const chunks: Array<{
      chunk_text: string
      section: string
      company: string | null
      start_date: string | null
      end_date: string | null
    }> = []

    // Add experience chunks
    if (body.experiences && Array.isArray(body.experiences)) {
      body.experiences.forEach((exp: any) => {
        if (exp.company || exp.title || exp.description) {
          chunks.push({
            chunk_text: `${exp.title || ''}\n${exp.description || ''}`.trim(),
            section: 'Experience',
            company: exp.company || null,
            start_date: exp.start_date || null,
            end_date: exp.end_date || null,
          })
        }
      })
    }

    // Add project chunks
    if (body.projects && Array.isArray(body.projects)) {
      body.projects.forEach((proj: any) => {
        if (proj.name || proj.description) {
          chunks.push({
            chunk_text: `${proj.name || ''}\n${proj.description || ''}`.trim(),
            section: 'Projects',
            company: proj.name || null,
            start_date: proj.start_date || null,
            end_date: proj.end_date || null,
          })
        }
      })
    }

    // Add education chunks
    if (body.education && Array.isArray(body.education)) {
      body.education.forEach((edu: any) => {
        if (edu.school || edu.degree || edu.description) {
          chunks.push({
            chunk_text: `${edu.school || ''}\n${edu.degree || ''}\n${edu.description || ''}`.trim(),
            section: 'Education',
            company: edu.school || null,
            start_date: edu.start_date || null,
            end_date: edu.end_date || null,
          })
        }
      })
    }

    // Add volunteer chunks
    if (body.volunteer && Array.isArray(body.volunteer)) {
      body.volunteer.forEach((vol: any) => {
        if (vol.organization || vol.description) {
          chunks.push({
            chunk_text: `${vol.organization || ''}\n${vol.description || ''}`.trim(),
            section: 'Volunteer',
            company: vol.organization || null,
            start_date: vol.start_date || null,
            end_date: vol.end_date || null,
          })
        }
      })
    }

    // Generate embeddings and insert chunks
    if (chunks.length > 0) {
      const embeddings = await generateChunkEmbeddings(chunks)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = embeddings[i]
        const embeddingStr = `[${embedding.join(',')}]`

        const { error: chunkError } = await supabase.rpc('insert_resume_chunk', {
          p_resume_id: id,
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
    }

    return NextResponse.json({
      message: 'Resume updated successfully',
      chunks_count: chunks.length,
    })
  } catch (error) {
    console.error('Update resume error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabase()
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Resume ID is required' }, { status: 400 })
    }

    // Get resume to find the file path
    const { data: resume } = await supabase
      .from('resumes')
      .select('resume_url')
      .eq('id', id)
      .single()

    // Delete resume (chunks will be deleted via CASCADE)
    const { error: deleteError } = await supabase
      .from('resumes')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Delete resume error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete resume' },
        { status: 500 }
      )
    }

    // Optionally delete the file from storage
    if (resume?.resume_url) {
      const filePath = resume.resume_url.split('/').pop() || ''
      const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'resumes'
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath])
    }

    return NextResponse.json({
      message: 'Resume deleted successfully',
    })
  } catch (error) {
    console.error('Delete resume error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
