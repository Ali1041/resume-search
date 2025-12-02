export interface Chunk {
  chunk_text: string
  section: string | null
  company: string | null
  start_date: string | null
  end_date: string | null
}

/**
 * Extract section headers from resume text
 */
function findSections(text: string): string[] {
  const sectionKeywords = [
    'experience', 'work experience', 'employment', 'professional experience',
    'education', 'skills', 'technical skills', 'projects',
    'certifications', 'awards', 'publications', 'languages',
    'summary', 'objective', 'profile'
  ]

  const sections: string[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim()
    for (const keyword of sectionKeywords) {
      if (lowerLine === keyword || lowerLine.startsWith(keyword + ':') || lowerLine.startsWith(keyword + ':')) {
        sections.push(keyword)
        break
      }
    }
  }

  return sections
}

/**
 * Extract company name from chunk text
 */
function extractCompany(chunkText: string): string | null {
  // Common patterns: "Company Name" or "at Company Name"
  // Also look for company names at the start of lines or after common prefixes
  const companyPatterns = [
    /(?:at|@|for|with|company:|organization:)\s+([A-Z][a-zA-Z0-9\s&.,-]+?)(?:\s|$|,|\.|;)/i,
    /^([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)?$/m,
    /([A-Z][a-zA-Z0-9\s&.,-]{2,40})\s*(?:Inc|LLC|Corp|Ltd|Company|Technologies|Systems|Solutions|Group)\b/i,
    // Look for company names in experience sections (usually first line)
    /^([A-Z][a-zA-Z0-9\s&.,-]{2,40})(?:\s|$)/m,
  ]

  for (const pattern of companyPatterns) {
    const match = chunkText.match(pattern)
    if (match && match[1]) {
      const company = match[1].trim()
      // Filter out common false positives
      if (company.length > 2 && 
          company.length < 50 && 
          !company.toLowerCase().includes('university') &&
          !company.toLowerCase().includes('college') &&
          !company.toLowerCase().includes('school')) {
        return company
      }
    }
  }

  return null
}

/**
 * Extract dates from chunk text
 */
function extractDates(chunkText: string): { start_date: string | null; end_date: string | null } {
  // Common date patterns: "Jan 2020 - Dec 2022", "2020-2022", "Jan 2020 - Present"
  // Also handle formats like "01/2020 - 12/2022", "January 2020 - December 2022"
  const datePatterns = [
    // Full month names: "January 2020 - December 2022"
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*[-–]\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|Present|Current)/i,
    // Abbreviated months: "Jan 2020 - Dec 2022"
    /(\w{3,9}\s+\d{4})\s*[-–]\s*(\w{3,9}\s+\d{4}|Present|Current)/i,
    // Year only: "2020 - 2022"
    /(\d{4})\s*[-–]\s*(\d{4}|Present|Current)/,
    // "to" format: "Jan 2020 to Dec 2022"
    /(\w+\s+\d{4})\s+to\s+(\w+\s+\d{4}|Present|Current)/i,
    // MM/YYYY format: "01/2020 - 12/2022"
    /(\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{4}|Present|Current)/,
    // Single date (start only): "Jan 2020 - Present"
    /(\w+\s+\d{4})\s*[-–]\s*(Present|Current)/i,
  ]

  for (const pattern of datePatterns) {
    const match = chunkText.match(pattern)
    if (match && match[1]) {
      const startDate = match[1].trim()
      const endDate = match[2] ? match[2].trim() : null
      return {
        start_date: startDate,
        end_date: endDate && (endDate === 'Present' || endDate === 'Current') ? null : endDate,
      }
    }
  }

  return { start_date: null, end_date: null }
}

/**
 * Chunk resume text into smaller pieces
 * Splits by sections first, then by bullets/paragraphs within sections
 */
