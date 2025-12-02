'use client'

import { useState } from 'react'

export default function UploadResume() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      const extension = selectedFile.name.toLowerCase().split('.').pop()
      if (!['pdf', 'docx', 'doc'].includes(extension || '')) {
        setMessage({ type: 'error', text: 'Please select a PDF or DOCX file' })
        setFile(null)
        return
      }
      setFile(selectedFile)
      setMessage(null)
    }
  }

  const handleUpload = async () => {
    if (!file) {
      setMessage({ type: 'error', text: 'Please select a file first' })
      return
    }

    setUploading(true)
    setMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setMessage({
        type: 'success',
        text: `Resume uploaded successfully! ID: ${data.resume_id} (${data.chunks_count} chunks)`,
      })
      setFile(null)
      // Reset file input
      const fileInput = document.getElementById('resume-file') as HTMLInputElement
      if (fileInput) {
        fileInput.value = ''
      }
      
      // Optionally redirect to resumes page after successful upload
      // Uncomment the following lines if you want auto-redirect:
      // setTimeout(() => {
      //   window.location.href = `/resumes/${data.resume_id}`
      // }, 2000)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Upload failed',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
      <h2 className="text-2xl font-semibold mb-4 text-black dark:text-zinc-50">
        Upload Resume
      </h2>
      
      <div className="space-y-4">
        <div>
          <label
            htmlFor="resume-file"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
          >
            Select PDF or DOCX file
          </label>
          <input
            id="resume-file"
            type="file"
            accept=".pdf,.docx,.doc"
            onChange={handleFileChange}
            disabled={uploading}
            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-300"
          />
        </div>

        {file && (
          <div className="p-3 bg-zinc-50 rounded dark:bg-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Selected: <span className="font-medium">{file.name}</span> (
              {(file.size / 1024).toFixed(2)} KB)
            </p>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-zinc-800 disabled:bg-zinc-400 disabled:cursor-not-allowed transition-colors dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
        >
          {uploading ? 'Uploading...' : 'Upload Resume'}
        </button>

        {message && (
          <div
            className={`p-3 rounded ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}

