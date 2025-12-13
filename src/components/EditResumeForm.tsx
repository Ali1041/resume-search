'use client'

import { useState, useEffect } from 'react'

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

interface EditResumeFormProps {
  resumeData: ResumeDetails
  resumeId: string
  onCancel: () => void
  onSave: () => void
}

interface ExperienceItem {
  id: string
  company: string
  title: string
  start_date: string
  end_date: string
  description: string
}

interface ProjectItem {
  id: string
  name: string
  start_date: string
  end_date: string
  description: string
}

interface EducationItem {
  id: string
  school: string
  degree: string
  start_date: string
  end_date: string
  description: string
}

interface VolunteerItem {
  id: string
  organization: string
  start_date: string
  end_date: string
  description: string
}

export default function EditResumeForm({ resumeData, resumeId, onCancel, onSave }: EditResumeFormProps) {
  const [formData, setFormData] = useState({
    name: resumeData.resume.name || '',
    email: resumeData.resume.email || '',
    phone: resumeData.resume.phone || '',
    linkedin: resumeData.resume.linkedin || '',
    location: resumeData.resume.location || '',
    title: resumeData.resume.title || '',
    experience_years: resumeData.resume.experience_years || 0,
    skills: resumeData.resume.skills || [],
  })

  const [experiences, setExperiences] = useState<ExperienceItem[]>([])
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [education, setEducation] = useState<EducationItem[]>([])
  const [volunteer, setVolunteer] = useState<VolunteerItem[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Organize chunks into structured sections
    const organized: { [key: string]: typeof resumeData.evidence } = {}
    resumeData.evidence.forEach((chunk) => {
      const section = chunk.section || 'Other'
      if (!organized[section]) {
        organized[section] = []
      }
      organized[section].push(chunk)
    })

    // Parse Experience
    const expChunks = organized['Experience'] || organized['Work Experience'] || []
    const expGrouped: { [key: string]: typeof expChunks } = {}
    expChunks.forEach((chunk) => {
      const company = chunk.company || 'Unknown Company'
      if (!expGrouped[company]) {
        expGrouped[company] = []
      }
      expGrouped[company].push(chunk)
    })

    const expItems: ExperienceItem[] = Object.entries(expGrouped).map(([company, chunks]) => ({
      id: chunks[0].chunk_id,
      company,
      title: chunks[0].chunk_text.split('\n')[0] || '',
      start_date: chunks[0].start_date || '',
      end_date: chunks[0].end_date || '',
      description: chunks.map(c => c.chunk_text).join('\n'),
    }))
    setExperiences(expItems)

    // Parse Projects
    const projChunks = organized['Projects'] || organized['Project'] || []
    const projItems: ProjectItem[] = projChunks.map((chunk) => ({
      id: chunk.chunk_id,
      name: chunk.company || chunk.chunk_text.split('\n')[0] || '',
      start_date: chunk.start_date || '',
      end_date: chunk.end_date || '',
      description: chunk.chunk_text,
    }))
    setProjects(projItems)

    // Parse Education
    const eduChunks = organized['Education'] || []
    const eduItems: EducationItem[] = eduChunks.map((chunk) => ({
      id: chunk.chunk_id,
      school: chunk.company || chunk.chunk_text.split('\n')[0] || '',
      degree: chunk.chunk_text.split('\n')[1] || '',
      start_date: chunk.start_date || '',
      end_date: chunk.end_date || '',
      description: chunk.chunk_text,
    }))
    setEducation(eduItems)

    // Parse Volunteer
    const volChunks = organized['Volunteer'] || organized['Volunteer Work'] || []
    const volItems: VolunteerItem[] = volChunks.map((chunk) => ({
      id: chunk.chunk_id,
      organization: chunk.company || chunk.chunk_text.split('\n')[0] || '',
      start_date: chunk.start_date || '',
      end_date: chunk.end_date || '',
      description: chunk.chunk_text,
    }))
    setVolunteer(volItems)
  }, [resumeData])

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/resume/${resumeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          experiences,
          projects,
          education,
          volunteer,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update resume')
      }

      onSave()
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save changes')
      setSaving(false)
    }
  }

  const addExperience = () => {
    setExperiences([...experiences, {
      id: `new-${Date.now()}`,
      company: '',
      title: '',
      start_date: '',
      end_date: '',
      description: '',
    }])
  }

  const removeExperience = (index: number) => {
    setExperiences(experiences.filter((_, i) => i !== index))
  }

  const addProject = () => {
    setProjects([...projects, {
      id: `new-${Date.now()}`,
      name: '',
      start_date: '',
      end_date: '',
      description: '',
    }])
  }

  const removeProject = (index: number) => {
    setProjects(projects.filter((_, i) => i !== index))
  }

  const addEducation = () => {
    setEducation([...education, {
      id: `new-${Date.now()}`,
      school: '',
      degree: '',
      start_date: '',
      end_date: '',
      description: '',
    }])
  }

  const removeEducation = (index: number) => {
    setEducation(education.filter((_, i) => i !== index))
  }

  const addVolunteer = () => {
    setVolunteer([...volunteer, {
      id: `new-${Date.now()}`,
      organization: '',
      start_date: '',
      end_date: '',
      description: '',
    }])
  }

  const removeVolunteer = (index: number) => {
    setVolunteer(volunteer.filter((_, i) => i !== index))
  }

  const addSkill = () => {
    const skill = prompt('Enter skill name:')
    if (skill) {
      setFormData({ ...formData, skills: [...formData.skills, skill] })
    }
  }

  const removeSkill = (index: number) => {
    setFormData({ ...formData, skills: formData.skills.filter((_, i) => i !== index) })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Side - Form */}
      <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] pr-4">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-6 text-black dark:text-zinc-50">Profile Information</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Years of Experience</label>
              <input
                type="number"
                value={formData.experience_years}
                onChange={(e) => setFormData({ ...formData, experience_years: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-6 text-black dark:text-zinc-50">Contact Information</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-700 dark:text-zinc-300">LinkedIn</label>
              <input
                type="url"
                value={formData.linkedin}
                onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
                className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
              />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-black dark:text-zinc-50">Work Experience</h2>
            <button
              onClick={addExperience}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add
            </button>
          </div>
          
          <div className="space-y-4">
            {experiences.map((exp, idx) => (
              <div key={idx} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-black dark:text-zinc-50">Experience {idx + 1}</h3>
                  <button
                    onClick={() => removeExperience(idx)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Company"
                    value={exp.company}
                    onChange={(e) => {
                      const updated = [...experiences]
                      updated[idx].company = e.target.value
                      setExperiences(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <input
                    type="text"
                    placeholder="Job Title"
                    value={exp.title}
                    onChange={(e) => {
                      const updated = [...experiences]
                      updated[idx].title = e.target.value
                      setExperiences(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Start Date"
                      value={exp.start_date}
                      onChange={(e) => {
                        const updated = [...experiences]
                        updated[idx].start_date = e.target.value
                        setExperiences(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                    <input
                      type="text"
                      placeholder="End Date"
                      value={exp.end_date}
                      onChange={(e) => {
                        const updated = [...experiences]
                        updated[idx].end_date = e.target.value
                        setExperiences(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                  </div>
                  <textarea
                    placeholder="Description"
                    value={exp.description}
                    onChange={(e) => {
                      const updated = [...experiences]
                      updated[idx].description = e.target.value
                      setExperiences(updated)
                    }}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-black dark:text-zinc-50">Projects</h2>
            <button
              onClick={addProject}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add
            </button>
          </div>
          
          <div className="space-y-4">
            {projects.map((proj, idx) => (
              <div key={idx} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-black dark:text-zinc-50">Project {idx + 1}</h3>
                  <button
                    onClick={() => removeProject(idx)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Project Name"
                    value={proj.name}
                    onChange={(e) => {
                      const updated = [...projects]
                      updated[idx].name = e.target.value
                      setProjects(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Start Date"
                      value={proj.start_date}
                      onChange={(e) => {
                        const updated = [...projects]
                        updated[idx].start_date = e.target.value
                        setProjects(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                    <input
                      type="text"
                      placeholder="End Date"
                      value={proj.end_date}
                      onChange={(e) => {
                        const updated = [...projects]
                        updated[idx].end_date = e.target.value
                        setProjects(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                  </div>
                  <textarea
                    placeholder="Description"
                    value={proj.description}
                    onChange={(e) => {
                      const updated = [...projects]
                      updated[idx].description = e.target.value
                      setProjects(updated)
                    }}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-black dark:text-zinc-50">Education</h2>
            <button
              onClick={addEducation}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add
            </button>
          </div>
          
          <div className="space-y-4">
            {education.map((edu, idx) => (
              <div key={idx} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-black dark:text-zinc-50">Education {idx + 1}</h3>
                  <button
                    onClick={() => removeEducation(idx)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="School/University"
                    value={edu.school}
                    onChange={(e) => {
                      const updated = [...education]
                      updated[idx].school = e.target.value
                      setEducation(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <input
                    type="text"
                    placeholder="Degree"
                    value={edu.degree}
                    onChange={(e) => {
                      const updated = [...education]
                      updated[idx].degree = e.target.value
                      setEducation(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Start Date"
                      value={edu.start_date}
                      onChange={(e) => {
                        const updated = [...education]
                        updated[idx].start_date = e.target.value
                        setEducation(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                    <input
                      type="text"
                      placeholder="End Date"
                      value={edu.end_date}
                      onChange={(e) => {
                        const updated = [...education]
                        updated[idx].end_date = e.target.value
                        setEducation(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                  </div>
                  <textarea
                    placeholder="Description"
                    value={edu.description}
                    onChange={(e) => {
                      const updated = [...education]
                      updated[idx].description = e.target.value
                      setEducation(updated)
                    }}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-black dark:text-zinc-50">Volunteer Work</h2>
            <button
              onClick={addVolunteer}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add
            </button>
          </div>
          
          <div className="space-y-4">
            {volunteer.map((vol, idx) => (
              <div key={idx} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-black dark:text-zinc-50">Volunteer {idx + 1}</h3>
                  <button
                    onClick={() => removeVolunteer(idx)}
                    className="text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Organization"
                    value={vol.organization}
                    onChange={(e) => {
                      const updated = [...volunteer]
                      updated[idx].organization = e.target.value
                      setVolunteer(updated)
                    }}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Start Date"
                      value={vol.start_date}
                      onChange={(e) => {
                        const updated = [...volunteer]
                        updated[idx].start_date = e.target.value
                        setVolunteer(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                    <input
                      type="text"
                      placeholder="End Date"
                      value={vol.end_date}
                      onChange={(e) => {
                        const updated = [...volunteer]
                        updated[idx].end_date = e.target.value
                        setVolunteer(updated)
                      }}
                      className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                    />
                  </div>
                  <textarea
                    placeholder="Description"
                    value={vol.description}
                    onChange={(e) => {
                      const updated = [...volunteer]
                      updated[idx].description = e.target.value
                      setVolunteer(updated)
                    }}
                    rows={3}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-black dark:text-zinc-50"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-black dark:text-zinc-50">Skills</h2>
            <button
              onClick={addSkill}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add
            </button>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {formData.skills.map((skill, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <span className="text-black dark:text-zinc-50">{skill}</span>
                <button
                  onClick={() => removeSkill(idx)}
                  className="text-red-600 hover:text-red-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-4 pb-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-blue-400 transition-colors font-medium"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-6 py-3 bg-zinc-200 dark:bg-zinc-700 text-black dark:text-zinc-50 rounded-xl hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Right Side - PDF Preview */}
      <div className="sticky top-4 h-fit">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-4 text-black dark:text-zinc-50">PDF Preview</h2>
          {resumeData.resume.resume_url ? (
            <iframe
              src={resumeData.resume.resume_url}
              className="w-full h-[calc(100vh-250px)] border border-zinc-200 dark:border-zinc-700 rounded-lg"
              title="Resume PDF Preview"
            />
          ) : (
            <div className="w-full h-[calc(100vh-250px)] border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400">
              No PDF available
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

