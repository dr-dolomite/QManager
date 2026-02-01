import React from "react";

interface AbstractPatternProps {
  type: string;
  className?: string;
}

export const AbstractPattern = ({ type, className }: AbstractPatternProps) => {
  if (type === "gaming") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
      >
        <polygon
          points="0,200 80,120 160,200"
          fill="rgba(255,255,255,0.05)"
        />
        <polygon
          points="100,200 180,80 260,200"
          fill="rgba(255,255,255,0.08)"
        />
        <polygon
          points="200,200 320,60 400,200"
          fill="rgba(255,255,255,0.04)"
        />
        <circle cx="350" cy="50" r="80" fill="rgba(255,255,255,0.03)" />
        <circle cx="50" cy="30" r="40" fill="rgba(255,255,255,0.05)" />
        <line
          x1="0"
          y1="150"
          x2="400"
          y2="150"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1="100"
          x2="400"
          y2="100"
          stroke="rgba(255,255,255,0.03)"
          strokeWidth="1"
        />
        <line
          x1="200"
          y1="0"
          x2="200"
          y2="200"
          stroke="rgba(255,255,255,0.03)"
          strokeWidth="1"
        />
      </svg>
    );
  }
  if (type === "streaming") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M0,100 Q100,50 200,100 T400,100"
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="60"
        />
        <path
          d="M0,140 Q100,90 200,140 T400,140"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="40"
        />
        <circle cx="320" cy="60" r="100" fill="rgba(255,255,255,0.04)" />
        <circle cx="80" cy="160" r="60" fill="rgba(255,255,255,0.06)" />
        <ellipse
          cx="200"
          cy="40"
          rx="120"
          ry="40"
          fill="rgba(255,255,255,0.03)"
        />
      </svg>
    );
  }
  if (type === "balanced") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
      >
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="2"
        />
        <circle
          cx="100"
          cy="100"
          r="60"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="2"
        />
        <circle
          cx="100"
          cy="100"
          r="40"
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="2"
        />
        <circle cx="320" cy="80" r="100" fill="rgba(255,255,255,0.03)" />
        <rect
          x="250"
          y="140"
          width="120"
          height="60"
          rx="8"
          fill="rgba(255,255,255,0.04)"
        />
        <rect
          x="280"
          y="20"
          width="80"
          height="40"
          rx="4"
          fill="rgba(255,255,255,0.05)"
        />
      </svg>
    );
  }
  // Custom/default pattern
  return (
    <svg
      className={className}
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
    >
      <circle cx="350" cy="50" r="120" fill="rgba(255,255,255,0.05)" />
      <circle cx="50" cy="150" r="80" fill="rgba(255,255,255,0.04)" />
      <rect
        x="150"
        y="80"
        width="100"
        height="100"
        rx="12"
        fill="rgba(255,255,255,0.03)"
        transform="rotate(15 200 130)"
      />
    </svg>
  );
};