export function chunkResumeText(text: string): Chunk[] {
  const chunks: Chunk[] = []
  const lines = text.split('\n')
  
  let currentSection: string | null = null
  let currentChunk: string[] = []
  const minChunkLength = 50 // Minimum characters per chunk
  const maxChunkLength = 500 // Maximum characters per chunk

  // Section keywords to identify sections - comprehensive mapping
  const sectionKeywords: Record<string, string> = {
    // Work Experience variations
    'experience': 'Experience',
    'work experience': 'Experience',
    'employment': 'Experience',
    'professional experience': 'Experience',
    'work history': 'Experience',
    'employment history': 'Experience',
    'career history': 'Experience',
    'professional history': 'Experience',
    
    // Education variations
    'education': 'Education',
    'academic': 'Education',
    'academic background': 'Education',
    'educational background': 'Education',
    'academic qualifications': 'Education',
    'qualifications': 'Education',
    
    // Projects variations
    'projects': 'Projects',
    'project': 'Projects',
    'personal projects': 'Projects',
    'side projects': 'Projects',
    'project experience': 'Projects',
    'portfolio': 'Projects',
    
    // Volunteer Work variations
    'volunteer': 'Volunteer',
    'volunteer work': 'Volunteer',
    'volunteering': 'Volunteer',
    'volunteer experience': 'Volunteer',
    'community service': 'Volunteer',
    'volunteer activities': 'Volunteer',
    
    // Skills variations
    'skills': 'Skills',
    'technical skills': 'Skills',
    'core skills': 'Skills',
    'competencies': 'Skills',
    'technical competencies': 'Skills',
    'proficiencies': 'Skills',
    'expertise': 'Skills',
    
    // Profile/Summary variations
    'summary': 'Summary',
    'professional summary': 'Summary',
    'summary of qualifications': 'Summary',
    'objective': 'Summary',
    'career objective': 'Summary',
    'profile': 'Summary',
    'professional profile': 'Summary',
    'about': 'Summary',
    'about me': 'Summary',
    
    // Contact Info (usually extracted separately, but can be in chunks)
    'contact': 'Contact',
    'contact information': 'Contact',
    'contact details': 'Contact',
    
    // Other common sections
    'certifications': 'Certifications',
    'certification': 'Certifications',
    'awards': 'Awards',
    'honors': 'Awards',
    'publications': 'Publications',
    'languages': 'Languages',
    'interests': 'Interests',
    'hobbies': 'Interests',
  }

  function flushCurrentChunk() {
    if (currentChunk.length > 0) {
      const chunkText = currentChunk.join('\n').trim()
      if (chunkText.length >= minChunkLength) {
        const { start_date, end_date } = extractDates(chunkText)
        const company = extractCompany(chunkText)
        
        chunks.push({
          chunk_text: chunkText,
          section: currentSection,
          company,
          start_date,
          end_date,
        })
      }
      currentChunk = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lowerLine = line.toLowerCase()

    // Check if this line is a section header
    let isSectionHeader = false
    for (const [keyword, sectionName] of Object.entries(sectionKeywords)) {
      // More flexible matching: exact match, starts with, contains as whole word, or all caps
      const keywordLower = keyword.toLowerCase()
      const isExactMatch = lowerLine === keywordLower || lowerLine === keywordLower.toUpperCase()
      const startsWithKeyword = lowerLine.startsWith(keywordLower + ':') || 
                                 lowerLine.startsWith(keywordLower + ' ') ||
                                 lowerLine.startsWith(keywordLower.toUpperCase() + ':') ||
                                 lowerLine.startsWith(keywordLower.toUpperCase() + ' ')
      // Check if line contains the keyword as a whole word and is short (likely a header)
      const containsAsWord = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lowerLine) && 
                            (lowerLine.length < 50) // Only if it's a short line (likely a header)
      
      if (isExactMatch || startsWithKeyword || containsAsWord) {
        flushCurrentChunk()
        currentSection = sectionName
        isSectionHeader = true
        break
      }
    }

    if (!isSectionHeader && line.length > 0) {
      // Check if this is a bullet point or new item
      const isBullet = /^[•\-\*\+]\s/.test(line) || /^\d+\.\s/.test(line)
      const currentText = currentChunk.join('\n')

      // If we hit a bullet and current chunk is getting large, or if we've exceeded max length
      if ((isBullet && currentText.length > maxChunkLength / 2) || currentText.length > maxChunkLength) {
        flushCurrentChunk()
      }

      currentChunk.push(line)
    } else if (line.length === 0 && currentChunk.length > 0) {
      // Empty line might indicate end of a chunk
      if (currentChunk.join('\n').length > minChunkLength) {
        flushCurrentChunk()
      }
    }
  }

  // Flush any remaining chunk
  flushCurrentChunk()

  // If we didn't create any chunks (maybe no clear sections), create sliding window chunks
  if (chunks.length === 0) {
    return createSlidingWindowChunks(text, minChunkLength, maxChunkLength)
  }

  return chunks
}

/**
 * Create chunks using sliding window approach (fallback)
 */
function createSlidingWindowChunks(
  text: string,
  minLength: number,
  maxLength: number
): Chunk[] {
  const chunks: Chunk[] = []
  const overlap = 50 // 50 character overlap between chunks
  
  let start = 0
  while (start < text.length) {
    let end = start + maxLength
    
    // Try to end at a sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end)
      const lastNewline = text.lastIndexOf('\n', end)
      const boundary = Math.max(lastPeriod, lastNewline)
      
      if (boundary > start + minLength) {
        end = boundary + 1
      }
    }

    const chunkText = text.slice(start, end).trim()
    if (chunkText.length >= minLength) {
      chunks.push({
        chunk_text: chunkText,
        section: null,
        company: null,
        start_date: null,
        end_date: null,
      })
    }

    start = end - overlap
    if (start >= text.length) break
  }

  return chunks
}

