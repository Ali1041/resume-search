'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import EditResumeForm from '@/components/EditResumeForm'

interface ResumeDetails {
  resume: {
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
  evidence: Array<{
    chunk_id: string
    chunk_text: string
    section: string | null
    company: string | null
    start_date: string | null
    end_date: string | null
  }>
}

interface OrganizedChunks {
  [key: string]: Array<{
    chunk_id: string
    chunk_text: string
    company: string | null
    start_date: string | null
    end_date: string | null
  }>
}

export default function ResumeDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [resume, setResume] = useState<ResumeDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFullText, setShowFullText] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const fetchResume = async () => {
      try {
        const response = await fetch(`/api/resume/${id}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch resume')
        }

        setResume(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load resume')
      } finally {
        setLoading(false)
      }
    }

    if (id) {
      fetchResume()
    }
  }, [id])

  // Organize chunks by section
  const organizeChunks = (evidence: ResumeDetails['evidence']): OrganizedChunks => {
    const organized: OrganizedChunks = {}
    
    evidence.forEach((chunk) => {
      const section = chunk.section || 'Other'
      if (!organized[section]) {
        organized[section] = []
      }
      organized[section].push(chunk)
    })
    
    return organized
  }

  // Group experience by company
  const groupExperienceByCompany = (chunks: OrganizedChunks['Experience'] | undefined) => {
    if (!chunks) return []
    
    const grouped: { [key: string]: typeof chunks } = {}
    chunks.forEach((chunk) => {
      const company = chunk.company || 'Unknown Company'
      if (!grouped[company]) {
        grouped[company] = []
      }
      grouped[company].push(chunk)
    })
    
    return Object.entries(grouped).map(([company, items]) => ({
      company,
      items,
      dateRange: items[0]?.start_date && items[0]?.end_date
        ? `${items[0].start_date} - ${items[0].end_date || 'Present'}`
        : items[0]?.start_date || 'Date not specified'
    }))
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this resume? This action cannot be undone.')) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/resume/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete resume')
      }

      // Redirect to resumes list
      window.location.href = '/resumes'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete resume')
      setIsDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
        <Navigation />
        <main className="container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-black dark:border-zinc-50 mb-4"></div>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">Loading resume...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error || !resume) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
        <Navigation />
        <main className="container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center py-12">
            <p className="text-lg text-red-600 dark:text-red-400 mb-4">
              {error || 'Resume not found'}
            </p>
            <Link
              href="/resumes"
              className="text-black dark:text-zinc-50 hover:underline"
            >
              ← Back to Resumes
            </Link>
          </div>
        </main>
      </div>
    )
  }

  // Show edit form if in edit mode
  if (isEditing && resume) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
        <Navigation />
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-black dark:text-zinc-50 mb-2">Edit Resume</h1>
            <p className="text-zinc-600 dark:text-zinc-400">Make changes to the resume information</p>
          </div>
          <EditResumeForm
            resumeData={resume}
            resumeId={id}
            onCancel={() => setIsEditing(false)}
            onSave={() => setIsEditing(false)}
          />
        </main>
      </div>
    )
  }

  const { resume: r, evidence } = resume
  const organizedChunks = organizeChunks(evidence)
  
  // Normalize section names - handle variations
  const getSectionChunks = (sectionName: string, variations: string[]) => {
    for (const variation of variations) {
      if (organizedChunks[variation] && organizedChunks[variation].length > 0) {
        return organizedChunks[variation]
      }
    }
    return undefined
  }
  
  const experienceChunks = getSectionChunks('Experience', ['Experience', 'Work Experience', 'Employment'])
  const experienceGroups = groupExperienceByCompany(experienceChunks)
  const projectsChunks = getSectionChunks('Projects', ['Projects', 'Project'])
  const volunteerChunks = getSectionChunks('Volunteer', ['Volunteer', 'Volunteer Work', 'Volunteering', 'Community Service'])
  const educationChunks = getSectionChunks('Education', ['Education', 'Academic'])
  const summaryChunks = getSectionChunks('Summary', ['Summary', 'Objective', 'Profile', 'Professional Summary'])

  const SectionCard = ({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) => (
    <div className="bg-white rounded-xl shadow-lg dark:bg-zinc-900 p-8 mb-6">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        {icon && <div className="text-black dark:text-zinc-50">{icon}</div>}
        <h2 className="text-2xl font-bold text-black dark:text-zinc-50">{title}</h2>
      </div>
      {children}
    </div>
  )


  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <Navigation />
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Back Button */}
        <Link
          href="/resumes"
          className="inline-flex items-center gap-2 text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50 mb-6 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Resumes
        </Link>

        {/* 1. PROFILE INFO SECTION */}
        <div className="bg-gradient-to-br from-black to-zinc-800 dark:from-zinc-900 dark:to-black rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-5xl font-bold mb-3">{r.name || 'Unknown Candidate'}</h1>
              {r.title && (
                <p className="text-2xl text-zinc-200 mb-4">{r.title}</p>
              )}
              {r.experience_years && (
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-lg mb-4">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold">{r.experience_years} Years of Experience</span>
                </div>
              )}
              {summaryChunks && summaryChunks.length > 0 && (
                <p className="text-zinc-200 leading-relaxed mt-4 text-lg">
                  {summaryChunks.map(c => c.chunk_text).join(' ')}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {r.resume_url && (
                <a
                  href={r.resume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black rounded-xl hover:bg-zinc-100 transition-colors font-medium whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  View PDF
                </a>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-xl transition-colors font-medium whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2. CONTACT INFO SECTION */}
        <SectionCard
          title="Contact Information"
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {r.email && (
              <a
                href={`mailto:${r.email}`}
                className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors group"
              >
                <div className="w-10 h-10 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white dark:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Email</div>
                  <div className="text-zinc-900 dark:text-zinc-50 font-medium group-hover:text-black dark:group-hover:text-white">
                    {r.email}
                  </div>
                </div>
              </a>
            )}
            {r.phone && (
              <a
                href={`tel:${r.phone}`}
                className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors group"
              >
                <div className="w-10 h-10 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white dark:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Phone</div>
                  <div className="text-zinc-900 dark:text-zinc-50 font-medium group-hover:text-black dark:group-hover:text-white">
                    {r.phone}
                  </div>
                </div>
              </a>
            )}
            {r.location && (
              <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                <div className="w-10 h-10 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white dark:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Location</div>
                  <div className="text-zinc-900 dark:text-zinc-50 font-medium">{r.location}</div>
                </div>
              </div>
            )}
            {r.linkedin && (
              <a
                href={r.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors group"
              >
                <div className="w-10 h-10 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white dark:text-black" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">LinkedIn</div>
                  <div className="text-zinc-900 dark:text-zinc-50 font-medium group-hover:text-black dark:group-hover:text-white">
                    View Profile
                  </div>
                </div>
              </a>
            )}
          </div>
        </SectionCard>

        {/* 3. WORK EXPERIENCE SECTION */}
        {experienceGroups && experienceGroups.length > 0 && (
          <SectionCard
            title="Work Experience"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          >
            <div className="space-y-8">
              {experienceGroups.map((group, idx) => (
                <div key={idx} className="relative pl-8 pb-8 last:pb-0">
                  {/* Timeline line */}
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-200 dark:bg-zinc-700"></div>
                  {/* Timeline dot */}
                  <div className="absolute left-0 top-1 w-4 h-4 bg-black dark:bg-zinc-50 rounded-full -translate-x-1.5"></div>
                  
                  <div className="ml-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                      <h3 className="text-xl font-bold text-black dark:text-zinc-50">{group.company}</h3>
                      <span className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 md:mt-0 font-medium">
                        {group.dateRange}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {group.items.map((item, itemIdx) => (
                        <div key={itemIdx} className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                          {item.chunk_text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 4. PROJECTS SECTION */}
        {projectsChunks && projectsChunks.length > 0 && (
          <SectionCard
            title="Projects"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {projectsChunks.map((project, idx) => (
                <div key={idx} className="p-6 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-8 h-8 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white dark:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    {project.company && (
                      <h3 className="font-semibold text-black dark:text-zinc-50 text-lg">{project.company}</h3>
                    )}
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{project.chunk_text}</p>
                  {(project.start_date || project.end_date) && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">
                      {project.start_date} {project.end_date ? `- ${project.end_date}` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 5. VOLUNTEER WORK SECTION */}
        {volunteerChunks && volunteerChunks.length > 0 && (
          <SectionCard
            title="Volunteer Work"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            }
          >
            <div className="space-y-6">
              {volunteerChunks.map((volunteer, idx) => (
                <div key={idx} className="p-5 bg-zinc-50 dark:bg-zinc-800 rounded-lg border-l-4 border-green-500">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3">
                    {volunteer.company && (
                      <h3 className="font-semibold text-black dark:text-zinc-50 text-lg">{volunteer.company}</h3>
                    )}
                    {(volunteer.start_date || volunteer.end_date) && (
                      <span className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 md:mt-0">
                        {volunteer.start_date} {volunteer.end_date ? `- ${volunteer.end_date}` : ' - Present'}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{volunteer.chunk_text}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 6. EDUCATION SECTION */}
        {educationChunks && educationChunks.length > 0 && (
          <SectionCard
            title="Education"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 14l9-5-9-5-9 5 9 5z" />
                <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14v9m-4-4h8m-8 0l4-4m4 4l-4-4" />
              </svg>
            }
          >
            <div className="space-y-6">
              {educationChunks.map((edu, idx) => (
                <div key={idx} className="p-6 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3">
                    {edu.company && (
                      <h3 className="font-semibold text-black dark:text-zinc-50 text-lg mb-2 md:mb-0">{edu.company}</h3>
                    )}
                    {(edu.start_date || edu.end_date) && (
                      <span className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">
                        {edu.start_date} {edu.end_date ? `- ${edu.end_date}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{edu.chunk_text}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 7. SKILLS SECTION */}
        {r.skills && r.skills.length > 0 && (
          <SectionCard
            title="Skills"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            }
          >
            <div className="flex flex-wrap gap-3">
              {r.skills.map((skill, idx) => (
                <span
                  key={idx}
                  className="px-4 py-2 bg-gradient-to-r from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700 rounded-lg text-sm font-medium text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600 hover:shadow-md transition-shadow"
                >
                  {skill}
                </span>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Full Resume Text - Collapsible */}
        {r.resume_text && (
          <SectionCard
            title="Full Resume Text"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          >
            <button
              onClick={() => setShowFullText(!showFullText)}
              className="mb-4 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              {showFullText ? 'Hide' : 'Show'} Full Text
            </button>
            {showFullText && (
              <div className="bg-zinc-50 dark:bg-zinc-800 p-6 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <pre className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 font-sans leading-relaxed">
                  {r.resume_text}
                </pre>
              </div>
            )}
          </SectionCard>
        )}
      </main>
    </div>
  )
}
