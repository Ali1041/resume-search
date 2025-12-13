import mammoth from 'mammoth'

export interface ParsedResume {
  text: string
  rawText: string
}

/**
 * Parse DOCX file and extract text
 * Note: PDF parsing is handled by Python service (python-pdf-service.ts)
 */
export async function parseDOCX(buffer: Buffer): Promise<ParsedResume> {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return {
      text: result.value,
      rawText: result.value,
    }
  } catch (error) {
    throw new Error(`Failed to parse DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
