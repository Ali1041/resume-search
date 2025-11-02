import pdfParse from 'pdf-parse'
import mammoth from 'mammoth'

export interface ParsedResume {
  text: string
  rawText: string
}

/**
 * Parse PDF file and extract text
 */
export async function parsePDF(buffer: Buffer): Promise<ParsedResume> {
  try {
    const data = await pdfParse(buffer)
    return {
      text: data.text,
      rawText: data.text,
    }
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Parse DOCX file and extract text
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

/**
 * Parse resume file based on file extension
 */
export async function parseResumeFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedResume> {
  const extension = filename.toLowerCase().split('.').pop()

  switch (extension) {
    case 'pdf':
      return parsePDF(buffer)
    case 'docx':
    case 'doc':
      return parseDOCX(buffer)
    default:
      throw new Error(`Unsupported file type: ${extension}`)
  }
}

