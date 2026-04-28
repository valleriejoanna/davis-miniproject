import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COLORS = ['#E50914', '#221F1F', '#B81D24', '#F5F5F1', '#8c8c8c']

const normalizeText = (value) => (value ?? '').toString().trim()

const splitValues = (value) =>
  normalizeText(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const countByField = (rows, field, { split = false, limit = 10 } = {}) => {
  const counts = new Map()

  rows.forEach((row) => {
    const values = split ? splitValues(row[field]) : [normalizeText(row[field])]

    values
      .filter((value) => value && value !== 'Unknown')
      .forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1)
      })
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }))
}

const buildYearTrend = (rows) => {
  const counts = new Map()

  rows.forEach((row) => {
    const year = Number(row.release_year)
    if (!Number.isNaN(year) && year > 0) {
      counts.set(year, (counts.get(year) || 0) + 1)
    }
  })

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, total]) => ({ year, total }))
}

const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value)

const getYearRangeLabel = (startYear, endYear) => {
  if (startYear === 'All' && endYear === 'All') return 'all years'
  if (startYear !== 'All' && endYear === 'All') return `from ${startYear} onward`
  if (startYear === 'All' && endYear !== 'All') return `up to ${endYear}`
  return `${startYear} to ${endYear}`
}

const containsAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword))

const normalizeQuestionText = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const detectTypeFromQuestion = (question) => {
  if (containsAny(question, ['tv show', 'tv shows', 'series', 'serial'])) return 'TV Show'
  if (containsAny(question, ['movie', 'movies', 'film', 'films'])) return 'Movie'
  return null
}

