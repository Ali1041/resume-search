import UploadResume from '@/components/UploadResume'
import Navigation from '@/components/Navigation'

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <Navigation />
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4 text-black dark:text-zinc-50">
            Upload Resume
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Upload a PDF or DOCX resume file to add it to the system. The resume will be automatically parsed and indexed for search.
          </p>
        </div>

        <UploadResume />
      </main>
    </div>
  )
}

