'use client'

import { useState } from 'react'
import { SearchResult } from '@/lib/supabase/types'

export default function SearchResumes() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({
    location: '',
    min_years: '',
    title: '',
    skills: '',
  })
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('Please enter a search query')
      return
    }

    setSearching(true)
    setError(null)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query_text: query,
          filters: {
            location: filters.location || undefined,
            min_years: filters.min_years ? parseInt(filters.min_years, 10) : undefined,
            title: filters.title || undefined,
            skills: filters.skills ? filters.skills.split(',').map(s => s.trim()) : undefined,
          },
          page: 1,
          page_size: 20,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Search failed')
      }

      setResults(data.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const getConfidenceLabel = (score: number): string => {
    if (score >= 0.7) return 'High'
    if (score >= 0.4) return 'Medium'
    return 'Low'
  }

  const getConfidenceColor = (score: number): string => {
    if (score >= 0.7) return 'bg-green-500'
    if (score >= 0.4) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
      <h2 className="text-2xl font-semibold mb-4 text-black dark:text-zinc-50">
        Search Resumes
      </h2>

      <div className="space-y-4">
        {/* Search Query */}
        <div>
          <label
            htmlFor="search-query"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
          >
            Search Query
          </label>
          <div className="flex gap-2">
            <input
              id="search-query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g., Python developer with machine learning experience"
              className="flex-1 px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-50"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-6 py-2 bg-black text-white rounded-lg font-medium hover:bg-zinc-800 disabled:bg-zinc-400 disabled:cursor-not-allowed transition-colors dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="filter-location"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              Location
            </label>
            <input
              id="filter-location"
              type="text"
              value={filters.location}
              onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              placeholder="e.g., San Francisco"
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>

          <div>
            <label
              htmlFor="filter-years"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              Min Years Experience
            </label>
            <input
              id="filter-years"
              type="number"
              value={filters.min_years}
              onChange={(e) => setFilters({ ...filters, min_years: e.target.value })}
              placeholder="e.g., 5"
              min="0"
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>

          <div>
            <label
              htmlFor="filter-title"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              Job Title
            </label>
            <input
              id="filter-title"
              type="text"
              value={filters.title}
              onChange={(e) => setFilters({ ...filters, title: e.target.value })}
              placeholder="e.g., Software Engineer"
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>

          <div>
            <label
              htmlFor="filter-skills"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              Skills (comma-separated)
            </label>
            <input
              id="filter-skills"
              type="text"
              value={filters.skills}
              onChange={(e) => setFilters({ ...filters, skills: e.target.value })}
              placeholder="e.g., React, Python, AWS"
              className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-4 text-black dark:text-zinc-50">
              Results ({results.length})
            </h3>
            <div className="space-y-4">
              {results.map((result) => (
                <div
                  key={result.resume_id}
                  className="p-4 border border-zinc-200 rounded-lg hover:shadow-md transition-shadow dark:bg-zinc-800 dark:border-zinc-700"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="text-lg font-semibold text-black dark:text-zinc-50">
                        {result.name || 'Unknown'}
                      </h4>
                      {result.title && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          {result.title}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div
                        className={`inline-block px-3 py-1 rounded-full text-xs font-medium text-white ${getConfidenceColor(
                          result.score
                        )}`}
                      >
                        {getConfidenceLabel(result.score)} ({Math.round(result.score * 100)}%)
                      </div>
                    </div>
                  </div>

                  {/* Evidence */}
                  {result.evidence && result.evidence.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Evidence:
                      </p>
                      <div className="space-y-2">
                        {result.evidence.slice(0, 3).map((evidence, idx) => (
                          <div
                            key={evidence.chunk_id || idx}
                            className="p-3 bg-zinc-50 rounded text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          >
                            <p className="mb-1">{evidence.chunk_text}</p>
                            {evidence.company && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {evidence.company}
                                {evidence.section && ` • ${evidence.section}`}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {results.length === 0 && !error && !searching && query && (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
            No results found. Try different search terms or filters.
          </div>
        )}
      </div>
    </div>
  )
}