const extractYearFromQuestion = (question) => {
  const match = question.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

const detectExactValueFromQuestion = (question, values = []) => {
  const normalizedQuestion = ` ${question} `
  const matched = values
    .filter(Boolean)
    .map((value) => ({ value, normalized: ` ${normalizeQuestionText(value)} ` }))
    .filter((item) => item.normalized.trim().length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length)
    .find((item) => normalizedQuestion.includes(item.normalized))

  return matched ? matched.value : null
}

const getExampleTitles = (rows, limit = 3) =>
  rows
    .slice(0, limit)
    .map((row) => row.title)
    .filter(Boolean)

const buildFactQueryReply = (question, context) => {
  const normalizedQuestion = normalizeQuestionText(question)
  const year = extractYearFromQuestion(normalizedQuestion)
  const requestedType = detectTypeFromQuestion(normalizedQuestion)
  const requestedCountry = detectExactValueFromQuestion(normalizedQuestion, context.availableCountries)
  const requestedRating = detectExactValueFromQuestion(normalizedQuestion, context.availableRatings)
  const requestedGenre = detectExactValueFromQuestion(normalizedQuestion, context.availableGenres)

  const wantsCount = containsAny(normalizedQuestion, ['how many', 'berapa jumlah', 'berapa banyak', 'count'])
  const wantsExistence = containsAny(normalizedQuestion, ['are there', 'is there', 'do we have', 'ada kah', 'adakah', 'any'])

  const isFactQuery =
    year !== null ||
    requestedType !== null ||
    requestedCountry !== null ||
    requestedRating !== null ||
    requestedGenre !== null

  if (!isFactQuery || (!wantsCount && !wantsExistence)) {
    return null
  }

  const matchedRows = context.filteredRows.filter((row) => {
    const matchYear = year === null || row.release_year === year
    const matchType = requestedType === null || row.type === requestedType
    const matchCountry = requestedCountry === null || splitValues(row.country).includes(requestedCountry)
    const matchRating = requestedRating === null || row.rating === requestedRating
    const matchGenre = requestedGenre === null || splitValues(row.listed_in).includes(requestedGenre)

    return matchYear && matchType && matchCountry && matchRating && matchGenre
  })

  const parts = []
  if (requestedType) parts.push(requestedType === 'TV Show' ? 'TV shows' : 'movies')
  else parts.push('titles')
  if (year !== null) parts.push(`from ${year}`)
  if (requestedCountry) parts.push(`from ${requestedCountry}`)
  if (requestedRating) parts.push(`with rating ${requestedRating}`)
  if (requestedGenre) parts.push(`in category ${requestedGenre}`)

  const subject = parts.join(' ')
  const examples = getExampleTitles(matchedRows)
  const examplesText = examples.length > 0 ? ` Example titles: ${examples.join(', ')}.` : ''

  if (wantsExistence) {
    if (matchedRows.length > 0) {
      return `Yes. There are ${formatNumber(matchedRows.length)} ${subject} in the current filtered dashboard view.${examplesText}`
    }

    return `No. There are no ${subject} in the current filtered dashboard view.`
  }

  return `There are ${formatNumber(matchedRows.length)} ${subject} in the current filtered dashboard view.${examplesText}`
}

const detectIntent = (question) => {
  const q = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')

  const checks = [
    {
      intent: 'highestLowest',
      keywords: ['highest and lowest', 'tertinggi dan terendah', 'high and low'],
    },
    {
      intent: 'trend',
      keywords: ['line chart', 'trend', 'tren', 'grafik', 'chart', 'naik', 'turun', 'release year'],
    },
    {
      intent: 'insight',
      keywords: ['main insight', 'insight', 'utama', 'highlight', 'kesimpulan', 'tell me about the data'],
    },
    {
      intent: 'highest',
      keywords: ['highest', 'tertinggi', 'peak', 'puncak', 'maximum', 'max', 'paling banyak'],
    },
    {
      intent: 'lowest',
      keywords: ['lowest', 'terendah', 'minimum', 'min', 'paling sedikit'],
    },
    {
      intent: 'pie',
      keywords: ['pie', 'distribution', 'distribusi', 'composition', 'komposisi', 'movie vs tv', 'movie and tv'],
    },
    {
      intent: 'bar',
      keywords: ['bar', 'country', 'countries', 'negara'],
    },
    {
      intent: 'genre',
      keywords: ['genre', 'category', 'kategori', 'listed in'],
    },
    {
      intent: 'kpi',
      keywords: ['kpi', 'summary', 'ringkasan', 'scorecard', 'overview', 'berapa jumlah', 'how many titles'],
    },
    {
      intent: 'table',
      keywords: ['table', 'tabel', 'example titles', 'contoh judul', 'sample titles', 'daftar judul'],
    },
    {
      intent: 'recommendation',
      keywords: ['recommendation', 'recommend', 'rekomendasi', 'saran', 'apa yang sebaiknya'],
    },
    {
      intent: 'filters',
      keywords: ['current filter', 'active filter', 'filter aktif', 'what filters', 'filter sekarang'],
    },
  ]

  for (const item of checks) {
    if (containsAny(q, item.keywords)) {
      return item.intent
    }
  }

  if ((q.includes('highest') || q.includes('tertinggi')) && (q.includes('lowest') || q.includes('terendah'))) {
    return 'highestLowest'
  }

  if ((q.includes('how many') || q.includes('berapa')) && (q.includes('movie') || q.includes('tv'))) {
    return 'pie'
  }

  if ((q.includes('how many') || q.includes('berapa')) && (q.includes('country') || q.includes('countries') || q.includes('negara'))) {
    return 'bar'
  }

  if ((q.includes('what') || q.includes('which') || q.includes('apa') || q.includes('mana')) && (q.includes('genre') || q.includes('category') || q.includes('kategori'))) {
    return 'genre'
  }

  if (q.includes('average') || q.includes('rata') || q.includes('mean')) {
    return 'kpi'
  }

  return 'general'
}

const buildAssistantReply = (question, context) => {
  const q = normalizeText(question).toLowerCase()

  if (!q) {
    return 'Please type a question first. You can ask about the trend, the main insight, the highest and lowest year, or the current KPI summary.'
  }

  if (context.totalTitles === 0) {
    return `No data matches the current filters (${context.filtersLabel}). Please change the filters first, then ask again.`
  }

  const factReply = buildFactQueryReply(q, context)
  if (factReply) {
    return factReply
  }

  const intent = detectIntent(q)

  if (q.includes('how many movies') || q.includes('berapa movie')) {
    return `There are ${formatNumber(context.movieCount)} movies in the current filter.`
  }

  if (q.includes('how many tv shows') || q.includes('berapa tv show')) {
    return `There are ${formatNumber(context.tvCount)} TV shows in the current filter.`
  }

  if (q.includes('top country') || q.includes('most titles by country') || q.includes('negara terbanyak')) {
    return `The country with the most titles in the current filter is ${context.topCountryText}.`
  }

  switch (intent) {
    case 'trend':
      if (context.peakYear && context.lowYear) {
        return `Based on the current line chart (${context.filtersLabel}), the trend reaches its highest point in ${context.peakYear.year} with ${formatNumber(context.peakYear.total)} titles, and its lowest point in ${context.lowYear.year} with ${formatNumber(context.lowYear.total)} titles. Overall, the line chart explains how the number of titles changes by release year in the active dashboard view.`
      }

      return `The line chart explains how the number of titles changes by release year for the current filter (${context.filtersLabel}).`

    case 'insight':
      return `The main insight from the current dashboard is that ${context.topCountryText}, ${context.dominantTypeText}, and the most common category is ${context.topGenreText}.`

    case 'highestLowest':
      if (context.peakYear && context.lowYear) {
        return `In the current view, the highest value occurs in ${context.peakYear.year} with ${formatNumber(context.peakYear.total)} titles, while the lowest value occurs in ${context.lowYear.year} with ${formatNumber(context.lowYear.total)} titles.`
      }

      return 'There is not enough year data to determine both the highest and lowest values in the current view.'

    case 'highest':
      if (context.peakYear) {
        return `The highest value in the current view occurs in ${context.peakYear.year}, with ${formatNumber(context.peakYear.total)} titles.`
      }

      return 'There is not enough year data to determine the highest value in the current view.'

    case 'lowest':
      if (context.lowYear) {
        return `The lowest value in the current view occurs in ${context.lowYear.year}, with ${formatNumber(context.lowYear.total)} titles.`
      }

      return 'There is not enough year data to determine the lowest value in the current view.'

    case 'pie':
      return `The pie chart shows the content type distribution. In the current filter, there are ${formatNumber(context.movieCount)} movies and ${formatNumber(context.tvCount)} TV shows, so ${context.dominantTypeLabel} is more dominant.`

    case 'bar':
      return `The bar chart compares countries. In the current filter, ${context.topCountryText}.`

    case 'genre':
      return `The strongest category in the current filter is ${context.topGenreText}. This means that category appears more often than the others in the active dashboard view.`

    case 'kpi':
      return `The KPI summary for the current filter (${context.filtersLabel}) is: ${formatNumber(context.totalTitles)} total titles, average release year ${context.avgYear || '-'}, ${formatNumber(context.movieCount)} movies, ${formatNumber(context.tvCount)} TV shows, and ${formatNumber(context.uniqueCountries)} countries represented.`

    case 'table':
      return `The table lists the latest titles in the current filter. Some examples are ${context.sampleTitlesText}.`

    case 'recommendation':
      return `Recommendation: focus analysis on ${context.topCountryText} and compare ${context.dominantTypeLabel.toLowerCase()} content with other categories, because that segment appears most often in the active dashboard view.`

    case 'filters':
      return `The current dashboard filters are: ${context.filtersLabel}.`

    default:
      return `I can answer based on the current dashboard data. Right now there are ${formatNumber(context.totalTitles)} titles, ${context.topCountryText}, and ${context.dominantTypeText}. You can ask in your own words about the trend, top country, dominant category, KPI summary, highest and lowest year, or recommendations.`
  }
}

const createInitialAssistantMessage = () => ({
  role: 'assistant',
  text: 'Hi, I am the dashboard assistant. Ask me about the current data, for example: “What is the main insight?”, “Explain the line chart trend”, or “Are there movies from the year 2022?”',
})

function App() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('All')
  const [ratingFilter, setRatingFilter] = useState('All')
  const [genreFilter, setGenreFilter] = useState('All')
  const [startYear, setStartYear] = useState('All')
  const [endYear, setEndYear] = useState('All')
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState([createInitialAssistantMessage()])

  useEffect(() => {
    const loadCsv = async () => {
      try {
        const response = await fetch('/data/netflix_titles.csv')
        const csvText = await response.text()

        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            const cleaned = result.data.map((row) => ({
              ...row,
              title: normalizeText(row.title),
              type: normalizeText(row.type) || 'Unknown',
              country: normalizeText(row.country) || 'Unknown',
              rating: normalizeText(row.rating) || 'Unknown',
              listed_in: normalizeText(row.listed_in) || 'Unknown',
              duration: normalizeText(row.duration) || 'Unknown',
              release_year: Number(row.release_year) || 0,
            }))
            setRows(cleaned)
            setLoading(false)
          },
          error: (parseError) => {
            setError(parseError.message)
            setLoading(false)
          },
        })
      } catch (fetchError) {
        setError(fetchError.message)
        setLoading(false)
      }
    }

    loadCsv()
  }, [])

  const filterOptions = useMemo(() => {
    const years = [...new Set(rows.map((row) => row.release_year).filter((year) => year > 0))].sort(
      (a, b) => a - b
    )

    return {
      countries: ['All', ...new Set(rows.flatMap((row) => splitValues(row.country)).filter(Boolean))].slice(0, 30),
      ratings: ['All', ...new Set(rows.map((row) => row.rating).filter(Boolean))],
      genres: ['All', ...new Set(rows.flatMap((row) => splitValues(row.listed_in)).filter(Boolean))].slice(0, 30),
      years: ['All', ...years],
    }
  }, [rows])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesTab = activeTab === 'All' || row.type === activeTab
      const matchesSearch = !search || row.title.toLowerCase().includes(search.toLowerCase())
      const matchesCountry =
        countryFilter === 'All' || splitValues(row.country).includes(countryFilter)
      const matchesRating = ratingFilter === 'All' || row.rating === ratingFilter
      const matchesGenre = genreFilter === 'All' || splitValues(row.listed_in).includes(genreFilter)
      const matchesStartYear = startYear === 'All' || row.release_year >= Number(startYear)
      const matchesEndYear = endYear === 'All' || row.release_year <= Number(endYear)

      return (
        matchesTab &&
        matchesSearch &&
        matchesCountry &&
        matchesRating &&
        matchesGenre &&
        matchesStartYear &&
        matchesEndYear
      )
    })
  }, [rows, activeTab, search, countryFilter, ratingFilter, genreFilter, startYear, endYear])

  const kpis = useMemo(() => {
    const totalTitles = filteredRows.length
    const avgYear =
      totalTitles > 0
        ? Math.round(filteredRows.reduce((sum, row) => sum + row.release_year, 0) / totalTitles)
        : 0
    const movieCount = filteredRows.filter((row) => row.type === 'Movie').length
    const tvCount = filteredRows.filter((row) => row.type === 'TV Show').length
    const uniqueCountries = new Set(filteredRows.flatMap((row) => splitValues(row.country))).size

    return {
      totalTitles,
      avgYear,
      movieCount,
      tvCount,
      uniqueCountries,
    }
  }, [filteredRows])

  const lineData = useMemo(() => buildYearTrend(filteredRows), [filteredRows])
  const countryData = useMemo(
    () => countByField(filteredRows, 'country', { split: true, limit: 10 }),
    [filteredRows]
  )
  const pieData = useMemo(() => countByField(filteredRows, 'type', { limit: 5 }), [filteredRows])
  const genreData = useMemo(
    () => countByField(filteredRows, 'listed_in', { split: true, limit: 10 }),
    [filteredRows]
  )

  const tableData = useMemo(() => {
    return [...filteredRows]
      .sort((a, b) => b.release_year - a.release_year)
      .slice(0, 12)
  }, [filteredRows])

  const insight = useMemo(() => {
    const topCountry = countryData[0]
    const peakYear = [...lineData].sort((a, b) => b.total - a.total)[0]
    const movieShare = kpis.totalTitles
      ? ((kpis.movieCount / kpis.totalTitles) * 100).toFixed(1)
      : 0

    return {
      main: topCountry
        ? `${topCountry.name} contributes the largest number of titles in the current view.`
        : 'No dominant country found in the current filter.',
      trend: peakYear
        ? `The content release trend peaks in ${peakYear.year} with ${formatNumber(peakYear.total)} titles.`
        : 'No trend can be calculated for the current filter.',
      recommendation:
        Number(movieShare) >= 60
          ? `Movies dominate this dataset (${movieShare}%). Compare movie-heavy categories with TV Show growth to identify catalog opportunities.`
          : `TV Shows are relatively strong in this filter. Compare series-focused categories with broader movie content for a balanced analysis.`,
    }
  }, [countryData, lineData, kpis])

  const assistantContext = useMemo(() => {
    const sortedLine = [...lineData].sort((a, b) => b.total - a.total)
    const peakYear = sortedLine[0]
    const lowYear = [...lineData].sort((a, b) => a.total - b.total)[0]
    const topCountry = countryData[0]
    const topGenre = genreData[0]
    const filtersLabel = `type ${activeTab}, year ${getYearRangeLabel(startYear, endYear)}, country ${countryFilter}, rating ${ratingFilter}, category ${genreFilter}`
    const sampleTitles = tableData.slice(0, 3).map((row) => row.title)
    const dominantTypeLabel = kpis.movieCount >= kpis.tvCount ? 'Movie' : 'TV Show'

    return {
      totalTitles: kpis.totalTitles,
      avgYear: kpis.avgYear,
      movieCount: kpis.movieCount,
      tvCount: kpis.tvCount,
      uniqueCountries: kpis.uniqueCountries,
      peakYear,
      lowYear,
      filteredRows,
      availableCountries: [...new Set(filteredRows.flatMap((row) => splitValues(row.country)).filter(Boolean))],
      availableRatings: [...new Set(filteredRows.map((row) => row.rating).filter(Boolean))],
      availableGenres: [...new Set(filteredRows.flatMap((row) => splitValues(row.listed_in)).filter(Boolean))],
      topCountryText: topCountry
        ? `${topCountry.name} is the top country with ${formatNumber(topCountry.value)} titles`
        : 'no single country dominates the current filtered result',
      dominantTypeText:
        kpis.totalTitles > 0
          ? `${dominantTypeLabel.toLowerCase()} content is more dominant in the current view`
          : 'there is no dominant content type because no data is shown',
      dominantTypeLabel,
      topGenreText: topGenre
        ? `${topGenre.name} (${formatNumber(topGenre.value)} titles)`
        : 'no category could be identified',
      sampleTitlesText:
        sampleTitles.length > 0
          ? sampleTitles.join(', ')
          : 'there are no titles in the current table view',
      filtersLabel,
    }
  }, [
    lineData,
    countryData,
    genreData,
    filteredRows,
    activeTab,
    startYear,
    endYear,
    countryFilter,
    ratingFilter,
    genreFilter,
    tableData,
    kpis,
  ])

  const handleAskAssistant = (inputText) => {
    const question = normalizeText(inputText)
    if (!question) return

    const reply = buildAssistantReply(question, assistantContext)

    setMessages((current) => [
      ...current,
      { role: 'user', text: question },
      { role: 'assistant', text: reply },
    ])
    setChatInput('')
  }

  const resetAllFilters = () => {
    setActiveTab('All')
    setSearch('')
    setCountryFilter('All')
    setRatingFilter('All')
    setGenreFilter('All')
    setStartYear('All')
    setEndYear('All')
  }

  if (loading) {
    return <div className="status-screen">Loading Netflix dashboard...</div>
  }

  if (error) {
    return <div className="status-screen">Failed to load data: {error}</div>
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Final Project Data Analytics Dashboard</p>
          <h1>Netflix Movies & TV Shows Dashboard</h1>
          <p className="subtitle">
            Dashboard with KPI, charts, table, date/category filters, and an AI-style chat assistant based on the displayed data.
          </p>
        </div>
        <div className="hero-badge">{formatNumber(rows.length)} Records</div>
      </header>

      <section className="controls card">
        <div className="controls-header">
          <div className="tabs">
            {['All', 'Movie', 'TV Show'].map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <button className="ghost-button" onClick={resetAllFilters}>
            Reset Filters
          </button>
        </div>

        <div className="filters-grid">
          <input
            type="text"
            placeholder="Search title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
            {filterOptions.years.map((year) => (
              <option key={`start-${year}`} value={year}>
                {year === 'All' ? 'Start Year (All)' : `Start Year: ${year}`}
              </option>
            ))}
          </select>

          <select value={endYear} onChange={(e) => setEndYear(e.target.value)}>
            {filterOptions.years.map((year) => (
              <option key={`end-${year}`} value={year}>
                {year === 'All' ? 'End Year (All)' : `End Year: ${year}`}
              </option>
            ))}
          </select>

          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
            {filterOptions.countries.map((country) => (
              <option key={country} value={country}>
                {country === 'All' ? 'Country (All)' : country}
              </option>
            ))}
          </select>

          <select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
            {filterOptions.ratings.map((rating) => (
              <option key={rating} value={rating}>
                {rating === 'All' ? 'Rating (All)' : rating}
              </option>
            ))}
          </select>

          <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
            {filterOptions.genres.map((genre) => (
              <option key={genre} value={genre}>
                {genre === 'All' ? 'Category (All)' : genre}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="kpi-grid">
        <div className="card kpi-card">
          <p>Total Titles</p>
          <h2>{formatNumber(kpis.totalTitles)}</h2>
        </div>
        <div className="card kpi-card">
          <p>Average Release Year</p>
          <h2>{kpis.avgYear || '-'}</h2>
        </div>
        <div className="card kpi-card">
          <p>Total Movies</p>
          <h2>{formatNumber(kpis.movieCount)}</h2>
        </div>
        <div className="card kpi-card">
          <p>Countries Represented</p>
          <h2>{formatNumber(kpis.uniqueCountries)}</h2>
        </div>
      </section>

      <section className="chart-grid">
        <div className="card chart-card large">
          <div className="card-header">
            <h3>Line Chart — Release Trend by Year</h3>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="total" stroke="#E50914" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="card-header">
            <h3>Bar Chart — Top 10 Countries</h3>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={countryData} layout="vertical" margin={{ left: 16, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={110} />
              <Tooltip />
              <Bar dataKey="value" fill="#B81D24" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <div className="card-header">
            <h3>Pie Chart — Content Type Distribution</h3>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label>
                {pieData.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="card">
          <div className="card-header">
            <h3>Table — Latest Titles in Current Filter</h3>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Country</th>
                  <th>Rating</th>
                  <th>Year</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row) => (
                  <tr key={row.show_id}>
                    <td>{row.title}</td>
                    <td>{row.type}</td>
                    <td>{row.country}</td>
                    <td>{row.rating}</td>
                    <td>{row.release_year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card insight-card">
          <div className="card-header">
            <h3>Insights & Recommendation</h3>
          </div>
          <div className="insight-block">
            <h4>Main Insight</h4>
            <p>{insight.main}</p>
          </div>
          <div className="insight-block">
            <h4>Trend Found</h4>
            <p>{insight.trend}</p>
          </div>
          <div className="insight-block">
            <h4>Recommendation</h4>
            <p>{insight.recommendation}</p>
          </div>
        </div>
      </section>

      <section className="card assistant-section">
        <div className="card-header assistant-header">
          <div>
            <h3>AI Chat Assistant</h3>
            <p className="assistant-subtitle">
              Ask questions in natural language. The answer is generated from the current dashboard data and active filters.
            </p>
          </div>
        </div>

        <div className="prompt-row">
          {[
            'Explain the line chart trend',
            'What is the main insight?',
            'When do the highest and lowest values occur?',
            'Give me a KPI summary',
            'Are there movies from the year 2022?',
          ].map((prompt) => (
            <button key={prompt} className="prompt-chip" onClick={() => handleAskAssistant(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        <div className="chat-box">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
              <span className="chat-role">{message.role === 'assistant' ? 'AI' : 'You'}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>

        <div className="chat-input-row">
          <input
            type="text"
            placeholder="Ask something about the current dashboard data..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAskAssistant(chatInput)
              }
            }}
          />
          <button className="send-button" onClick={() => handleAskAssistant(chatInput)}>
            Send
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
