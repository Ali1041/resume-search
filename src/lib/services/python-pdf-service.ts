import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

// Use absolute path to avoid symlink issues
const PYTHON_SCRIPT_DIR = path.resolve(process.cwd(), 'pdf_parser')

interface ExperienceItem {
  company: string | null
  title: string | null
  start_date: string | null
  end_date: string | null
  description: string
}

interface ProjectItem {
  name: string | null
  start_date: string | null
  end_date: string | null
  description: string
}

interface EducationItem {
  school: string | null
  degree: string | null
  start_date: string | null
  end_date: string | null
  description: string
}

interface ExtractedFields {
  name: string | null
  email: string | null
  phone: string | null
  linkedin: string | null
  location: string | null
  title: string | null
  skills: string[]
  experience: ExperienceItem[]
  projects: ProjectItem[]
  education: EducationItem[]
  raw_text: string
}

interface Chunk {
  chunk_text: string
  section: string | null
  company: string | null
  start_date: string | null
  end_date: string | null
}

/**
 * Check if Python is available
 */
async function checkPython(): Promise<boolean> {
  try {
    await execAsync('python3 --version')
    return true
  } catch {
    try {
      await execAsync('python --version')
      return true
    } catch {
      return false
    }
  }
}

/**
 * Get Python command (python3 or python)
 * Uses virtual environment if available
 */
async function getPythonCommand(): Promise<string> {
  // Try venv Python first (absolute path)
  const venvPath = path.resolve(PYTHON_SCRIPT_DIR, 'venv', 'bin', 'python3')
  
  try {
    await fs.access(venvPath)
    console.log(`Using virtual environment Python: ${venvPath}`)
    return venvPath
  } catch {
    // Fallback to system Python
    console.log('Virtual environment not found, using system Python')
    try {
      await execAsync('python3 --version')
      return 'python3'
    } catch {
      return 'python'
    }
  }
}

/**
 * Extract fields from PDF using Python
 */
export async function extractFieldsFromPDF(buffer: Buffer, filename: string): Promise<ExtractedFields> {
  // Check Python availability
  const hasPython = await checkPython()
  if (!hasPython) {
    throw new Error('Python is not installed. Please install Python 3.7+ to use PDF extraction.')
  }

  const pythonCmd = await getPythonCommand()
  const scriptPath = path.join(PYTHON_SCRIPT_DIR, 'extract_fields.py')

  // Check if script exists
  try {
    await fs.access(scriptPath)
  } catch {
    throw new Error(`Python script not found at ${scriptPath}`)
  }

  // Create temporary file for PDF
  const tempDir = tmpdir()
  const tempFilePath = path.join(tempDir, `resume_${Date.now()}_${filename}`)
  
  try {
    // Write buffer to temp file
    await fs.writeFile(tempFilePath, buffer)

    // Execute Python script with absolute paths
    const absoluteScriptPath = path.resolve(scriptPath)
    const absoluteTempPath = path.resolve(tempFilePath)
    
    console.log(`Executing: ${pythonCmd} "${absoluteScriptPath}" "${absoluteTempPath}"`)
    
    const { stdout, stderr } = await execAsync(
      `"${pythonCmd}" "${absoluteScriptPath}" "${absoluteTempPath}"`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    )

    if (stderr && !stderr.includes('Warning')) {
      console.warn('Python script stderr:', stderr)
    }

    // Parse JSON output
    const result = JSON.parse(stdout.trim())

    if (result.error) {
      throw new Error(result.error)
    }

    return {
      name: result.name || null,
      email: result.email || null,
      phone: result.phone || null,
      linkedin: result.linkedin || null,
      location: result.location || null,
      title: result.title || null,
      skills: result.skills || [],
      experience: result.experience || [],
      projects: result.projects || [],
      education: result.education || [],
      raw_text: result.raw_text || '',
    }
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tempFilePath)
    } catch (err) {
      console.warn('Failed to delete temp file:', err)
    }
  }
}

/**
 * Chunk text using Python
 */
export async function chunkTextWithPython(text: string): Promise<Chunk[]> {
  const hasPython = await checkPython()
  if (!hasPython) {
    throw new Error('Python is not installed')
  }

  const pythonCmd = await getPythonCommand()
  const scriptPath = path.join(PYTHON_SCRIPT_DIR, 'chunk_text.py')

    try {
      // Write text to temp file to avoid command line issues
      const tempDir = tmpdir()
      const tempTextFile = path.join(tempDir, `chunk_text_${Date.now()}.txt`)
      
      try {
        await fs.writeFile(tempTextFile, text, 'utf-8')
        
        // Execute Python script with absolute paths
        const absoluteScriptPath = path.resolve(scriptPath)
        const absoluteTempPath = path.resolve(tempTextFile)
        
        const { stdout, stderr } = await execAsync(
          `"${pythonCmd}" "${absoluteScriptPath}" "${absoluteTempPath}"`,
          { maxBuffer: 10 * 1024 * 1024 }
        )

      if (stderr && !stderr.includes('Warning')) {
        console.warn('Python chunking stderr:', stderr)
      }

      const result = JSON.parse(stdout.trim())

      if (result.error) {
        throw new Error(result.error)
      }

      return result.chunks || []
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempTextFile)
      } catch (err) {
        console.warn('Failed to delete temp text file:', err)
      }
    }
  } catch (error) {
    console.error('Python chunking error:', error)
    throw error
  }
}

