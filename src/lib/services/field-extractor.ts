export interface ExtractedFields {
  name: string | null
  email: string | null
  phone: string | null
  linkedin: string | null
  location: string | null
  title: string | null
  skills: string[]
  experience_years: number | null
}

/**
 * Extract email addresses from text
 */
function extractEmail(text: string): string | null {
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi
  const matches = text.match(emailRegex)
  return matches && matches.length > 0 ? matches[0] : null
}

/**
 * Extract phone numbers from text
 */
function extractPhone(text: string): string | null {
  // Match various phone number formats
  const phoneRegex = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  const matches = text.match(phoneRegex)
  return matches && matches.length > 0 ? matches[0].replace(/\s/g, '') : null
}

/**
 * Extract LinkedIn URL from text
 */
function extractLinkedIn(text: string): string | null {
  const linkedinRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi
  const matches = text.match(linkedinRegex)
  return matches && matches.length > 0 ? matches[0] : null
}

/**
 * Extract location from text (basic implementation)
 */
function extractLocation(text: string): string | null {
  // Look for common location patterns like "City, State" or "City, Country"
  const locationRegex = /([A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+)/g
  const matches = text.match(locationRegex)
  return matches && matches.length > 0 ? matches[0] : null
}

/**
 * Extract job title from text (looks for common patterns)
 */
function extractTitle(text: string): string | null {
  // Common title patterns at the start of resume
  const titleRegex = /(?:^|\n)((?:Senior|Junior|Lead|Principal|Staff)?\s*(?:Software|Frontend|Backend|Full\s*Stack|DevOps|Data|ML|AI|Engineer|Developer|Architect|Manager|Analyst|Designer|Product|Marketing|Sales|HR|Finance|Operations)[\s\w]*)/i
  const match = text.match(titleRegex)
  return match && match[1] ? match[1].trim() : null
}

/**
 * Extract skills from text
 */
function extractSkills(text: string): string[] {
  const commonSkills = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust',
    'React', 'Vue', 'Angular', 'Node.js', 'Next.js', 'Express',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes',
    'AWS', 'Azure', 'GCP', 'GraphQL', 'REST API', 'Git',
    'Machine Learning', 'AI', 'Data Science', 'TensorFlow', 'PyTorch',
    'HTML', 'CSS', 'SCSS', 'Tailwind', 'Bootstrap',
  ]

  const foundSkills: string[] = []
  const lowerText = text.toLowerCase()

  for (const skill of commonSkills) {
    if (lowerText.includes(skill.toLowerCase())) {
      foundSkills.push(skill)
    }
  }

  return foundSkills
}

/**
 * Extract years of experience from text
 */
function extractExperienceYears(text: string): number | null {
  // Look for patterns like "5 years", "5+ years", "10+ years of experience"
  const experienceRegex = /(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/i
  const match = text.match(experienceRegex)
  if (match && match[1]) {
    return parseInt(match[1], 10)
  }
  return null
}

/**
 * Extract name from text (basic implementation - usually first line or header)
 */
function extractName(text: string): string | null {
  // Try to find name in first few lines (typically at the top of resume)
  const lines = text.split('\n').slice(0, 5).filter(line => line.trim().length > 0)
  
  // Look for capitalized name patterns (2-4 words, all capitalized)
  for (const line of lines) {
    const nameRegex = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/
    const match = line.trim().match(nameRegex)
    if (match && match[1] && !match[1].includes('@')) {
      return match[1]
    }
  }
  
  // Fallback: return first significant line
  if (lines.length > 0) {
    const firstLine = lines[0].trim()
    if (firstLine.length > 2 && firstLine.length < 50) {
      return firstLine
    }
  }
  
  return null
}

/**
 * Extract all structured fields from resume text
 */
export function extractFields(text: string): ExtractedFields {
  return {
    name: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    linkedin: extractLinkedIn(text),
    location: extractLocation(text),
    title: extractTitle(text),
    skills: extractSkills(text),
    experience_years: extractExperienceYears(text),
  }
}

