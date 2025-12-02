'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Navigation() {
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  return (
    <nav className="bg-white border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800">
      <div className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-black dark:text-zinc-50">
            Resume RAG
          </Link>
          
          <div className="flex gap-6 items-center">
            <Link
              href="/"
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive('/')
                  ? 'bg-black text-white dark:bg-zinc-50 dark:text-black'
                  : 'text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              Home
            </Link>
            <Link
              href="/resumes"
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive('/resumes')
                  ? 'bg-black text-white dark:bg-zinc-50 dark:text-black'
                  : 'text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              Resumes
            </Link>
            <Link
              href="/upload"
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive('/upload')
                  ? 'bg-black text-white dark:bg-zinc-50 dark:text-black'
                  : 'text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              Upload
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}

