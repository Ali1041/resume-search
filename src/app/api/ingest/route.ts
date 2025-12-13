import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'
import { extractFieldsFromPDF, chunkTextWithPython } from '@/lib/services/python-pdf-service'
import { parseDOCX } from '@/lib/services/parser'
import { generateChunkEmbeddings } from '@/lib/services/embedding'
import { extractFields } from '@/lib/services/field-extractor'
import { chunkResumeText } from '@/lib/services/chunker'

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'resumes'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabase()
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    const fileName = file.name
    const extension = fileName.toLowerCase().split('.').pop()
    if (!['pdf', 'docx', 'doc'].includes(extension || '')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Only PDF and DOCX are supported.' },
        { status: 400 }
      )
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Step 1: Extract fields and text using Python for PDFs, Node.js for DOCX
    let fields: any
    let rawText: string
    
    if (extension === 'pdf') {
      // PDF files - use Python only
      console.log('Using Python for PDF extraction...')
      try {
        const extracted = await extractFieldsFromPDF(buffer, fileName)
        fields = {
          name: extracted.name,
          email: extracted.email,
          phone: extracted.phone,
          linkedin: extracted.linkedin,
          location: extracted.location,
          title: extracted.title,
          skills: extracted.skills,
          experience_years: null,
        }
        rawText = extracted.raw_text
        
        // Log structured sections
        console.log(`  Experience entries: ${extracted.experience?.length || 0}`)
        console.log(`  Project entries: ${extracted.projects?.length || 0}`)
        console.log(`  Education entries: ${extracted.education?.length || 0}`)
        
        if (!rawText || rawText.trim().length < 50) {
          return NextResponse.json(
            { error: 'Failed to extract meaningful text from PDF. The PDF may be image-based or corrupted.' },
            { status: 400 }
          )
        }
        
        console.log(`✓ Python extraction successful`)
        console.log(`  Name: ${fields.name || 'Not found'}`)
        console.log(`  Email: ${fields.email || 'Not found'}`)
        console.log(`  Phone: ${fields.phone || 'Not found'}`)
        console.log(`  Title: ${fields.title || 'Not found'}`)
        console.log(`  Skills: ${fields.skills.length} found`)
        console.log(`  Text length: ${rawText.length} characters`)
        
        // Log structured sections if available
        if (extracted.experience && extracted.experience.length > 0) {
          console.log(`  Experience entries: ${extracted.experience.length}`)
          extracted.experience.forEach((exp: any, idx: number) => {
            console.log(`    ${idx + 1}. ${exp.company || 'Unknown'} - ${exp.title || 'No title'}`)
          })
        }
        if (extracted.projects && extracted.projects.length > 0) {
          console.log(`  Project entries: ${extracted.projects.length}`)
        }
        if (extracted.education && extracted.education.length > 0) {
          console.log(`  Education entries: ${extracted.education.length}`)
        }
      } catch (pythonError) {
        console.error('Python extraction failed:', pythonError)
        return NextResponse.json(
          { 
            error: `PDF extraction failed: ${pythonError instanceof Error ? pythonError.message : 'Unknown error'}. Please ensure Python 3.7+ is installed and run: pip3 install -r pdf_parser/requirements.txt` 
          },
          { status: 400 }
        )
      }
    } else {
      // DOCX files - use Node.js parser (mammoth)
      try {
        const parsed = await parseDOCX(buffer)
        rawText = parsed.text
        fields = extractFields(rawText)
      } catch (parseError) {
        console.error('DOCX parse error:', parseError)
        return NextResponse.json(
          { error: `Failed to parse DOCX file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}` },
          { status: 400 }
        )
      }
    }

    // Step 3: Check if bucket exists, create if not
    const { data: buckets } = await supabase.storage.listBuckets()
    const bucketExists = buckets?.some(bucket => bucket.name === STORAGE_BUCKET)
    
    if (!bucketExists) {
      // Try to create the bucket
      const { error: createBucketError } = await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true, // Make bucket public so files can be accessed
        fileSizeLimit: 10485760, // 10MB limit
        allowedMimeTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
      })
      
      if (createBucketError) {
        console.error('Failed to create bucket:', createBucketError)
        return NextResponse.json(
          { 
            error: `Storage bucket '${STORAGE_BUCKET}' does not exist and could not be created. Please create it in your Supabase Dashboard → Storage. Error: ${createBucketError.message}` 
          },
          { status: 500 }
        )
      }
    }

    // Step 4: Upload file to Supabase Storage
    // Sanitize filename to remove special characters that aren't allowed in storage keys
    const sanitizedFileName = fileName
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    
    const filePath = `${Date.now()}_${sanitizedFileName}`
    const { error: uploadError, data: uploadData } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      // Provide more specific error message
      if (uploadError.message?.includes('Bucket not found')) {
        return NextResponse.json(
          { 
            error: `Storage bucket '${STORAGE_BUCKET}' not found. Please create it in your Supabase Dashboard → Storage with public access.` 
          },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: `Failed to upload file to storage: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath)

    const resumeUrl = urlData.publicUrl

    // Step 5: Chunk the text using Python for PDFs, Node.js for DOCX
    let chunks
    if (extension === 'pdf') {
      // PDF files - use Python chunking
      console.log('Using Python for text chunking...')
      try {
        chunks = await chunkTextWithPython(rawText)
        console.log(`✓ Python chunking successful: ${chunks.length} chunks created`)
      } catch (pythonError) {
        console.error('Python chunking failed:', pythonError)
        return NextResponse.json(
          { error: `Text chunking failed: ${pythonError instanceof Error ? pythonError.message : 'Unknown error'}` },
          { status: 500 }
        )
      }
    } else {
      // DOCX files - use Node.js chunker
      chunks = chunkResumeText(rawText)
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'Failed to chunk resume text' },
        { status: 400 }
      )
    }

    // Step 6: Generate embeddings for chunks
    const embeddings = await generateChunkEmbeddings(chunks)

    if (embeddings.length !== chunks.length) {
      return NextResponse.json(
        { error: 'Embedding generation failed' },
        { status: 500 }
      )
    }

    // Step 7: Insert resume record
    const { data: resumeData, error: resumeError } = await supabase
      .from('resumes')
      .insert({
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        linkedin: fields.linkedin,
        location: fields.location,
        title: fields.title,
        skills: fields.skills.length > 0 ? fields.skills : null,
        experience_years: fields.experience_years,
                resume_url: resumeUrl,
                resume_text: rawText,
      })
      .select()
      .single()

    if (resumeError || !resumeData) {
      console.error('Resume insert error:', resumeError)
      // Clean up uploaded file if resume insert fails
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath])
      return NextResponse.json(
        { error: 'Failed to save resume data' },
        { status: 500 }
      )
    }

    const resumeId = resumeData.id

    // Step 8: Insert chunks with embeddings using RPC function
    // Insert chunks one by one using the database function for proper vector handling
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = embeddings[i]
      
      // Format embedding as string for pgvector: '[1,2,3,...]'
      const embeddingStr = `[${embedding.join(',')}]`
      
      const { error: chunkError } = await supabase.rpc('insert_resume_chunk', {
        p_resume_id: resumeId,
        p_chunk_text: chunk.chunk_text,
        p_section: chunk.section,
        p_company: chunk.company,
        p_start_date: chunk.start_date,
        p_end_date: chunk.end_date,
        p_embedding: embeddingStr, // Supabase will handle vector casting
      })

      if (chunkError) {
        console.error('Chunk insert error:', chunkError)
        // Continue inserting other chunks even if one fails
      }
    }

    return NextResponse.json({
      resume_id: resumeId,
      message: 'Resume ingested successfully',
      chunks_count: chunks.length,
    })
  } catch (error) {
    console.error('Ingest error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

