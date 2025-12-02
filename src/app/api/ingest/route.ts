import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/client'
import { parseResumeFile } from '@/lib/services/parser'
import { extractFields } from '@/lib/services/field-extractor'
import { chunkResumeText } from '@/lib/services/chunker'
import { generateChunkEmbeddings } from '@/lib/services/embedding'

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

    // Step 1: Parse the resume file
    let parsed
    try {
      parsed = await parseResumeFile(buffer, fileName)
    } catch (parseError) {
      console.error('Parse error:', parseError)
      return NextResponse.json(
        { error: `Failed to parse file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}` },
        { status: 400 }
      )
    }
    
    if (!parsed.text || parsed.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Failed to extract text from file. The file may be image-based or corrupted. Please ensure the PDF contains selectable text.' },
        { status: 400 }
      )
    }

    // Log extracted text length for debugging
    console.log(`Extracted text length: ${parsed.text.length} characters`)
    console.log(`Text preview: ${parsed.text.substring(0, 200)}`)

    // Step 2: Extract structured fields
    const fields = extractFields(parsed.text)

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

    // Step 5: Chunk the text
    const chunks = chunkResumeText(parsed.text)

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
        resume_text: parsed.text,
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

