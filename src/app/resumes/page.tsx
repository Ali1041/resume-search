'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { SearchResult } from '@/lib/supabase/types'

export default function ResumesPage() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({
    location: '',
    min_years: '',
    title: '',
    skills: '',
  })
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [isRecentView, setIsRecentView] = useState(true)

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('Please enter a search query')
      return
    }

    setSearching(true)
    setError(null)
    setHasSearched(true)
    setIsRecentView(false)

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
          page_size: 50,
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

  // Fetch recent resumes on initial load
  useEffect(() => {
    const fetchRecentResumes = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/resumes/recent?limit=15')
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch recent resumes')
        }

        setResults(data.results || [])
        setIsRecentView(true)
      } catch (err) {
        console.error('Error fetching recent resumes:', err)
        // Don't show error for initial load, just show empty state
      } finally {
        setLoading(false)
      }
    }

    fetchRecentResumes()
  }, [])

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <Navigation />
      <main className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4 text-black dark:text-zinc-50">
            Browse Resumes
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Search and filter resumes using semantic search powered by AI embeddings.
          </p>
        </div>

        {/* Search Section */}
        <div className="mb-8 p-6 bg-white rounded-lg shadow-md dark:bg-zinc-900">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  Min Years
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
                  Skills
                </label>
                <input
                  id="filter-skills"
                  type="text"
                  value={filters.skills}
                  onChange={(e) => setFilters({ ...filters, skills: e.target.value })}
                  placeholder="e.g., React, Python"
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
          </div>
        </div>

        {/* Results */}
        {(hasSearched || isRecentView) && (
          <div>
            {loading ? (
              <div className="text-center py-12 bg-white rounded-lg shadow-md dark:bg-zinc-900">
                <p className="text-lg text-zinc-600 dark:text-zinc-400">Loading resumes...</p>
              </div>
            ) : results.length > 0 ? (
              <>
                <div className="mb-4 flex justify-between items-center">
                  <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">
                    {isRecentView ? 'Recent Resumes' : 'Search Results'} ({results.length})
                  </h2>
                  {isRecentView && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Most recently uploaded resumes
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {results.map((result) => (
                    <Link
                      key={result.resume_id}
                      href={`/resumes/${result.resume_id}`}
                      className="block"
                    >
                      <div className="p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 h-full flex flex-col">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h3 className="text-xl font-semibold text-black dark:text-zinc-50 mb-1">
                              {result.name || 'Unknown'}
                            </h3>
                            {result.title && (
                              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                                {result.title}
                              </p>
                            )}
                            {/* Show location and experience for recent resumes */}
                            {(result.location || result.experience_years) && (
                              <div className="flex gap-3 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                                {result.location && <span>📍 {result.location}</span>}
                                {result.experience_years && (
                                  <span>💼 {result.experience_years} years</span>
                                )}
                              </div>
                            )}
                          </div>
                          {!isRecentView && (
                            <div
                              className={`px-3 py-1 rounded-full text-xs font-medium text-white ${getConfidenceColor(
                                result.score
                              )}`}
                            >
                              {getConfidenceLabel(result.score)}
                            </div>
                          )}
                        </div>

                        {/* Show skills for recent resumes */}
                        {isRecentView && result.skills && result.skills.length > 0 && (
                          <div className="mb-3">
                            <div className="flex flex-wrap gap-1">
                              {result.skills.slice(0, 4).map((skill: string, idx: number) => (
                                <span
                                  key={idx}
                                  className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-600 dark:text-zinc-400"
                                >
                                  {skill}
                                </span>
                              ))}
                              {result.skills.length > 4 && (
                                <span className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                                  +{result.skills.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {!isRecentView && result.evidence && result.evidence.length > 0 && (
                          <div className="mt-auto pt-3 border-t border-zinc-200 dark:border-zinc-800">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                              Match Evidence:
                            </p>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2">
                              {result.evidence[0].chunk_text.substring(0, 150)}...
                            </p>
                          </div>
                        )}

                        <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            View Details →
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12 bg-white rounded-lg shadow-md dark:bg-zinc-900">
                <p className="text-lg text-zinc-600 dark:text-zinc-400">
                  No results found. Try different search terms or filters.
                </p>
              </div>
            )}
          </div>
        )}

        {!hasSearched && !isRecentView && !loading && (
          <div className="text-center py-12 bg-white rounded-lg shadow-md dark:bg-zinc-900">
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              Enter a search query above to find resumes.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

