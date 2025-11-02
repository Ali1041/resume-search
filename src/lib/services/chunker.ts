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
  const companyPatterns = [
    /(?:at|@|for)\s+([A-Z][a-zA-Z\s&]+)/,
    /^([A-Z][a-zA-Z\s&]+)\s*(?:Inc|LLC|Corp|Ltd|Company)?$/m,
  ]

  for (const pattern of companyPatterns) {
    const match = chunkText.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }

  return null
}

/**
 * Extract dates from chunk text
 */
function extractDates(chunkText: string): { start_date: string | null; end_date: string | null } {
  // Common date patterns: "Jan 2020 - Dec 2022", "2020-2022", "Jan 2020 - Present"
  const datePatterns = [
    /(\w+\s+\d{4})\s*[-–]\s*(\w+\s+\d{4}|Present|Current)/i,
    /(\d{4})\s*[-–]\s*(\d{4}|Present|Current)/,
    /(\w+\s+\d{4})\s+to\s+(\w+\s+\d{4}|Present|Current)/i,
  ]

  for (const pattern of datePatterns) {
    const match = chunkText.match(pattern)
    if (match && match[1] && match[2]) {
      return {
        start_date: match[1].trim(),
        end_date: match[2].trim() === 'Present' || match[2].trim() === 'Current' ? null : match[2].trim(),
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

  // Section keywords to identify sections
  const sectionKeywords: Record<string, string> = {
    'experience': 'Experience',
    'work experience': 'Experience',
    'employment': 'Experience',
    'professional experience': 'Experience',
    'education': 'Education',
    'skills': 'Skills',
    'technical skills': 'Skills',
    'projects': 'Projects',
    'certifications': 'Certifications',
    'awards': 'Awards',
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
      if (lowerLine === keyword || lowerLine.startsWith(keyword + ':') || lowerLine === keyword.toUpperCase()) {
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

