import Link from 'next/link'
import Navigation from '@/components/Navigation'

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <Navigation />
      <main className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold mb-6 text-black dark:text-zinc-50">
            Resume RAG System
          </h1>
          <p className="text-xl text-zinc-600 dark:text-zinc-400 max-w-3xl mx-auto mb-8">
            Upload resumes and search them using semantic search powered by AI embeddings.
            Find the best candidates based on natural language queries.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <Link
              href="/upload"
              className="px-8 py-4 bg-black text-white rounded-lg font-medium hover:bg-zinc-800 transition-colors dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200 text-lg"
            >
              Upload Resume
            </Link>
            <Link
              href="/resumes"
              className="px-8 py-4 bg-white text-black border-2 border-black rounded-lg font-medium hover:bg-zinc-100 transition-colors dark:bg-zinc-900 dark:text-zinc-50 dark:border-zinc-50 dark:hover:bg-zinc-800 text-lg"
            >
              Browse Resumes
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          <div className="p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
            <div className="w-12 h-12 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-white dark:text-black"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-black dark:text-zinc-50">
              Upload & Parse
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              Upload PDF and DOCX resume files with automatic text extraction and field parsing.
            </p>
          </div>

          <div className="p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
            <div className="w-12 h-12 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-white dark:text-black"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-black dark:text-zinc-50">
              Semantic Search
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              Search resumes using natural language queries powered by AI embeddings and vector similarity.
            </p>
          </div>

          <div className="p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
            <div className="w-12 h-12 bg-black dark:bg-zinc-50 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-white dark:text-black"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-black dark:text-zinc-50">
              Smart Filters
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              Filter by location, years of experience, job title, and skills with confidence scores.
            </p>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-12 p-8 bg-white rounded-lg shadow-md dark:bg-zinc-900">
          <h2 className="text-2xl font-semibold mb-4 text-black dark:text-zinc-50">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-zinc-600 dark:text-zinc-400">
            <div>
              <h3 className="font-semibold mb-2 text-black dark:text-zinc-50">1. Upload</h3>
              <p>Upload candidate resumes in PDF or DOCX format. Our system automatically extracts text and structured information.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-black dark:text-zinc-50">2. Process</h3>
              <p>Resumes are chunked into sections, and each chunk is embedded using OpenAI's text-embedding-3-large model.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-black dark:text-zinc-50">3. Search</h3>
              <p>Use natural language queries to find relevant candidates. Our vector database returns results ranked by semantic similarity.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-black dark:text-zinc-50">4. Review</h3>
              <p>View detailed candidate profiles with extracted information, evidence chunks, and original resume files.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
