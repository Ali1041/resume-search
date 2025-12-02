import PDFParser from 'pdf2json'
import mammoth from 'mammoth'

export interface ParsedResume {
  text: string
  rawText: string
}

/**
 * Parse PDF file and extract text using pdf2json
 */
async function parsePDFWithPDF2JSON(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const pdfParser = new PDFParser()
      let fullText = ''

      pdfParser.on('pdfParser_dataError', (errMsg: Error | { parserError: Error }) => {
        const error = errMsg instanceof Error ? errMsg : errMsg.parserError
        reject(new Error(`PDF parsing error: ${error.message || String(errMsg)}`))
      })

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        try {
          // Extract text from all pages
          if (pdfData.Pages && pdfData.Pages.length > 0) {
            fullText = pdfData.Pages.map((page: any) => {
              if (page.Texts && page.Texts.length > 0) {
                return page.Texts.map((text: any) => {
                  // Handle text array - pdf2json stores text in R array
                  if (text.R && text.R.length > 0) {
                    // Decode URI component if needed and join multiple text runs
                    return text.R.map((run: any) => {
                      try {
                        return decodeURIComponent(run.T || '')
                      } catch (e) {
                        // If decode fails, use raw text
                        return run.T || ''
                      }
                    }).join('')
                  }
                  return ''
                }).join(' ')
              }
              return ''
            }).join('\n')
          }

          resolve(fullText)
        } catch (error) {
          reject(new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`))
        }
      })

      // Parse the buffer
      pdfParser.parseBuffer(buffer)
    } catch (error) {
      reject(new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`))
    }
  })
}

/**
 * Parse PDF file and extract text using pdf2json
 */
export async function parsePDF(buffer: Buffer): Promise<ParsedResume> {
  let fullText = ''
  
  try {
    fullText = await parsePDFWithPDF2JSON(buffer)
    console.log('Successfully parsed PDF using pdf2json')
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Clean up the text
  fullText = fullText
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
    .trim()

  // Check if text appears to be garbled (too many single character repeats)
  const singleCharPattern = /(.)\1{20,}/g
  const garbledRatio = (fullText.match(singleCharPattern) || []).length
  const totalLines = fullText.split('\n').length
  
  if (garbledRatio > 0 && totalLines > 0) {
    // Check if more than 30% of the text is garbled
    const garbledLines = fullText.split('\n').filter(line => /(.)\1{10,}/.test(line)).length
    const garbledPercentage = (garbledLines / totalLines) * 100
    
    if (garbledPercentage > 30) {
      throw new Error(`PDF text extraction failed: The PDF appears to use custom fonts or encoding that cannot be read properly. ${Math.round(garbledPercentage)}% of the extracted text is garbled. Please ensure your PDF contains selectable text (not just images) and try converting it to a different format or using a PDF with standard fonts.`)
    }
    
    // Try to clean up garbled text if percentage is lower
    console.warn(`Warning: ${Math.round(garbledPercentage)}% of PDF text may be garbled. Attempting to clean...`)
    const lines = fullText.split('\n')
    const cleanedLines = lines.map(line => {
      // Remove lines that are mostly single character repeats
      if (/(.)\1{10,}/.test(line)) {
        return ''
      }
      return line
    }).filter(line => line.trim().length > 0)
    fullText = cleanedLines.join('\n')
  }

  if (!fullText || fullText.length < 10) {
    throw new Error('PDF text extraction returned empty or very short text. The PDF may be image-based, use custom fonts, or be corrupted. Please ensure the PDF contains selectable text.')
  }
  
  // Additional check: if cleaned text is too short, reject it
  if (fullText.length < 50) {
    throw new Error('PDF text extraction returned insufficient text after cleaning. The PDF may not be suitable for text extraction. Please ensure your PDF contains selectable text.')
  }

  return {
    text: fullText,
    rawText: fullText,
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

