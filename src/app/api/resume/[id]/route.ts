import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'

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

    // Get top evidence chunks (sorted by creation date, can be enhanced with relevance)
    const { data: chunks, error: chunksError } = await supabase
      .from('resume_chunks')
      .select('id, chunk_text, section, company, start_date, end_date, created_at')
      .eq('resume_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

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

