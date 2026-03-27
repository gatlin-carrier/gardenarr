import { useState, useEffect, useRef } from 'react'
import './GardenChat.css'

const TOOL_LABELS = {
  list_plantings: 'Checking plantings',
  add_planting: 'Adding crop',
  remove_planting: 'Removing crop',
  list_beds: 'Checking beds',
  create_bed: 'Creating bed',
  assign_crop_to_bed: 'Planting in bed',
  remove_crop_from_bed: 'Clearing bed cells',
  move_bed: 'Moving bed',
  get_plant_info: 'Looking up plant info',
  get_companion_info: 'Checking companions',
  recommend_plants: 'Finding recommendations',
}

export default function GardenChat({ gardenId, onDataModified }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Load chat history when opened
  useEffect(() => {
    if (!open || !gardenId) return
    fetch(`/api/gardens/${gardenId}/chat`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setMessages(data)
      })
      .catch(() => {})
  }, [open, gardenId])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  async function sendMessage(e) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch(`/api/gardens/${gardenId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setLoading(false)
        return
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        tool_calls: data.toolCalls?.length ? data.toolCalls : null,
      }])
      // Notify parent to refresh modified data
      if (data.modified?.length && onDataModified) {
        onDataModified(data.modified)
      }
    } catch (err) {
      setError('Failed to send message. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  async function clearHistory() {
    if (!confirm('Clear chat history for this garden?')) return
    await fetch(`/api/gardens/${gardenId}/chat`, { method: 'DELETE' }).catch(() => {})
    setMessages([])
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} title="Garden AI Assistant">
        <span className="chat-fab-icon">AI</span>
      </button>
    )
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">Garden Assistant</span>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button className="btn-ghost btn-sm" onClick={clearHistory} title="Clear history">Clear</button>
          )}
          <button className="chat-close" onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            <p><strong>Hi! I'm your garden assistant.</strong></p>
            <p>Ask me anything about your garden. I can:</p>
            <ul>
              <li>Add or remove crops from your list</li>
              <li>Place plants in your beds</li>
              <li>Recommend plants to grow</li>
              <li>Look up growing info &amp; companions</li>
              <li>Help plan your layout</li>
            </ul>
            <div className="chat-starters">
              {['What should I plant next to my tomatoes?',
                'Recommend some easy herbs for a beginner',
                'What pollinators should I add to my garden?',
              ].map(q => (
                <button key={q} className="chat-starter" onClick={() => { setInput(q); inputRef.current?.focus() }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            {msg.role === 'assistant' && msg.tool_calls?.length > 0 && (
              <div className="chat-tool-calls">
                {msg.tool_calls.map((tc, j) => (
                  <span key={j} className="chat-tool-badge">
                    {tc.error ? '!' : '✓'} {TOOL_LABELS[tc.name] || tc.name}
                  </span>
                ))}
              </div>
            )}
            <div className="chat-msg-content">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && <div className="chat-error">{error}</div>}
      </div>

      <form className="chat-input-row" onSubmit={sendMessage}>
        <input
          ref={inputRef}
          className="chat-input"
          placeholder="Ask about your garden..."
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />
        <button className="chat-send" type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
