import UploadResume from '@/components/UploadResume'
import SearchResumes from '@/components/SearchResumes'

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold mb-4 text-black dark:text-zinc-50">
            Resume RAG System
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Upload resumes and search them using semantic search powered by AI embeddings.
            Find the best candidates based on natural language queries.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <div className="lg:order-1">
            <UploadResume />
          </div>
          <div className="lg:order-2">
            <SearchResumes />
          </div>
        </div>

        <div className="mt-12 p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
          <h2 className="text-xl font-semibold mb-4 text-black dark:text-zinc-50">
            Features
          </h2>
          <ul className="space-y-2 text-zinc-600 dark:text-zinc-400">
            <li>• Upload PDF and DOCX resume files</li>
            <li>• Automatic extraction of candidate information (name, email, skills, experience)</li>
            <li>• Semantic search using AI-powered embeddings</li>
            <li>• Filter by location, years of experience, job title, and skills</li>
            <li>• Confidence scores and evidence chunks for each result</li>
            <li>• Vector similarity search powered by Supabase pgvector</li>
          </ul>
        </div>
      </main>
    </div>
  )
}
