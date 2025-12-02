import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '15', 10)

    // Fetch most recently created resumes
    const { data: resumes, error } = await supabase
      .from('resumes')
      .select('id, name, title, location, experience_years, skills, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching recent resumes:', error)
      return NextResponse.json(
        { error: 'Failed to fetch resumes' },
        { status: 500 }
      )
    }

    // Format as search results for consistency
    const results = (resumes || []).map((resume) => ({
      resume_id: resume.id,
      name: resume.name,
      title: resume.title,
      location: resume.location,
      experience_years: resume.experience_years,
      skills: resume.skills,
      score: 1.0, // Default score for recent resumes
      similarity: 1.0,
      evidence: [], // No evidence for recent resumes (not from search)
    }))

    return NextResponse.json({
      results,
      total: results.length,
    })
  } catch (error) {
    console.error('Recent resumes error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

