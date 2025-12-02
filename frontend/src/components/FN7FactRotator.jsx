import { useState, useEffect } from 'react'

const SCOUT_FACTS = [
  "Scout analyzes thousands of social signals to find your ideal leads in real-time.",
  "Each leadset is tailored to specific buyer personas and intent signals.",
  "Scout identifies buying intent from public conversations, posts, and engagement patterns.",
  "Enrichment adds verified contact details like email, phone, and LinkedIn profiles.",
  "Lead scoring is based on relevance, engagement recency, and intent strength.",
  "Scout continuously monitors for new leads matching your criteria.",
  "High-intent leads are those actively discussing problems your product solves.",
  "Geographic and firmographic filters help you focus on your ideal market.",
  "Scout respects privacy — all data comes from publicly available sources.",
  "Enriched leads have 3x higher response rates than cold outreach.",
  "Intent signals include help-seeking questions, budget mentions, and tool comparisons.",
  "Scout can identify decision-makers within target companies automatically.",
  "Lead freshness matters — Scout prioritizes recent activity over old data.",
  "Partnership intent scoring helps identify potential collaboration opportunities.",
  "Audience overlap analysis finds influencers whose followers match your customers.",
]

export default function FN7FactRotator({ interval = 4000, style = {} }) {
  const [currentIndex, setCurrentIndex] = useState(() => Math.floor(Math.random() * SCOUT_FACTS.length))
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      setIsVisible(false)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % SCOUT_FACTS.length)
        setIsVisible(true)
      }, 300)
    }, interval)

    return () => clearInterval(timer)
  }, [interval])

  return (
    <div
      style={{
        padding: '2px',
        background: 'linear-gradient(135deg, #FF6C57 0%, #B56AF1 50%, #6366f1 100%)',
        borderRadius: '16px',
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          padding: '24px 28px',
          background: 'white',
          borderRadius: '14px',
          overflow: 'hidden',
        }}
      >
        {/* Background gradient overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(255, 108, 87, 0.06) 0%, rgba(181, 106, 241, 0.06) 50%, rgba(99, 102, 241, 0.06) 100%)',
          pointerEvents: 'none',
        }} />
        
        {/* Content */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px',
        }}>
          {/* Icon */}
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #FF6C57, #B56AF1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(181, 106, 241, 0.3)',
          }}>
            <span style={{ fontSize: '24px' }}>🔍</span>
          </div>
          
          {/* Text content */}
          <div style={{ flex: 1, minHeight: '60px' }}>
            <div style={{
              fontWeight: 600,
              color: '#1a1a2e',
              marginBottom: '8px',
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              background: 'linear-gradient(135deg, #FF6C57, #B56AF1)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Did you know?
            </div>
            <div style={{
              color: '#374151',
              fontSize: '16px',
              lineHeight: '1.6',
              fontWeight: 450,
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
              transition: 'all 0.3s ease',
            }}>
              {SCOUT_FACTS[currentIndex]}
            </div>
          </div>
        </div>
        
        {/* Progress indicator */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          justifyContent: 'center',
          gap: '6px',
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid rgba(181, 106, 241, 0.15)',
        }}>
          {SCOUT_FACTS.map((_, index) => (
            <div
              key={index}
              style={{
                width: index === currentIndex ? '24px' : '8px',
                height: '8px',
                borderRadius: '4px',
                background: index === currentIndex 
                  ? 'linear-gradient(135deg, #FF6C57, #B56AF1)' 
                  : 'rgba(181, 106, 241, 0.2)',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

