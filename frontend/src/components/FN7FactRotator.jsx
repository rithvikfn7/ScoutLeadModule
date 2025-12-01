import { useState, useEffect } from 'react'

const FN7_FACTS = [
  "FN7 is a smart system that helps decide where your budget should go for the best results.",
  "It uses a simple thinking method called GEM: What's the goal? What's the proof? What action should we take?",
  "It always starts by asking: \"What are we trying to improve right now?\"",
  "FN7 only makes changes when it sees real evidence, never guesses.",
  "Every decision ends with a small, safe action — like increasing or decreasing a bit of budget.",
  "FN7 doesn't get tricked by random good days. It looks for real, steady improvement.",
  "It pays attention when the market changes and adjusts itself automatically.",
  "FN7 looks at today's results and long-term trends so it doesn't overreact.",
  "It has built-in safety rules to stop risky decisions.",
  "If there isn't enough data, FN7 stays calm and avoids big moves.",
  "It can spot early signs of higher costs even before performance drops.",
  "FN7 understands that some conversions take time and waits patiently.",
  "When a campaign slowly gets worse, FN7 can tell the difference from a short-term dip.",
  "If everything in the market shifts, FN7 recognizes it and responds gently.",
  "It increases budgets only when it is confident, not just hopeful.",
  "If the data looks unreliable, FN7 slows down and plays safe.",
  "FN7 explains why it made every decision in plain language.",
  "It treats unusual data carefully instead of jumping to conclusions.",
  "New ideas or campaigns are tested quietly first, without risking your budget.",
  "You can always see a clear history of how FN7 decided things — no secrets.",
  "FN7 makes small, thoughtful changes so you see smooth, steady progress.",
  "It avoids big swings in spending, which keeps campaigns stable.",
  "FN7 never panics if there's missing data — it slows down instead.",
  "It reads deeper patterns in your results to understand what's really happening.",
  "Everything FN7 does comes back to one rule: \"Make decisions based on facts, not noise.\"",
]

export default function FN7FactRotator({ interval = 4000, style = {} }) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % FN7_FACTS.length)
    }, interval)

    return () => clearInterval(timer)
  }, [interval])

  return (
    <div
      style={{
        padding: '1px',
        background: 'linear-gradient(to right, #FF6C57, #B56AF1)',
        borderRadius: '8px',
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          padding: '16px',
          background: 'white',
          borderRadius: '7px',
          color: '#475467',
          fontSize: '14px',
          lineHeight: '1.6',
          transition: 'opacity 0.3s ease',
        }}
      >
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '7px',
          background: 'linear-gradient(to right, #FF6C57, #B56AF1)',
          opacity: 0.07,
          pointerEvents: 'none',
        }} />
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        marginBottom: '8px'
      }}>
        <span style={{ fontSize: '20px', flexShrink: 0 }}>💡</span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: 500,
            color: '#000000',
            marginBottom: '4px',
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Did you know?
          </div>
          <div key={currentIndex} style={{
            animation: 'fadeIn 0.5s ease-in',
          }}>
            {FN7_FACTS[currentIndex]}
          </div>
        </div>
      </div>
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        justifyContent: 'center',
        gap: '4px',
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid #e0e7ff'
      }}>
        {FN7_FACTS.map((_, index) => (
          <div
            key={index}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: index === currentIndex ? '#2a60ff' : '#cbd5e1',
              transition: 'background 0.3s ease',
            }}
          />
        ))}
      </div>
      </div>
    </div>
  )
}

